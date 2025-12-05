// netlify/functions/openai.js — Minimal API for MVP + distinct error codes per step

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---- helpers ----
async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
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
function json200(obj){ return { statusCode:200, headers:{ "Content-Type":"application/json" }, body: JSON.stringify(obj) }; }
function jsonErr(code, msg, http=500){ return { statusCode:http, headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ error: `${code}: ${msg}` }) }; }

// Extract plain text from Responses API safely
function getOutputText(resp){
  return resp.output_text || resp.output?.[0]?.content?.[0]?.text || "";
}
function str(v){ return typeof v === "string" ? v : ""; }

// ---- handlers ----
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return jsonErr("S000-METHOD", "Method Not Allowed", 405);
    if (!OPENAI_API_KEY) return jsonErr("S000-KEY", "Missing OPENAI_API_KEY", 500);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return jsonErr("S000-BADJSON", "Malformed request body", 400); }

    const op = body.op;

    // 1) Generate initial image — client error code: E101-GEN; server code here: S101-GEN
    if (op === "gen_image") {
      const prompt = str(body.prompt) || "A table with assorted objects, photoreal, studio lighting";
      try {
        const img = await openai("images", {
          model: "gpt-image-1",
          prompt,
          size: "1024x1024"
        });
        const image_url = img.data?.[0]?.url;
        if (!image_url) return jsonErr("S101-GEN", "No image URL");
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S101-GEN", e.message || String(e));
      }
    }

    // 2) Identify clicked thing using the cursor-marked image — client code: E201-ID; server code: S201-ID
    if (op === "identify_click") {
      const marked = str(body.marked_image_data_url);
      const original = str(body.original_url);
      const x = Number.isFinite(body.x) ? body.x : null;
      const y = Number.isFinite(body.y) ? body.y : null;
      if (!marked || x === null || y === null) return jsonErr("S201-ID", "Missing marked image or coordinates", 400);

      try {
        const sys =
          "You are a precise vision assistant. You will receive an image that already has a bright cursor/crosshair drawn on it. " +
          "Your task: say what object or region the cursor is on (or closest to) in 3 words or fewer. Return ONLY the noun phrase.";
        const resp = await openai("responses", {
          model: "gpt-4o",
          input: [
            { role: "system", content: sys },
            { role: "user", content: [
              { type:"input_text", text:`The canvas size is ${body?.canvas_size?.width || 768}x${body?.canvas_size?.height || 512}. Cursor at (${x},${y}).` },
              { type:"input_text", text:"Answer with a short noun phrase only (<= 3 words)." },
              { type:"input_image", image_url: marked }
            ]}
          ]
        });
        const label = getOutputText(resp).trim().replace(/^["']|["']$/g,"");
        if (!label) return jsonErr("S201-ID", "Empty label");
        return json200({ label });
      } catch (e) {
        return jsonErr("S201-ID", e.message || String(e));
      }
    }

    // 3) Generate a follow-up image based on the clicked label — client code: E301-FOLLOW; server code: S301-FOLLOW
    if (op === "gen_followup_image") {
      const label = str(body.clicked_label) || "object";
      const prior = str(body.prior_prompt) || "A table with assorted objects, photoreal";
      try {
        // Ask the model to compose a new image prompt
        const comp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            { role:"system", content:
              "You write concise, concrete image prompts. Return only the prompt text. " +
              "Avoid camera jargon; describe content and composition clearly." },
            { role:"user", content:
              `Prior scene prompt:\n${prior}\n\nUser clicked: ${label}\n` +
              "Write a new prompt that focuses on the clicked thing being interacted with meaningfully (subtle change). Return prompt only." }
          ]
        });
        const next_prompt = getOutputText(comp).trim();

        const img = await openai("images", {
          model: "gpt-image-1",
          prompt: next_prompt || (`A closer view focusing on the ${label}`),
          size: "1024x1024"
        });
        const image_url = img.data?.[0]?.url;
        if (!image_url) return jsonErr("S301-FOLLOW", "No image URL");
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

