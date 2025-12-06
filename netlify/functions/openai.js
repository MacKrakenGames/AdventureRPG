// netlify/functions/openai.js — role-playing MVP with hyper-real style + NPC sheets

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---- generic OpenAI helper with better error reporting ----
async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg =
      json?.error?.message ||
      (text ? text.slice(0, 200) : `HTTP ${res.status} with empty body`);
    throw new Error(msg);
  }

  return json ?? {};
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

function getOutputText(resp){
  return resp?.output_text || resp?.output?.[0]?.content?.[0]?.text || "";
}
function str(v){ return typeof v === "string" ? v : ""; }

function extractJson(resp) {
  const s = getOutputText(resp) || "";
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  throw new Error("JSON parse failed");
}

const GLOBAL_STYLE =
  "hyper-realistic photograph, 50mm lens, shallow depth of field, high dynamic range, natural cinematic lighting, camera-quality image, not a painting, not a drawing, not an illustration.";

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return jsonErr("S000-METHOD", "Method Not Allowed", 405);
    if (!OPENAI_API_KEY)           return jsonErr("S000-KEY", "Missing OPENAI_API_KEY", 500);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return jsonErr("S000-BADJSON", "Malformed request body", 400); }

    const op = body.op;

    /* ---------- 1) generate initial image ---------- */

    if (op === "gen_image") {
      const prompt = str(body.prompt) || ("A room, " + GLOBAL_STYLE);
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

    /* ---------- 2) identify clicked thing + options + NPC info ---------- */

    if (op === "identify_click") {
      const marked = str(body.marked_image_data_url);
      const x = Number.isFinite(body.x) ? body.x : null;
      const y = Number.isFinite(body.y) ? body.y : null;
      const heldItemLabel = str(body.held_item_label);
      const priorPrompt = str(body.prior_prompt);
      const worldTag = str(body.world_tag);
      const npcs = Array.isArray(body.npcs) ? body.npcs : [];

      if (!marked || x === null || y === null) {
        return jsonErr("S201-ID", "Missing marked image or coordinates", 400);
      }

      try {
        const sys =
          "You are a vision assistant for a point-and-click role-playing game.\n" +
          "You will see a hyper-realistic photograph with a bright cursor/crosshair. Your tasks:\n" +
          "1) Name the object or region under (or closest to) the cursor with a short but descriptive noun phrase (up to ~12 words).\n" +
          "2) Decide whether this object is reasonably carryable by hand (true/false).\n" +
          "3) Propose 4 distinct ways the player could interact with that thing.\n" +
          "4) Decide if the clicked region is a specific human non-player character (NPC) and, if so, provide a consistent character entry.\n\n" +
          "Use the world_tag and prior scene prompt to decide tone and genre. The world_tag describes the overall setting, such as:\n" +
          "- magical_school\n" +
          "- university\n" +
          "- western\n" +
          "- private_eye\n\n" +
          "All interactions must be consistent with that world. Do NOT change era, technology level, or setting genre.\n" +
          "In western, stay in 19th-century frontier style; in private_eye, stay in 1940s noir; in university, keep to contemporary realistic behavior; in magical_school, magic is allowed but visuals remain photographic.\n\n" +
          "By default, keep interactions realistic and non-magical.\n" +
          "ONLY introduce overt magic or supernatural effects if the prior scene prompt clearly establishes a magical or supernatural setting\n" +
          "(for example, mentions spells, enchantment, wizards, or a magical school). If it does not, stay grounded in everyday physics and social behavior.\n\n" +
          "If no held item is provided, options can be general (inspect, push, open, speak to someone, hand the object to someone, etc.).\n" +
          "If a held item is provided, options should describe using that item on the target.\n\n" +
          "For carryable objects:\n" +
          "- At most ONE option should explicitly represent stowing/adding the object to the backpack.\n" +
          "- That option should clearly mention the backpack.\n\n" +
          "Each option should be a short, evocative sentence (10–30 words):\n" +
          "- Start with an imperative verb (e.g., \"Place the necklace around her neck…\").\n" +
          "- Include a hint about why the player might choose it (comfort, politeness, curiosity, risk, reward, etc.).\n\n" +
          "NPC identification:\n" +
          "- If the cursor is on or very near a specific person in the image, set is_character = true.\n" +
          "- For such NPCs, choose a short, setting-appropriate name (e.g., \"Evelyn\", \"Sheriff Cole\").\n" +
          "- Use the list of existing NPCs to reuse names if the appearance clearly matches a known character.\n" +
          "- character_summary should be 1–2 sentences (<= 60 words) focusing on appearance, role, and demeanor.\n\n" +
          "Respond with STRICT JSON ONLY in this form:\n" +
          "{\n" +
          "  \"label\": \"descriptive noun phrase\",\n" +
          "  \"carryable\": true or false,\n" +
          "  \"stow_option_index\": number or null,\n" +
          "  \"options\": [\"option 1\", \"option 2\", \"option 3\", \"option 4\"],\n" +
          "  \"is_character\": true or false,\n" +
          "  \"character_name\": \"short name or null if not a character\",\n" +
          "  \"character_summary\": \"1–2 sentence summary or null if not a character\"\n" +
          "}";

        const userTextParts = [
          `Canvas size is ${body?.canvas_size?.width || 768}x${body?.canvas_size?.height || 512}. Cursor at (${x},${y}).`,
        ];
        if (worldTag) {
          userTextParts.push(`World tag: ${worldTag}`);
        }
        if (priorPrompt) {
          userTextParts.push(`Prior scene prompt (hyper-real style):\n${priorPrompt}`);
        }
        if (npcs.length) {
          userTextParts.push(
            "Existing NPCs (reuse names if the clicked person matches one of these):\n" +
            npcs.map(n => `- ${n.name}: ${n.summary || ""}`).join("\n")
          );
        }
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
                { type: "input_text", text: userTextParts.join("\n\n") },
                { type: "input_text", text: "Return JSON only; no explanation." },
                { type: "input_image", image_url: marked }
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

        const is_character = Boolean(parsed.is_character);
        const character_name = str(parsed.character_name).trim() || null;
        const character_summary = str(parsed.character_summary).trim() || null;

        if (!label) return jsonErr("S201-ID", "Missing label from model");
        if (options.length !== 4) return jsonErr("S201-ID", "Expected 4 options from model");

        return json200({
          label,
          options,
          carryable,
          stow_option_index,
          is_character,
          character_name,
          character_summary,
        });
      } catch (e) {
        return jsonErr("S201-ID", e.message || String(e));
      }
    }

    /* ---------- 3) follow-up image + longer narrative ---------- */

    if (op === "gen_followup_image") {
      const label = str(body.clicked_label) || "object";
      const action = str(body.interaction_choice) || "";
      const prior = str(body.prior_prompt) || ("A room, " + GLOBAL_STYLE);
      const worldTag = str(body.world_tag);
      const npcs = Array.isArray(body.npcs) ? body.npcs : [];

      try {
        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "You are the narrative and visual director for a point-and-click role-playing game.\n" +
                "Given a prior scene prompt, a clicked object, a chosen interaction, a world_tag, and a list of NPC character sheets, you must:\n" +
                "1) Describe the immediate consequence of that choice and the new scene that unfolds.\n" +
                "2) Produce a concrete image generation prompt for the new scene.\n\n" +
                "The world_tag describes the overarching setting/genre (e.g., magical_school, university, western, private_eye).\n" +
                "All scenes must remain consistent with this world: same historical era, technology level, and overall mood.\n" +
                "Re-use important visual style cues from the prior scene prompt (lighting, camera style, color palette, and the explicitly hyper-real photographic style).\n" +
                "Assume major characters and key objects remain visually recognizable across scenes unless there is a clear story reason to remove them.\n" +
                "Do not change a recurring character’s age, gender, ethnicity, or general clothing style abruptly.\n\n" +
                "VISUAL STYLE CONSTRAINT:\n" +
                "- Every image is a hyper-realistic photograph, 50mm lens, shallow depth of field, high dynamic range, natural cinematic lighting.\n" +
                "- Never describe it as a painting, drawing, sketch, illustration, or 3D render.\n\n" +
                "By default, keep events and visuals realistic and non-magical.\n" +
                "ONLY introduce overt magic or supernatural effects if the world clearly supports magic (for example, magical_school).\n\n" +
                "The narrative must be 2–3 short paragraphs, together roughly 120–220 words. No bullet points.\n" +
                "The first paragraph should focus on the immediate outcome of the player’s choice.\n" +
                "The second (and optional third) paragraph should describe the new scene and how it feels to stand in it as the player.\n\n" +
                "Respond with STRICT JSON ONLY:\n" +
                "{\n" +
                "  \"next_prompt\": \"visual prompt for the new image (<= 60 words) that preserves style and world continuity\",\n" +
                "  \"story\": \"2–3 short paragraphs, 120–220 words in total, describing the outcome of the choice and the new scene\",\n" +
                "  \"clicked_label_for_sprite\": \"short name for the item, if an object was taken\" (or null/false)\n" +
                "}\n"
            },
            {
              role: "user",
              content:
                (worldTag ? `World tag: ${worldTag}\n\n` : "") +
                (npcs.length
                  ? "NPC character sheets:\n" +
                    npcs.map(n => `- ${n.name}: ${n.summary || ""}`).join("\n") +
                    "\n\n"
                  : "") +
                `Prior scene prompt (hyper-real photo style):\n${prior}\n\n` +
                `The player clicked on: ${label}\n` +
                (action ? `They chose to: ${action}\n\n` : "\n") +
                "Describe what happens as a result and what the player now sees, then provide the new image prompt and optional clicked_label_for_sprite in JSON."
            }
          ]
        });

        const parsed = extractJson(resp);
        const next_prompt_raw = str(parsed.next_prompt).trim();
        const story_raw = str(parsed.story).trim();
        const clicked_label_for_sprite = parsed.clicked_label_for_sprite;

        let next_prompt =
          next_prompt_raw ||
          (prior +
            ` Focus on the ${label} and the player action: ${action || "interact"}, preserving the same hyper-real photographic style.`);
        // Ensure global style hint is present
        if (!next_prompt.toLowerCase().includes("hyper-realistic")) {
          next_prompt += " " + GLOBAL_STYLE;
        }

        const story =
          story_raw ||
          "You follow through on your decision, and the scene shifts around you. The consequences settle into place as you take in your new surroundings, which still feel like a natural extension of where you were moments before.";

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

    /* ---------- 4) sprite for backpack items ---------- */

    if (op === "make_item_sprite") {
      const itemLabel = str(body.item_label) || "object";
      try {
        const prompt =
          `A small clear icon of ${itemLabel}, simple flat photograph-like illustration, neutral lighting, centered, ` +
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

    /* ---------- 5) change viewpoint (look left/right/up/down/zoom out) ---------- */

    if (op === "change_view") {
      const direction = str(body.direction) || "left";
      const prior = str(body.prior_prompt) || ("A room, " + GLOBAL_STYLE);
      const worldTag = str(body.world_tag);
      const npcs = Array.isArray(body.npcs) ? body.npcs : [];

      try {
        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            {
              role: "system",
              content:
                "You are a visual director for a point-and-click role-playing game.\n" +
                "Given a prior scene prompt, a view direction, a world_tag, and NPC character sheets, you must:\n" +
                "1) Describe how the camera shifts (left/right/up/down/zoom out) while staying in the same location or immediate area.\n" +
                "2) Produce a concrete image generation prompt for the new viewpoint.\n\n" +
                "The world_tag describes the overarching setting/genre (e.g., magical_school, university, western, private_eye).\n" +
                "All views must remain consistent with this world: same era, technology level, and overall mood.\n" +
                "Re-use important visual style cues from the prior scene prompt (lighting, camera style, color palette) and maintain the explicitly hyper-real photographic look.\n" +
                "If NPCs are likely still in frame from the new angle, keep them recognizable and consistent with their character sheets.\n\n" +
                "VISUAL STYLE CONSTRAINT:\n" +
                "- Every image is a hyper-realistic photograph, 50mm lens, shallow depth of field, high dynamic range, natural cinematic lighting.\n" +
                "- Never describe it as a painting, drawing, sketch, illustration, or 3D render.\n\n" +
                "By default, keep events and visuals realistic and non-magical, unless the world clearly supports magic (e.g., magical_school).\n\n" +
                "The narrative must be 2–3 short paragraphs, together roughly 120–220 words. No bullet points.\n" +
                "Focus on how it feels as the player slowly turns their gaze or pulls back, noticing new details that clearly belong to the same space.\n\n" +
                "Respond with STRICT JSON ONLY:\n" +
                "{\n" +
                "  \"next_prompt\": \"visual prompt for the new image from this viewpoint (<= 60 words) that preserves style and world continuity\",\n" +
                "  \"story\": \"2–3 short paragraphs, 120–220 words, about how the view shifts and what is now seen\"\n" +
                "}\n"
            },
            {
              role: "user",
              content:
                (worldTag ? `World tag: ${worldTag}\n\n` : "") +
                (npcs.length
                  ? "NPC character sheets:\n" +
                    npcs.map(n => `- ${n.name}: ${n.summary || ""}`).join("\n") +
                    "\n\n"
                  : "") +
                `Prior scene prompt (hyper-real photo style):\n${prior}\n\n` +
                `The player chooses to look: ${direction}.\n` +
                "Describe the new view and what is visible, then provide the image prompt in JSON."
            }
          ]
        });

        const parsed = extractJson(resp);
        const next_prompt_raw = str(parsed.next_prompt).trim();
        const story_raw = str(parsed.story).trim();

        let next_prompt =
          next_prompt_raw ||
          (prior +
            ` View shifted ${direction}, showing more of the surrounding area, in the same hyper-real photographic style.`);
        if (!next_prompt.toLowerCase().includes("hyper-realistic")) {
          next_prompt += " " + GLOBAL_STYLE;
        }

        const story =
          story_raw ||
          "You shift your gaze and the frame of the scene widens, revealing details that were previously hidden just outside your focus, all of them clearly belonging to the same place you were standing moments ago.";

        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt: next_prompt,
          n: 1,
          size: "1024x1024",
          quality: "low"   // faster & cheaper for view shifts
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
