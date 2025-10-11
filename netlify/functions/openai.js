// netlify/functions/openai.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || JSON.stringify(json));
  return json;
}

// NEW: robust extractor (works even if the model adds stray text)
function getOutputText(resp) {
  return resp.output_text || resp.output?.[0]?.content?.[0]?.text || "";
}
function extractJson(resp) {
  const s = getOutputText(resp) || "";
  try { return JSON.parse(s); } catch {}
  // fallback: grab first {...} block
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error("Model did not return valid JSON.");
}

async function createScene({ prompt, context }) {
  const sceneResp = await openai("responses", {
    model: "gpt-4o",
    input: [
      { role: "system", content:
        "You generate short, vivid adventure scenes for a visual game.\n" +
        "Return STRICT JSON ONLY with keys: scene_description (<=80 words), image_prompt, options (array of 4 short imperatives)." },
      { role: "user", content:
        `Create a second-person scene from: "${prompt}". ${context || ""}\n` +
        "Respond with JSON only; no prose outside the JSON." }
    ],
    // REMOVED: text.format / text_format
  });

  const parsed = extractJson(sceneResp);

  const imgResp = await openai("images", {
    model: "gpt-image-1",
    prompt: parsed.image_prompt,
    size: "1024x1024"
  });
  const image_url = imgResp.data?.[0]?.url;
  if (!image_url) throw new Error("No image URL returned");

  return {
    scene_description: parsed.scene_description,
    options: parsed.options,
    image_url,
  };
}

async function segmentImage({ imageUrl }) {
  const segResp = await openai("responses", {
    model: "gpt-4o",
    input: [
      { role: "system", content:
        "You are a scene segmenter. Given an image, return up to 8 salient regions as normalized bboxes.\n" +
        "Return JSON ONLY: { regions: [ { label:string, x:number, y:number, w:number, h:number } ] }" },
      { role: "user", content: [
        { type: "input_text", text: "Identify salient objects or areas useful for interaction." },
        { type: "input_image", image_url: imageUrl }
      ]}
    ],
    // REMOVED: text.format / text_format
  });

  let parsed;
  try { parsed = extractJson(segResp); } catch { parsed = { regions: [] }; }

  const regions = (parsed.regions || [])
    .map(r => ({
      label: String(r.label || "").slice(0, 40),
      x: clamp01(+r.x), y: clamp01(+r.y),
      w: clamp01(+r.w), h: clamp01(+r.h),
    }))
    .filter(r => r.w > 0.02 && r.h > 0.02);

  return { regions };
}

async function useItem({ sceneDesc, itemLabel, targetLabel }) {
  const useResp = await openai("responses", {
    model: "gpt-4o",
    input: [
      { role: "system", content:
        "You are an interactive fiction engine. The player uses an inventory item on a target in the scene.\n" +
        "Return STRICT JSON ONLY:\n" +
        "{ scene_description: string (<=80 words), image_prompt: string, options: string[4], consume_item: boolean }" },
      { role: "user", content:
        `Current scene: ${sceneDesc}\n` +
        `Player uses: "${itemLabel}" on "${targetLabel}".\n` +
        "Respond with JSON only; no prose outside the JSON." }
    ],
    // REMOVED: text.format / text_format
  });

  const parsed = extractJson(useResp);

  const imgResp = await openai("images", {
    model: "gpt-image-1",
    prompt: parsed.image_prompt,
    size: "1024x1024"
  });
  const image_url = imgResp.data?.[0]?.url;
  if (!image_url) throw new Error("No image URL returned");

  return {
    scene_description: parsed.scene_description,
    options: parsed.options,
    image_url,
    consume_item: !!parsed.consume_item
  };
}

function clamp01(n) { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!OPENAI_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: "Missing OPENAI_API_KEY" }) };

    const body = JSON.parse(event.body || "{}");
    const { op } = body;

    if (op === "scene")   return { statusCode: 200, body: JSON.stringify(await createScene({ prompt: body.prompt, context: body.context })) };
    if (op === "segment") return { statusCode: 200, body: JSON.stringify(await segmentImage({ imageUrl: body.imageUrl })) };
    if (op === "use")     return { statusCode: 200, body: JSON.stringify(await useItem({ sceneDesc: body.sceneDesc, itemLabel: body.itemLabel, targetLabel: body.targetLabel })) };

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown op" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Server error" }) };
  }
};
