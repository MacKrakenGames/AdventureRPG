// Netlify serverless function (Node 18+).
// Ops: "scene" -> create scene + image; "segment" -> vision boxes; "use" -> apply item to region.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

// Utility: pull string JSON from Responses API (supports new shape)
function getOutputText(resp) {
  // New Responses API exposes a convenience field:
  if (resp.output_text) return resp.output_text;
  // Fallback for older shapes:
  return resp.output?.[0]?.content?.[0]?.text || "";
}

async function createScene({ prompt, context }) {
  // 1) Ask model for JSON (scene_description, image_prompt, options[4])
  const sceneResp = await openai("responses", {
    model: "gpt-4o",
    input: [
      {
        role: "system",
        content:
          "You generate short, vivid adventure scenes for a visual game. " +
          "Always return strict JSON with keys: scene_description (<=80 words), image_prompt, options (array of 4 short imperatives). " +
          "Keep tone evocative, concrete. Avoid proper names unless necessary."
      },
      {
        role: "user",
        content:
          `Create a first-person scene from: "${prompt}". ${context || ""}\n` +
          "Return JSON only. The image_prompt must describe what to render visually; no camera jargon."
      }
    ],
    // NEW: use text.format instead of response_format
    text: { format: "json" }
  });

  let parsed;
  try { parsed = JSON.parse(getOutputText(sceneResp)); }
  catch { throw new Error("Scene JSON parse failed"); }

  // 2) Generate an image
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
      {
        role: "system",
        content:
          "You are a scene segmenter. Given an image, return up to 8 salient, user-clickable regions. " +
          "Return strict JSON: { regions: [ { label: string, x: number, y: number, w: number, h: number } ] } " +
          "Coordinates are normalized (0..1) relative to image width/height. Use tight bboxes. " +
          "Labels should be short, concrete nouns (e.g., 'lantern', 'altar', 'door', 'rope ladder')."
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Identify salient objects or areas useful for interaction." },
          { type: "input_image", image_url: imageUrl }
        ]
      }
    ],
    // NEW:
    text: { format: "json" }
  });

  let parsed;
  try { parsed = JSON.parse(getOutputText(segResp)); }
  catch { parsed = { regions: [] }; }

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
      {
        role: "system",
        content:
          "You are an interactive fiction engine. The player uses an inventory item on a target in the scene. " +
          "Return strict JSON:\n" +
          "{ scene_description: string (<=80 words), image_prompt: string, options: string[4], consume_item: boolean }\n" +
          "Only set consume_item true if the item is plausibly expended (e.g., key breaks, potion empty). " +
          "Keep continuity with the prior scene description."
      },
      {
        role: "user",
        content:
          `Current scene: ${sceneDesc}\n` +
          `Player uses: "${itemLabel}" on "${targetLabel}".\n` +
          "Describe the new resulting scene in second person, then give 4 next-step options. Return JSON only."
      }
    ],
    // NEW:
    text: { format: "json" }
  });

  let parsed;
  try { parsed = JSON.parse(getOutputText(useResp)); }
  catch { throw new Error("Use JSON parse failed"); }

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
