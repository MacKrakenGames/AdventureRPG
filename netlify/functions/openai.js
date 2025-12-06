// netlify/functions/openai.js — Minimal API for MVP + distinct error codes per step
// FIXED: gpt-image-1 uses /images/generations and returns base64, not URL.

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

// ---- handlers ----
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return jsonErr("S000-METHOD", "Method Not Allowed", 405);
    if (!OPENAI_API_KEY)           return jsonErr("S000-KEY", "Missing OPENAI_API_KEY", 500);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return jsonErr("S000-BADJSON", "Malformed request body", 400); }

    const op = body.op;

    // 1) Generate initial image — client error code: E101-GEN; server code here: S101-GEN
    if (op === "gen_image") {
      const prompt = str(body.prompt) || "A table with assorted objects, photoreal, studio lighting";
      try {
        // gpt-image-1: use /images/generations and read data[0].b64_json
        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "low"
          // For gpt-image-1, response_format is always base64; no need to specify
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S101-GEN", "No b64_json from image generation");
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S101-GEN", e.message || String(e));
      }
    }

    // 2) Identify clicked thing using the cursor-marked image — client: E201-ID; server: S201-ID
    if (op === "identify_click") {
      const marked = str(body.marked_image_data_url);
      const original = str(body.original_url); // not strictly needed, but kept for future use
      const x = Number.isFinite(body.x) ? body.x : null;
      const y = Number.isFinite(body.y) ? body.y : null;

      if (!marked || x === null || y === null) {
        return jsonErr("S201-ID", "Missing marked image or coordinates", 400);
      }

      try {
        const sys =
          "You are a precise vision assistant. You will receive an image that already has a bright cursor/crosshair drawn on it. " +
          "Your task: say what object or region the cursor is on (or closest to) in 3 words or fewer. Return ONLY the noun phrase.";

        const resp = await openai("responses", {
          model: "gpt-4o",
          input: [
            { role: "system", content: sys },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `The canvas size is ${body?.canvas_size?.width || 768}x${body?.canvas_size?.height || 512}. Cursor at (${x},${y}).`
                },
                {
                  type: "input_text",
                  text: "Answer with a short noun phrase only (<= 3 words)."
                },
                {
                  type: "input_image",
                  image_url: marked
                }
              ]
            }
          ]
        });

        const label = getOutputText(resp).trim().replace(/^["']|["']$/g, "");
        if (!label) return jsonErr("S201-ID", "Empty label");
        return json200({ label });
      } catch (e) {
        return jsonErr("S201-ID", e.message || String(e));
      }
    }

    // 3) Generate a follow-up image based on the clicked label — client: E301-FOLLOW; server: S301-FOLLOW
    if (op === "gen_followup_image") {
      const label = str(body.clicked_label) || "object";
      const prior = str(body.prior_prompt) || "A table with assorted objects, photoreal";

      try {
        // Ask text model to craft the next prompt
        const comp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "You write concise, concrete image prompts. Return only the prompt text. " +
                "Avoid camera jargon; describe content and composition clearly."
            },
            {
              role: "user",
              content:
                `Prior scene prompt:\n${prior}\n\nUser clicked: ${label}\n` +
                "Write a new prompt that focuses on the clicked thing being interacted with meaningfully (subtle change). Return prompt only."
            }
          ]
        });

        const next_prompt = getOutputText(comp).trim();

        // Generate the follow-up image with gpt-image-1 (again base64-only)
        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt: next_prompt || `A closer view focusing on the ${label}`,
          n: 1,
          size: "1024x1024",
          quality: "low"
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


