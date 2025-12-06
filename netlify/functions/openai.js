// netlify/functions/openai.js — API for point & click MVP + choices + backpack + camera navigation

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

// Robust JSON extraction from model output
function extractJson(resp) {
  const s = getOutputText(resp) || "";
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  throw new Error("JSON parse failed");
}

// ---- handler ----
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
          quality: "medium"
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S101-GEN", "No b64_json from image generation");
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S101-GEN", e.message || String(e));
      }
    }

    // 2) Identify clicked thing and propose 4 interaction options (story-rich, with carry/stow info)
    //    Client code: E201-ID; server code: S201-ID
    if (op === "identify_click") {
      const marked = str(body.marked_image_data_url);
      const x = Number.isFinite(body.x) ? body.x : null;
      const y = Number.isFinite(body.y) ? body.y : null;
      const heldItemLabel = str(body.held_item_label);

      if (!marked || x === null || y === null) {
        return jsonErr("S201-ID", "Missing marked image or coordinates", 400);
      }

      try {
        const sys =
          "You are a vision assistant for a point-and-click adventure game.\n" +
          "You will see an image with a bright cursor/crosshair. Your tasks:\n" +
          "1) Name the object or region under (or closest to) the cursor with a short but descriptive noun phrase (up to ~12 words).\n" +
          "2) Decide whether this object is reasonably carryable by hand (true/false).\n" +
          "3) Propose 4 distinct ways the player could interact with that thing.\n\n" +
          "If no held item is provided, options can be general (inspect, push, open, etc.).\n" +
          "If a held item is provided, options should describe using that item on the target.\n\n" +
          "For carryable objects:\n" +
          "- At most ONE option should explicitly represent stowing/adding the object to the backpack.\n" +
          "- That option should clearly mention the backpack.\n\n" +
          "Each option should be a short, evocative sentence (10–30 words):\n" +
          "- Start with an imperative verb (e.g., \"Lift the lid to...\")\n" +
          "- Include a hint about why the player might choose it (risk, curiosity, reward, lore, etc.).\n\n" +
          "Respond with STRICT JSON ONLY in this form:\n" +
          "{\n" +
          "  \"label\": \"descriptive noun phrase\",\n" +
          "  \"carryable\": true or false,\n" +
          "  \"stow_option_index\": number or null,\n" +
          "  \"options\": [\"option 1\", \"option 2\", \"option 3\", \"option 4\"]\n" +
          "}";

        const userTextParts = [
          `Canvas size is ${body?.canvas_size?.width || 768}x${body?.canvas_size?.height || 512}. Cursor at (${x},${y}).`,
        ];
        if (heldItemLabel) {
          userTextParts.push(
            `The player is holding an item from their backpack: "${heldItemLabel}". ` +
            "Treat the interaction as using this item on the target."
          );
        }

        const resp = await openai("responses", {
          model: "gpt-4o",
          input: [
            { role: "system", content: sys },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: userTextParts.join("\n")
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
        const carryable = Boolean(parsed.carryable);
        let stow_option_index = parsed.stow_option_index;
        if (
          typeof stow_option_index !== "number" ||
          stow_option_index < 0 ||
          stow_option_index >= options.length
        ) {
          stow_option_index = null;
        }

        if (!label) return jsonErr("S201-ID", "Missing label from model");
        if (options.length !== 4) return jsonErr("S201-ID", "Expected 4 options from model");

        return json200({ label, options, carryable, stow_option_index });
      } catch (e) {
        return jsonErr("S201-ID", e.message || String(e));
      }
    }

    // 3) Generate a follow-up image + narrative based on clicked label + chosen option
    //    Client: E301-FOLLOW; server: S301-FOLLOW
    if (op === "gen_followup_image") {
      const label = str(body.clicked_label) || "object";
      const action = str(body.interaction_choice) || "";
      const prior = str(body.prior_prompt) || "A table with assorted objects, photoreal";

      try {
        // Prompt + story rewrite using gpt-4o-mini
        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "You are the narrative and visual director for a point-and-click adventure game.\n" +
                "Given a prior scene prompt, a clicked object, and a chosen interaction, you must:\n" +
                "1) Describe the immediate consequence of that choice and the new scene that unfolds (40–80 words).\n" +
                "2) Produce a concrete image generation prompt for the new scene (<= 60 words).\n\n" +
                "Respond with STRICT JSON ONLY:\n" +
                "{\n" +
                "  \"next_prompt\": \"visual prompt for the new image\",\n" +
                "  \"story\": \"40-80 word narrative describing the outcome of the choice and the new scene\",\n" +
                "  \"clicked_label_for_sprite\": \"short name for the item, if an object was taken\" (or null/false)\n" +
                "}\n"
            },
            {
              role: "user",
              content:
                `Prior scene prompt:\n${prior}\n\n` +
                `The player clicked on: ${label}\n` +
                (action ? `They chose to: ${action}\n` : "") +
                "Describe what happens as a result and what the player now sees. Then provide the new image prompt and optional clicked_label_for_sprite in JSON as requested."
            }
          ]
        });

        const parsed = extractJson(resp);
        const next_prompt_raw = str(parsed.next_prompt).trim();
        const story_raw = str(parsed.story).trim();
        const clicked_label_for_sprite = parsed.clicked_label_for_sprite;

        const next_prompt =
          next_prompt_raw ||
          (prior + ` Focus on the ${label} and the player action: ${action || "interact"}.`);
        const story =
          story_raw ||
          `You act on the ${label}, and the room shifts subtly around you. The consequences of that choice settle into a new scene.`;

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

        return json200({ image_url, next_prompt, story, clicked_label_for_sprite });
      } catch (e) {
        return jsonErr("S301-FOLLOW", e.message || String(e));
      }
    }

    // 4) Generate a small sprite for a carryable item (transparent background)
    //    Used after a stow/backpack action
    if (op === "make_item_sprite") {
      const itemLabel = str(body.item_label) || "object";
      try {
        const prompt =
          `A small clear icon of ${itemLabel}, simple flat illustration, neutral lighting, centered, ` +
          "no extra objects, clean outline, suitable as an inventory icon, transparent background.";

        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "low",
          background: "transparent",
          output_format: "png"
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S401-SPRITE", "No b64_json from sprite generation");
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S401-SPRITE", e.message || String(e));
      }
    }

    // 5) Change view (look left/right/up/down, zoom out)
    //    Client: E501-VIEW; server: S501-VIEW
    if (op === "change_view") {
      const direction = str(body.direction) || "left";
      const prior = str(body.prior_prompt) || "A room";
      try {
        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "You are a visual director for a point-and-click adventure game.\n" +
                "Given a prior scene prompt and a view direction, you must:\n" +
                "1) Describe how the camera shifts (left/right/up/down/zoom out) while staying in the same location or immediate area (40–80 words).\n" +
                "2) Produce a concrete image generation prompt for the new viewpoint (<= 60 words).\n\n" +
                "Keep continuity of setting, lighting, and general mood. Do not teleport to a completely different place.\n" +
                "Respond with STRICT JSON ONLY:\n" +
                "{\n" +
                "  \"next_prompt\": \"visual prompt for the new image from this viewpoint\",\n" +
                "  \"story\": \"40-80 word narrative about how the view shifts and what is now seen\"\n" +
                "}\n"
            },
            {
              role: "user",
              content:
                `Prior scene prompt:\n${prior}\n\n` +
                `The player chooses to look: ${direction}.\n` +
                "Describe the new view and what is visible, then provide the image prompt in JSON."
            }
          ]
        });

        const parsed = extractJson(resp);
        const next_prompt_raw = str(parsed.next_prompt).trim();
        const story_raw = str(parsed.story).trim();

        const next_prompt =
          next_prompt_raw ||
          (prior + ` View shifted ${direction}, showing more of the surrounding area.`);
        const story =
          story_raw ||
          `You shift your gaze ${direction}, taking in a broader view of the same space and noticing new details that were previously out of frame.`;

        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt: next_prompt,
          n: 1,
          size: "1024x1024",
          quality: "medium"
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S501-VIEW", "No b64_json from view-change generation");
        const image_url = `data:image/png;base64,${b64}`;

        return json200({ image_url, next_prompt, story });
      } catch (e) {
        return jsonErr("S501-VIEW", e.message || String(e));
      }
    }

    return jsonErr("S000-OP", "Unknown op", 400);
  } catch (err) {
    console.error(err);
    return jsonErr("S000-UNCAUGHT", err.message || String(err), 500);
  }
};
