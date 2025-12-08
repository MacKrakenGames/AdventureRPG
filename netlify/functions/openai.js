const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Low-level OpenAI helper
 */
async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

/**
 * Netlify response helpers
 */
function json200(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
function jsonErr(code, msg, http = 500) {
  return {
    statusCode: http,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: `${code}: ${msg}` }),
  };
}

/**
 * Responses API helpers
 */
function getOutputText(resp) {
  return (
    resp?.output_text ||
    resp?.output?.[0]?.content?.[0]?.text ||
    resp?.output?.[0]?.content?.[0]?.output_text ||
    ""
  );
}
function extractJson(resp) {
  const s = getOutputText(resp) || "";
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        // ignore
      }
    }
  }
  throw new Error("JSON parse failed");
}
function str(v) {
  return typeof v === "string" ? v : "";
}

const GLOBAL_STYLE =
  "hyper-realistic photograph, 50mm lens, shallow depth of field, high dynamic range, natural cinematic lighting, camera-quality image, not a painting, not a drawing, not an illustration.";

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST")
      return jsonErr("S000-METHOD", "Method Not Allowed", 405);
    if (!OPENAI_API_KEY)
      return jsonErr("S000-KEY", "Missing OPENAI_API_KEY", 500);

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonErr("S000-BADJSON", "Malformed request body", 400);
    }

    const op = body.op;

    // Normalise quality
    const rawQuality = body.quality;
    const reqQuality =
      rawQuality && ["low", "medium", "high"].includes(rawQuality)
        ? rawQuality
        : undefined;

    // Normalise interaction mode
    const rawInteractionMode = body.interaction_mode;
    const interactionMode =
      typeof rawInteractionMode === "string" &&
      ["wildcard", "pickup", "dialogue", "move"].includes(rawInteractionMode)
        ? rawInteractionMode
        : "wildcard";

    // Common context
    const worldTag = str(body.world_tag);
    const worldDesc = str(body.world_description);
    const playerCharacter = body.player_character || null;
    const npcs = Array.isArray(body.npcs) ? body.npcs : [];

    const playerSheetText = playerCharacter
      ? "Player-character sheet:\n" +
        `- age range: ${playerCharacter.age_range || "unspecified"}\n` +
        `- sex: ${playerCharacter.sex || "unspecified"}\n` +
        `- build: ${playerCharacter.weight_range || "unspecified"}\n` +
        `- chest: ${playerCharacter.chest_size || "unspecified"}\n` +
        `- hips: ${playerCharacter.hip_size || "unspecified"}\n` +
        `- hair: ${playerCharacter.hair_style || "unspecified"}, ${
          playerCharacter.hair_color || "unspecified"
        }\n` +
        `- eyes: ${playerCharacter.eye_color || "unspecified"}\n` +
        `- profession: ${playerCharacter.profession || "unspecified"}\n` +
        "Assume this is the person behind the camera, the one NPCs are speaking to.\n"
      : "";

    const worldText =
      worldTag || worldDesc
        ? `Persistent world constraints:\nWorld tag: ${
            worldTag || "unspecified"
          }\n` +
          (worldDesc ? worldDesc + "\n" : "") +
          "Never leave this world. Keep historical era, technology, clothing, and architecture consistent.\n\n"
        : "";

    /* ------------------------------------------------------------------ */
    /* op: gen_image                                                      */
    /* ------------------------------------------------------------------ */
    if (op === "gen_image") {
      const basePrompt = str(body.prompt) || "A scene, hyper-realistic.";
      const prompt = basePrompt.toLowerCase().includes("hyper-realistic")
        ? basePrompt
        : `${basePrompt} ${GLOBAL_STYLE}`;

      try {
        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: reqQuality || "medium",
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64) return jsonErr("S101-GEN", "No b64_json from image generation");
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S101-GEN", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* op: gen_player_portrait                                            */
    /* ------------------------------------------------------------------ */
    if (op === "gen_player_portrait") {
      const wTag = worldTag || "university";
      const sheet = playerCharacter || {};

      const basePrompt =
        `Hyper-realistic full-body portrait photograph of a ${
          sheet.age_range || "adult"
        } ${sheet.sex || "person"} ` +
        `with ${sheet.hair_style || "short hair"} and ${
          sheet.hair_color || "brown hair"
        }, ` +
        `${sheet.eye_color || "neutral eyes"}, ${
          sheet.weight_range || "average build"
        }, ` +
        `${sheet.chest_size || ""} ${
          sheet.hip_size || ""
        }, portrayed as a ${sheet.profession || "ordinary person"}.\n` +
        "Camera is pulled back so the character is relatively small in the frame. " +
        "Full-body vertical framing from head to toe, the entire figure fully visible including the very top of the head and both feet, " +
        "with generous empty background space above the head and below the feet. " +
        "Do NOT crop off the head, hair, shoulders, legs, or feet. " +
        "The character stands in a relaxed, natural pose, centered in the frame. " +
        "Clothing is neutral but world-appropriate, and the background softly hints at their world without distracting from the character.\n";

      const worldFlavor =
        wTag === "western"
          ? "Clothing and hairstyle fit an 1880s American frontier town. No modern fabrics or logos."
          : wTag === "private_eye"
          ? "Clothing and hairstyle fit a 1940s American city. No modern fabrics, haircuts, or accessories."
          : wTag === "magical_school"
          ? "Clothing fits a grounded magical boarding school: robe-like garments or academic attire with subtle mystical touches."
          : "Clothing fits a present-day university campus: casual modern clothes, no futuristic elements.";

      const prompt = `${basePrompt}${worldFlavor} ${GLOBAL_STYLE}`;

      try {
        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: "1024x1536",
          quality: reqQuality || "medium",
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64)
          return jsonErr("S601-CHAR", "No b64_json from player portrait generation");
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S601-CHAR", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* op: identify_click                                                 */
    /* ------------------------------------------------------------------ */
    if (op === "identify_click") {
      const marked = str(body.marked_image_data_url);
      const x = Number.isFinite(body.x) ? body.x : null;
      const y = Number.isFinite(body.y) ? body.y : null;
      const heldItemLabel = str(body.held_item_label);
      const priorPrompt = str(body.prior_prompt);

      if (!marked || x === null || y === null) {
        return jsonErr("S201-ID", "Missing marked image or coordinates", 400);
      }

      try {
        const sys =
          "You are a vision assistant for a point-and-click role-playing game.\n" +
          "You will see a hyper-realistic photograph with a bright cursor/crosshair. Your tasks:\n" +
          "1) Name the object or region under (or closest to) the cursor with a short but descriptive noun phrase (up to ~12 words).\n" +
          "2) Decide whether this object is reasonably carryable by hand (true/false).\n" +
          "3) Propose 4 distinct ways the player could interact with that thing, constrained by the current interaction_mode.\n" +
          "4) Decide if the clicked region is a specific human non-player character (NPC) and, if so, provide a consistent character entry.\n\n" +
          "interaction_mode can be one of:\n" +
          "- 'wildcard': normal behaviour. Mix of physical, observational, dialog, or movement options as appropriate.\n" +
          "- 'pickup': focus on collecting items. All 4 options should primarily be about picking up or otherwise acquiring carryable objects and adding them to the backpack. If nothing carryable is present, the options can explain that the player searches but finds nothing pocketable.\n" +
          "- 'dialogue': focus on speaking with people. All 4 options should be conversational: starting, escalating, calming, or redirecting conversation. If no clear person is present, choose the most plausible NPC or explain that there is nobody to talk to.\n" +
          "- 'move': focus on moving the player's position. All 4 options should describe different ways of moving toward, around, or away from the clicked area (e.g. walk closer, step onto the porch, climb the stairs, cross the street).\n\n" +
          "The player character is the person behind the camera; NPCs may react to their age, appearance, and profession in dialog.\n\n" +
          "All interactions must remain consistent with the persistent world constraints you are given. DO NOT change era, technology level, or setting genre.\n" +
          "By default, keep interactions realistic and non-magical. Only introduce overt magic in clearly magical worlds.\n\n" +
          "If no held item is provided, options should rely on the environment and NPCs. If a held item is provided, options should describe using that item on the target AND still respect the interaction_mode.\n\n" +
          "For carryable objects:\n" +
          "- In 'pickup' mode, at least one option must explicitly represent stowing/adding the object to the backpack.\n" +
          "- In other modes, at most one option should explicitly stow an object.\n\n" +
          "NPC identification:\n" +
          "- If the cursor is on or very near a specific person in the image, set is_character = true.\n" +
          "- For such NPCs, choose a short, setting-appropriate name.\n" +
          "- Use the list of existing NPCs to reuse names if the appearance clearly matches a known character.\n" +
          "- character_summary should be 1–2 sentences (<= 60 words).\n\n" +
          "Respond with STRICT JSON ONLY in this form:\n" +
          "{\n" +
          '  "label": "descriptive noun phrase",\n' +
          "  \"carryable\": true or false,\n" +
          "  \"stow_option_index\": number or null,\n" +
          "  \"options\": [\"option 1\", \"option 2\", \"option 3\", \"option 4\"],\n" +
          "  \"is_character\": true or false,\n" +
          '  "character_name": "short name or null if not a character",\n' +
          '  "character_summary": "1–2 sentence summary or null if not a character"\n' +
          "}";

        const userTextParts = [
          worldText,
          playerSheetText,
          `Canvas size is ${
            body?.canvas_size?.width || 768
          }x${body?.canvas_size?.height || 512}. Cursor at (${x},${y}).`,
          `Current interaction_mode: ${interactionMode}.`,
        ];
        if (priorPrompt) {
          userTextParts.push(
            `Prior scene prompt (hyper-real style):\n${priorPrompt}`
          );
        }
        if (npcs.length) {
          userTextParts.push(
            "Existing NPCs (reuse names if the clicked person matches one of these):\n" +
              npcs
                .map((n) => `- ${n.name}: ${n.summary || ""}`)
                .join("\n")
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
            {
              role: "system",
              content: [{ type: "input_text", text: sys }],
            },
            {
              role: "user",
              content: [
                { type: "input_text", text: userTextParts.join("\n\n") },
                { type: "input_text", text: "Return JSON only; no explanation." },
                { type: "input_image", image_url: marked },
              ],
            },
          ],
        });

        const parsed = extractJson(resp);
        const label = str(parsed.label).trim();
        const options = Array.isArray(parsed.options)
          ? parsed.options
              .slice(0, 4)
              .map((o) => str(o).trim())
              .filter(Boolean)
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
        const character_summary =
          str(parsed.character_summary).trim() || null;

        if (!label) return jsonErr("S201-ID", "Missing label from model");
        if (options.length !== 4)
          return jsonErr("S201-ID", "Expected 4 options from model");

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

    /* ------------------------------------------------------------------ */
    /* op: list_character_items                                           */
    /*  NEW: given a character label + world context, list visible        */
    /*  clothing/accessories/props that can be treated as inventory.      */
    /* ------------------------------------------------------------------ */
    if (op === "list_character_items") {
      const label = str(body.character_label) || "person";

      try {
        const sys =
          "You are assisting a point-and-click role-playing game.\n" +
          "The player has clicked on a specific character and wants to focus on acquiring items from that person's visible clothing, accessories, or handheld objects.\n\n" +
          "Given a description of the character and the world, list 3–6 distinct, visible items that could reasonably be treated as inventory objects (for example: hat, yellow tank top, denim shorts, bracelet, satchel, notebook, pocket watch).\n" +
          "Avoid listing body parts. Only list removable, physical things.\n" +
          "Keep everything consistent with the world/era: no futuristic tech in historical settings, etc.\n" +
          "Respond with STRICT JSON ONLY of the form:\n" +
          '{ "items": ["item 1", "item 2", ...] }';

        const npcText = npcs.length
          ? "Known NPCs so far:\n" +
            npcs.map((n) => `- ${n.name}: ${n.summary || ""}`).join("\n") +
            "\n\n"
          : "";

        const userText =
          worldText +
          playerSheetText +
          npcText +
          `The clicked character is described as: ${label}.\n` +
          "List concrete, visible, removable items on this character that the player might try to acquire.";

        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: [{ type: "input_text", text: sys }] },
            { role: "user", content: [{ type: "input_text", text: userText }] },
          ],
        });

        const parsed = extractJson(resp);
        const itemsRaw = parsed.items;
        const items = Array.isArray(itemsRaw)
          ? itemsRaw
              .map((v) => str(v).trim())
              .filter(Boolean)
          : [];

        if (!items.length) {
          return jsonErr(
            "S210-LOOTLIST",
            "No items returned for character.",
            500
          );
        }

        return json200({ items });
      } catch (e) {
        return jsonErr("S210-LOOTLIST", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* op: gen_followup_image                                             */
    /* ------------------------------------------------------------------ */
    if (op === "gen_followup_image") {
      const label = str(body.clicked_label) || "object";
      const action = str(body.interaction_choice) || "";
      const prior = str(body.prior_prompt) || "A scene.";

      try {
        const sys =
          "You are the narrative and visual director for a point-and-click role-playing game.\n" +
          "Given a prior scene prompt, a clicked object (which may be a specific item of clothing or a prop), a chosen interaction, persistent world constraints, a player-character sheet, and NPC character sheets, you must:\n" +
          "1) Describe the immediate consequence of that choice and the new scene that unfolds.\n" +
          "2) Produce a concrete image generation prompt for the new scene.\n\n" +
          "All scenes must remain consistent with the world constraints.\n" +
          "VISUAL STYLE: always hyper-realistic photograph, 50mm lens, shallow depth of field, high dynamic range, natural cinematic lighting.\n" +
          "By default, keep events realistic; only allow overt magic in worlds that support it.\n" +
          "Narrative: 2–3 short paragraphs (120–220 words).\n" +
          "Respond with STRICT JSON ONLY containing next_prompt, story, clicked_label_for_sprite.";

        const npcText = npcs.length
          ? "NPC character sheets:\n" +
            npcs.map((n) => `- ${n.name}: ${n.summary || ""}`).join("\n") +
            "\n\n"
          : "";

        const userText =
          worldText +
          npcText +
          playerSheetText +
          `Prior scene prompt (hyper-real photo style):\n${prior}\n\n` +
          `The player clicked on: ${label}\n` +
          (action ? `They chose to: ${action}\n\n` : "\n") +
          "Describe what happens as a result and what the player now sees, then provide the new image prompt and optional clicked_label_for_sprite in JSON.";

        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: [{ type: "input_text", text: sys }] },
            { role: "user", content: [{ type: "input_text", text: userText }] },
          ],
        });

        const parsed = extractJson(resp);
        let next_prompt = str(parsed.next_prompt).trim();
        const story_raw = str(parsed.story).trim();
        const clicked_label_for_sprite = parsed.clicked_label_for_sprite;

        if (!next_prompt) {
          next_prompt =
            prior +
            ` Focus on the ${label} and the player action: ${
              action || "interact"
            }, preserving the same hyper-real photographic style and world constraints.`;
        }
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
          quality: reqQuality || "medium",
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64)
          return jsonErr(
            "S301-FOLLOW",
            "No b64_json from follow-up generation"
          );
        const image_url = `data:image/png;base64,${b64}`;

        return json200({ image_url, next_prompt, story, clicked_label_for_sprite });
      } catch (e) {
        return jsonErr("S301-FOLLOW", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* op: make_item_sprite                                               */
    /* ------------------------------------------------------------------ */
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
          quality: reqQuality || "low",
          background: "transparent",
          output_format: "png",
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64)
          return jsonErr(
            "S401-SPRITE",
            "No b64_json from sprite generation"
          );
        const image_url = `data:image/png;base64,${b64}`;
        return json200({ image_url });
      } catch (e) {
        return jsonErr("S401-SPRITE", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* op: change_view                                                    */
    /* ------------------------------------------------------------------ */
    if (op === "change_view") {
      const direction = str(body.direction) || "left";
      const prior = str(body.prior_prompt) || "A scene.";

      try {
        const sys =
          "You are a visual director for a point-and-click role-playing game.\n" +
          "Given a prior scene prompt, a view direction, persistent world constraints, a player-character sheet, and NPC character sheets, you must:\n" +
          "1) Describe how the camera shifts (left/right/up/down/zoom out) while staying in the same location or immediate area.\n" +
          "2) Produce a concrete image generation prompt for the new viewpoint.\n\n" +
          "Always keep world/era consistent and maintain a hyper-realistic photographic style.\n" +
          "Narrative: 2–3 short paragraphs (120–220 words).\n" +
          "Respond with STRICT JSON ONLY containing next_prompt and story.";

        const npcText = npcs.length
          ? "NPC character sheets:\n" +
            npcs.map((n) => `- ${n.name}: ${n.summary || ""}`).join("\n") +
            "\n\n"
          : "";

        const userText =
          worldText +
          npcText +
          playerSheetText +
          `Prior scene prompt (hyper-real photo style):\n${prior}\n\n` +
          `The player chooses to look: ${direction}.\n` +
          "Describe the new view and what is visible, then provide the image prompt in JSON.";

        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: [{ type: "input_text", text: sys }] },
            { role: "user", content: [{ type: "input_text", text: userText }] },
          ],
        });

        const parsed = extractJson(resp);
        let next_prompt = str(parsed.next_prompt).trim();
        const story_raw = str(parsed.story).trim();

        if (!next_prompt) {
          next_prompt =
            prior +
            ` View shifted ${direction}, showing more of the surrounding area, in the same hyper-real photographic style and within the same world constraints.`;
        }
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
          quality: reqQuality || "low",
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64)
          return jsonErr(
            "S501-VIEW",
            "No b64_json from view-change generation"
          );
        const image_url = `data:image/png;base64,${b64}`;

        return json200({ image_url, next_prompt, story });
      } catch (e) {
        return jsonErr("S501-VIEW", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* op: equip_item_on_character                                        */
    /* ------------------------------------------------------------------ */
    if (op === "equip_item_on_character") {
      const itemLabel = str(body.item_label) || "item";
      const click = body.click || {};
      const nx = Number(click.nx);
      const ny = Number(click.ny);
      const equipped_items = Array.isArray(body.equipped_items)
        ? body.equipped_items
        : [];
      const portraitUrl = str(body.current_portrait_url);

      try {
        const sys =
          "You are customizing a player-character portrait for a role-playing game.\n" +
          "Your job is to decide whether an inventory item can be plausibly equipped at a requested location on the body, " +
          "and if so, to describe a new image prompt that shows the same character in the same world with that item equipped.\n\n" +
          "You must obey the persistent world constraints (historical era, technology, clothing) and keep everything hyper-realistic and photographic.\n" +
          "Creative uses are allowed (e.g., a newspaper could be improvised into a skirt), but the result must still be physically possible and visually coherent.\n\n" +
          "If the item clearly replaces an existing equipped item (for example swapping hats, belts, weapons, or handheld objects), " +
          "you should mark the old item as replaced so it can be put back into the backpack.\n\n" +
          "Respond with STRICT JSON ONLY in this form:\n" +
          "{\n" +
          "  \"success\": true or false,\n" +
          "  \"reason\": \"short explanation if success is false\",\n" +
          "  \"next_prompt\": \"image prompt (<= 80 words) for the full-body portrait with the item equipped, if success is true\",\n" +
          "  \"replaced_item_label\": \"name of an item that was replaced, or null if none\"\n" +
          "}";

        const coordText =
          Number.isFinite(nx) && Number.isFinite(ny)
            ? `The player clicked normalized portrait coordinates (x=${nx.toFixed(
                2
              )}, y=${ny.toFixed(
                2
              )}), where x=0,y=0 is top-left and x=1,y=1 is bottom-right.\n`
            : "The player clicked somewhere on the portrait (exact coordinates unavailable).\n";

        const equippedText = equipped_items.length
          ? "Items already equipped on the character: " +
            equipped_items.join(", ") +
            ".\n"
          : "No items are currently tracked as equipped on the character.\n";

        const baseText =
          worldText +
          playerSheetText +
          equippedText +
          `The player wants to equip the inventory item: "${itemLabel}".\n` +
          coordText +
          "Decide if equipping this item at that body area is physically plausible and visually coherent.\n" +
          "- If it is clearly impossible (e.g., item would completely cover the character or defy physics), set success=false and explain why.\n" +
          "- Otherwise set success=true and describe how the item appears: worn, held, draped, strapped on, etc.\n" +
          "If success=true, produce an image prompt that shows the SAME character in the SAME world style, full-body, now with this item equipped. " +
          "Do not change their age, body shape, or general appearance.\n" +
          "If the new item naturally replaces one of the existing equipped_items (for example, a new hat replacing an old hat), set replaced_item_label to that item name; otherwise null.\n" +
          "Use the reference portrait image to keep the character's face, clothing, and pose as consistent as possible.";

        const userContent = [{ type: "input_text", text: baseText }];
        if (portraitUrl) {
          userContent.push({ type: "input_image", image_url: portraitUrl });
        }

        const resp = await openai("responses", {
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: [{ type: "input_text", text: sys }] },
            { role: "user", content: userContent },
          ],
        });

        const parsed = extractJson(resp);
        const success = !!parsed.success;
        const reason = str(parsed.reason);
        let next_prompt = str(parsed.next_prompt).trim();
        const replaced_item_label = parsed.replaced_item_label || null;

        if (!success) {
          return json200({
            equip_success: false,
            reason: reason || "Item incompatible with the character or pose.",
          });
        }

        if (!next_prompt) {
          next_prompt =
            `Full-body portrait of the same player character in the same world, now using or wearing the ${itemLabel} ` +
            "at the requested part of their body, hyper-realistic photograph.";
        }

        if (!next_prompt.toLowerCase().includes("hyper-realistic")) {
          next_prompt += " " + GLOBAL_STYLE;
        }

        const img = await openai("images/generations", {
          model: "gpt-image-1",
          prompt: next_prompt,
          n: 1,
          size: "1024x1536",
          quality: reqQuality || "medium",
        });

        const b64 = img.data?.[0]?.b64_json;
        if (!b64)
          return jsonErr(
            "S701-EQUIP",
            "No b64_json from equip generation"
          );
        const image_url = `data:image/png;base64,${b64}`;

        return json200({
          equip_success: true,
          image_url,
          replaced_item_label,
        });
      } catch (e) {
        return jsonErr("S701-EQUIP", e.message || String(e));
      }
    }

    /* ------------------------------------------------------------------ */
    /* Unknown op                                                         */
    /* ------------------------------------------------------------------ */
    return jsonErr("S000-OP", "Unknown op", 400);
  } catch (err) {
    console.error(err);
    return jsonErr("S000-UNCAUGHT", err.message || String(err), 500);
  }
};
