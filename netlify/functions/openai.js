// netlify/functions/openai.js — API for point & click MVP + interaction choices

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---- helpers ----
async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  let json = {};
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

function json200(obj){
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
function jsonErr(code, msg, http = 500){
  return {
    statusCode: http,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: `${code}: ${msg}` })
  };
}

// Extract plain text from Responses API safely
function getOutputText(resp){
  return resp.output_text || resp.output?.[0]?.content?.[0]?.text || "";
}
function str(v){ return typeof v === "string" ? v : ""; }

// Extract JSON from model output robustly
function extractJson(resp) {
  const s = getOutputText(resp) || "";
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  throw new Error("JSON parse failed");
}

// ---- handlers ----
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return jsonErr("S000-METHOD", "Method Not Allowed", 405);
    if (!OPENAI_API_KEY)           return jsonErr("S000-KEY", "Missing OPENAI_API_KEY", 500);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return jsonErr("S000-BADJSON", "Malformed request body", 400); }

    const op = body.op;

    // 1) Generate initial image — client error code: E101-GEN; server: S101-GEN
    if (op === "gen_image") {
      const prompt = str(body.prompt) || "A table with assorted objects, photoreal, studio lighting";
      try {
        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "medium"   // <--- medium quality
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S101-GEN", "No b64_json from image generation");
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S101-GEN", e.message || String(e));
      }
    }

    // 2) Identify clicked thing and propose 4 interaction options
    //    Client code: E201-ID; server code: S201-ID
    if (op === "identify_click") {
      const marked = str(body.marked_image_data_url);
      const x = Number.isFinite(body.x) ? body.x : null;
      const y = Number.isFinite(body.y) ? body.y : null;

      if (!marked || x === null || y === null) {
        return jsonErr("S201-ID", "Missing marked image or coordinates", 400);
      }

      try {
        const sys =
          "You are a precise vision assistant for a point-and-click adventure game.\n" +
          "You will see an image with a bright cursor/crosshair. Your tasks:\n" +
          "1) Name the object or region under (or closest to) the cursor with a short noun phrase (<= 3 words).\n" +
          "2) Propose 4 distinct ways the player could interact with that thing.\n\n" +
          "Respond with STRICT JSON ONLY in this form:\n" +
          "{ \"label\": \"short noun phrase\",\n" +
          "  \"options\": [\"option 1\", \"option 2\", \"option 3\", \"option 4\"] }\n" +
          "Each option should be a short imperative phrase (e.g., \"Pick up the key\").";

        const resp = await openai("responses", {
          model: "gpt-4o",
          input: [
            { role: "system", content: sys },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    `Canvas size is ${body?.canvas_size?.width || 768}x${body?.canvas_size?.height || 512}. ` +
                    `Cursor at (${x},${y}).`
                },
                {
                  type: "input_text",
                  text: "Return JSON only; no explanation."
                },
                {
                  type: "input_image",
                  image_url: marked
                }
              ]
            }
          ]
        });

        const parsed = extractJson(resp);
        const label = str(parsed.label).trim();
        const options = Array.isArray(parsed.options)
          ? parsed.options.slice(0, 4).map(o => str(o).trim()).filter(Boolean)
          : [];

        if (!label) return jsonErr("S201-ID", "Missing label from model");
        if (options.length !== 4) return jsonErr("S201-ID", "Expected 4 options from model");

        return json200({ label, options });
      } catch (e) {
        return jsonErr("S201-ID", e.message || String(e));
      }
    }

    // 3) Generate a follow-up image based on the clicked label + chosen option
    //    Client: E301-FOLLOW; server: S301-FOLLOW
    if (op === "gen_followup_image") {
      const label = str(body.clicked_label) || "object";
      const action = str(body.interaction_choice) || "";
      const prior = str(body.prior_prompt) || "A table with assorted objects, photoreal";

      try {
        // Prompt rewrite using gpt-4o-mini
        const comp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "You write concise, concrete image prompts for a visual adventure game.\n" +
                "- Return ONLY the prompt text, nothing else.\n" +
                "- Keep it under 60 words.\n" +
                "- Avoid camera jargon; describe content and composition.\n" +
                "- Make the new scene clearly related to the prior scene and focused on the clicked object and chosen action."
            },
            {
              role: "user",
              content:
                `Prior scene prompt:\n${prior}\n\n` +
                `The player clicked on: ${label}\n` +
                (action ? `They chose to: ${action}\n` : "") +
                "Write a new prompt that visually shows the consequence of this interaction."
            }
          ]
        });

        const next_prompt_raw = getOutputText(comp).trim();
        const next_prompt =
          next_prompt_raw ||
          (prior + ` Focus on the ${label} and the player action: ${action || "interact"}.`);

        // Follow-up image at valid size + medium quality
        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt: next_prompt,
          n: 1,
          size: "1024x1024",
          quality: "medium"
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S301-FOLLOW", "No b64_json from follow-up generation");
        const image_url = `data:image/png;base64,${b64}`;

        return json200({ image_url, next_prompt });
      } catch (e) {
        return jsonErr("S301-FOLLOW", e.message || String(e));
      }
    }

    return jsonErr("S000-OP", "Unknown op", 400);
  } catch (err) {
    console.error(err);
    return jsonErr("S000-UNCAUGHT", err.message || String(err), 500);
  }
};
