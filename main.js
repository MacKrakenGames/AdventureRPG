/* main.js — Point & Click role-playing MVP
   Hyper-real camera style + world retention + player character + NPC sheets
   + backpack + equip items on character portrait */

const els = {
  genBtn: document.getElementById("genBtn"),
  confirmBtn: document.getElementById("confirmBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  canvas: document.getElementById("imgCanvas"),
  hud: document.getElementById("hud"),
  choices: document.getElementById("choices"),
  backpackGrid: document.getElementById("backpackGrid"),
  sceneSelect: document.getElementById("sceneSelect"),
  viewLeftBtn: document.getElementById("viewLeftBtn"),
  viewRightBtn: document.getElementById("viewRightBtn"),
  viewUpBtn: document.getElementById("viewUpBtn"),
  viewDownBtn: document.getElementById("viewDownBtn"),
  viewZoomOutBtn: document.getElementById("viewZoomOutBtn"),

  // player character UI
  charAge: document.getElementById("charAge"),
  charSex: document.getElementById("charSex"),
  charWeight: document.getElementById("charWeight"),
  charChest: document.getElementById("charChest"),
  charHips: document.getElementById("charHips"),
  charHairStyle: document.getElementById("charHairStyle"),
  charHairColor: document.getElementById("charHairColor"),
  charEyes: document.getElementById("charEyes"),
  charProfession: document.getElementById("charProfession"),
  charGenBtn: document.getElementById("charGenBtn"),
  charRandomBtn: document.getElementById("charRandomBtn"),
  charAcceptBtn: document.getElementById("charAcceptBtn"),
  playerPortrait: document.getElementById("playerPortrait"),
  playerHint: document.getElementById("playerHint"),
  portraitWrapper: document.getElementById("portraitWrapper"),
  portraitMarker: document.getElementById("portraitMarker"),
  equipBtn: document.getElementById("equipBtn"),
};
const ctx = els.canvas.getContext("2d");

// Logical pixel coordinate system (canvas)
const W = 768, H = 512;

// ---- common style & world descriptions ----
const BASE_STYLE =
  "hyper-realistic photograph, 50mm lens, shallow depth of field, high dynamic range, natural cinematic lighting, camera-quality image, not a painting, not a drawing, not an illustration.";

const SCENE_PROMPTS = {
  magical_school:
    "Hyper-realistic photo of an enchanted boarding school corridor at night, floating candles, portraits whispering, arched stone windows, warm torchlight, students in robes, " +
    BASE_STYLE,
  university:
    "Hyper-realistic photo of a modern university campus quad at dusk, students with backpacks walking and talking, old brick buildings and large trees, soft golden hour light, subtle film grain, " +
    BASE_STYLE,
  western:
    "Hyper-realistic photo of a dusty main street of an 1880s western frontier town at high noon, wooden saloon, hitching posts, horses, sun-bleached signs, distant mountains, warm earthy color palette, " +
    BASE_STYLE,
  private_eye:
    "Hyper-realistic photo of a cramped 1940s private investigator's office at night, venetian blinds casting sharp shadows, desk lamp, cluttered desk with files and whiskey glass, city lights through the window, noir mood, " +
    BASE_STYLE,
};

const WORLD_DESCRIPTIONS = {
  magical_school:
    "This world is a grounded magical boarding school: stone corridors, candles, robes, enchanted objects, and old-fashioned materials. Technology is minimal and mostly pre-digital. Magic is allowed, but visuals remain realistic and photographic.",
  university:
    "This world is a present-day university campus: modern casual clothing, laptops, smartphones, contemporary backpacks and bikes, small cars, realistic architecture. No futuristic devices or historical costumes.",
  western:
    "This world is an 1880s American frontier town in the Old West: wooden buildings, horses, revolvers, telegraph wires, steam trains and wagons. No modern cars, smartphones, plastic signage, or contemporary fashion.",
  private_eye:
    "This world is a 1940s American city in a noir detective story: trench coats, fedoras, cigarette smoke, rotary phones, typewriters, neon signs, and 1930s–1940s cars. No mobile phones, computers, or post-1960s technology.",
};

// ---- Backpack state ----
const BACKPACK_SLOTS = 32;
let backpack = new Array(BACKPACK_SLOTS).fill(null);
backpack[0] = { type: "cursor", label: "Cursor", spriteUrl: null };
let activeSlotIndex = 0;

// ---- NPC registry (experimental character sheets) ----
// npcMap: { [name: string]: { name, summary } }
let npcMap = {};

// ---- Player character state ----
let playerCharacter = null; // sheet object
let playerReady = false;

// ---- Equip-on-character state ----
let equipClick = null;      // { nx, ny } last click on portrait
let equippedItems = [];     // labels currently considered equipped

// ---- Game state ----
let current = {
  prompt: SCENE_PROMPTS.magical_school,
  worldTag: "magical_school",
  imageUrl: "",
  clicked: null,
  labeled: "",
  options: [],
  carryable: false,
  stowOptionIndex: null,
};

function setStatus(s){ els.status.textContent = s; }
function log(msg){
  els.log.textContent += msg + "\n";
  els.log.scrollTop = els.log.scrollHeight;
}
function clearLog(){
  els.log.textContent = "";
  els.hud.textContent = "";
  renderChoices();
}

// JSON helper
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!ct.includes("application/json")) {
    throw new Error(`E000-NONJSON: Non-JSON (${res.status}) from ${url}: ${text.slice(0,200)}`);
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`E000-BADJSON: Invalid JSON: ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(String(data.error || `HTTP ${res.status}`));
  return data;
}

/* ---------------- Backpack helpers ---------------- */

function renderBackpack() {
  els.backpackGrid.innerHTML = "";
  for (let i = 0; i < BACKPACK_SLOTS; i++) {
    const slot = backpack[i];
    const div = document.createElement("div");
    div.className = "backpack-slot";
    if (i === activeSlotIndex) div.classList.add("active");
    div.title = slot ? slot.label : "Empty slot";

    if (slot) {
      if (slot.type === "cursor") {
        const span = document.createElement("span");
        span.textContent = "✛";
        div.appendChild(span);
      } else if (slot.spriteUrl) {
        const img = document.createElement("img");
        img.src = slot.spriteUrl;
        img.alt = slot.label;
        div.appendChild(img);
      } else {
        const span = document.createElement("span");
        span.textContent = slot.label.slice(0, 4);
        div.appendChild(span);
      }
    }

    div.onclick = () => onBackpackSlotClick(i);
    els.backpackGrid.appendChild(div);
  }
}

function onBackpackSlotClick(i) {
  if (!backpack[i]) return;
  activeSlotIndex = i;
  renderBackpack();
  if (i === 0) {
    setStatus("Cursor selected – click the scene, then confirm.");
    els.hud.textContent =
      "You switch to the simple cursor.\nClick in the scene to choose a point, then confirm.";
  } else {
    setStatus(`Using item: ${backpack[i].label}. Click the scene or your portrait, then confirm/equip.`);
    els.hud.textContent =
      `You ready the ${backpack[i].label} from your backpack.\n` +
      `Click in the scene to use it there, or click your character portrait to try equipping it.`;
  }
}

function addToBackpack(label, spriteUrl) {
  for (let i = 1; i < BACKPACK_SLOTS; i++) {
    if (!backpack[i]) {
      backpack[i] = { type: "item", label, spriteUrl };
      renderBackpack();
      return true;
    }
  }
  log("Backpack full: could not add item.");
  return false;
}

function setViewButtonsDisabled(disabled) {
  els.viewLeftBtn.disabled = disabled;
  els.viewRightBtn.disabled = disabled;
  els.viewUpBtn.disabled = disabled;
  els.viewDownBtn.disabled = disabled;
  els.viewZoomOutBtn.disabled = disabled;
}

/* ---------------- NPC helpers ---------------- */

function upsertNpc(name, summary) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return;
  const trimmedSummary = (summary || "").trim();

  if (!npcMap[trimmedName]) {
    npcMap[trimmedName] = { name: trimmedName, summary: trimmedSummary };
  } else if (trimmedSummary && trimmedSummary.length > npcMap[trimmedName].summary.length) {
    npcMap[trimmedName].summary = trimmedSummary;
  }

  const names = Object.keys(npcMap);
  if (names.length > 4) {
    delete npcMap[names[0]];
  }
}

function getNpcArray() {
  return Object.values(npcMap);
}

/* ---------------- Player character helpers ---------------- */

function getPlayerCharacterFromUI() {
  return {
    age_range: els.charAge.value,
    sex: els.charSex.value,
    weight_range: els.charWeight.value,
    chest_size: els.charChest.value,
    hip_size: els.charHips.value,
    hair_style: els.charHairStyle.value,
    hair_color: els.charHairColor.value,
    eye_color: els.charEyes.value,
    profession: els.charProfession.value,
  };
}

function randomOption(selectEl) {
  const n = selectEl.options.length;
  const idx = Math.floor(Math.random() * n);
  selectEl.selectedIndex = idx;
}

function randomizePlayerCharacterUI() {
  randomOption(els.charAge);
  randomOption(els.charSex);
  randomOption(els.charWeight);
  randomOption(els.charChest);
  randomOption(els.charHips);
  randomOption(els.charHairStyle);
  randomOption(els.charHairColor);
  randomOption(els.charEyes);
  randomOption(els.charProfession);
}

/* ---- Generate player portrait ---- */

async function generatePlayerPortrait(isRandom) {
  try {
    if (isRandom) {
      randomizePlayerCharacterUI();
    }
    const worldTag = els.sceneSelect.value || "magical_school";
    const sheet = getPlayerCharacterFromUI();

    setStatus("Generating player portrait…");
    els.charGenBtn.disabled = true;
    els.charRandomBtn.disabled = true;
    els.charAcceptBtn.disabled = true;

    const resp = await postJSON("/.netlify/functions/openai", {
      op: "gen_player_portrait",
      world_tag: worldTag,
      world_description: WORLD_DESCRIPTIONS[worldTag],
      player_character: sheet,
    });

    if (!resp.image_url) {
      throw new Error("E601-CHAR: Missing image_url for portrait");
    }

    playerCharacter = sheet;
    playerReady = false; // must explicitly accept
    els.playerPortrait.src = resp.image_url;
    els.playerHint.textContent =
      "Portrait generated. If you like this character, click “Use this character”. Otherwise, tweak options or randomize again.";
    els.charAcceptBtn.disabled = false;

    // reset equip state
    equippedItems = [];
    equipClick = null;
    els.portraitMarker.style.display = "none";
    els.equipBtn.disabled = true;

    setStatus("Portrait ready. Accept to enter the world.");
  } catch (e) {
    log(String(e));
    setStatus("Error while generating portrait.");
  } finally {
    els.charGenBtn.disabled = false;
    els.charRandomBtn.disabled = false;
  }
}

function acceptPlayerCharacter() {
  if (!playerCharacter || !els.playerPortrait.src) {
    setStatus("Generate a portrait first.");
    return;
  }
  playerReady = true;
  els.charAcceptBtn.disabled = true;
  els.genBtn.disabled = false;
  setStatus("Character locked in. You can now enter the scene.");
  els.playerHint.textContent =
    "Character locked. You can still reset the run to start over with a new character.";
}

/* ---------------- Step 1: generate base scene ---------------- */

async function generateImage() {
  if (!playerReady || !playerCharacter) {
    setStatus("Create and accept a player character before entering the scene.");
    log("E101-GEN: Player character not ready.");
    return;
  }

  try {
    const key = els.sceneSelect.value || "magical_school";
    current.worldTag = key;
    current.prompt = SCENE_PROMPTS[key] || SCENE_PROMPTS.magical_school;

    setStatus("Generating scene…");
    els.genBtn.disabled = true;
    els.confirmBtn.disabled = true;
    setViewButtonsDisabled(true);

    current.clicked = null;
    current.labeled = "";
    current.options = [];
    current.carryable = false;
    current.stowOptionIndex = null;

    ctx.clearRect(0,0,W,H);
    clearLog();

    const out = await postJSON("/.netlify/functions/openai", {
      op: "gen_image",
      prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      player_character: playerCharacter,
    });
    if (!out.image_url) throw new Error("E101-GEN: Missing image_url");
    current.imageUrl = out.image_url;

    els.hud.textContent =
      "You step into a new hyper-real scene in this world.\n\n" +
      "Click anywhere in the image to pick a point of interest, then press “4) Confirm selection” " +
      "to explore what that part of the scene represents.";

    await drawImageToCanvas(current.imageUrl);
    els.confirmBtn.disabled = false;
    setViewButtonsDisabled(false);
    setStatus("Image ready – click to select, then confirm.");
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    els.genBtn.disabled = false;
  }
}

/* ---------------- Draw image into canvas ---------------- */

async function drawImageToCanvas(url) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          ctx.clearRect(0,0,W,H);
          const rImg = img.width / img.height;
          const rCan = W / H;
          let dw, dh, dx, dy;
          if (rImg > rCan) {
            dw = W;
            dh = Math.round(W / rImg);
            dx = 0;
            dy = Math.round((H - dh)/2);
          } else {
            dh = H;
            dw = Math.round(H * rImg);
            dy = 0;
            dx = Math.round((W - dw)/2);
          }
          ctx.drawImage(img, dx, dy, dw, dh);
          resolve();
        } catch {
          reject(new Error("E111-DRAW: Canvas draw failed"));
        }
      };
      img.onerror = () => reject(new Error("E111-DRAW: Image failed to load"));
      img.src = url;
    } catch {
      reject(new Error("E111-DRAW: Unexpected draw error"));
    }
  });
}

/* ---------------- Step 3: on scene click, record coords ---------------- */

async function onCanvasClick(evt) {
  if (!current.imageUrl) {
    log("E121-CLICK: Click ignored; no image yet");
    return;
  }

  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) * (W / rect.width));
  const y = Math.floor((evt.clientY - rect.top) * (H / rect.height));
  current.clicked = { x, y };
  current.options = [];
  current.carryable = false;
  current.stowOptionIndex = null;
  renderChoices();

  log(`Selection: (${x}, ${y})`);

  const activeTool = backpack[activeSlotIndex];
  if (activeTool && activeTool.type === "item") {
    setStatus(`Using ${activeTool.label} at (${x}, ${y}) – press confirm.`);
    els.hud.textContent =
      `You ready the ${activeTool.label} and focus it on the scene at (${x}, ${y}).\n\n` +
      "Press “4) Confirm selection” to see how the scene responds to this action.";
  } else {
    setStatus(`Selection at (${x}, ${y}) – press confirm.`);
    els.hud.textContent =
      `You mark a point at (${x}, ${y}).\n\n` +
      "Press “4) Confirm selection” to discover how this part of the scene might be described or interacted with.";
  }

  try {
    els.confirmBtn.disabled = true;
    await redrawImageWithCursor(x, y);
    els.confirmBtn.disabled = false;
  } catch (e) {
    log("E131-CURSOR: " + String(e));
    els.confirmBtn.disabled = true;
  }
}

/* ---------------- Portrait click: choose equip spot ---------------- */

function onPortraitClick(evt) {
  if (!playerCharacter || !els.playerPortrait.src) {
    setStatus("Generate and accept a character first.");
    return;
  }

  const active = backpack[activeSlotIndex];
  if (!active || active.type !== "item") {
    setStatus("Select an item from the backpack to equip first.");
    els.playerHint.textContent =
      "To equip something, click a backpack item (not the cursor) and then click on your character.";
    return;
  }

  const rect = els.portraitWrapper.getBoundingClientRect();
  const nx = (evt.clientX - rect.left) / rect.width;
  const ny = (evt.clientY - rect.top) / rect.height;
  equipClick = { nx, ny };

  // show marker
  els.portraitMarker.style.display = "block";
  els.portraitMarker.style.left = (nx * 100) + "%";
  els.portraitMarker.style.top = (ny * 100) + "%";

  els.equipBtn.disabled = false;

  setStatus(`Equip ${active.label} at this spot on your character, then click “Equip selected item on character”.`);
  els.playerHint.textContent =
    `You marked a spot on your character for the ${active.label}. ` +
    `Click “Equip selected item on character” to try putting it there.`;
}

/* ---------------- Draw cursor ---------------- */

function drawCursor(x, y) {
  const R = 6;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.arc(x, y, R + 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 12, y);
  ctx.lineTo(x + 12, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x, y + 12);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

async function redrawImageWithCursor(x, y) {
  if (!current.imageUrl) return;
  await drawImageToCanvas(current.imageUrl);
  drawCursor(x, y);
}

/* ---------------- Step 5: confirm selection → identify + options ---------------- */

async function onConfirmSelection() {
  if (!current.imageUrl) {
    log("E201-ID: No image loaded – generate one first");
    return;
  }
  if (!current.clicked) {
    log("E201-ID: No selection made – click on the image first");
    return;
  }

  try {
    setStatus("Analyzing selection…");
    els.confirmBtn.disabled = true;
    els.genBtn.disabled = true;
    setViewButtonsDisabled(true);

    let markedDataUrl;
    try {
      markedDataUrl = els.canvas.toDataURL("image/png");
    } catch {
      throw new Error("E131-CURSOR: Canvas export failed");
    }

    const { x, y } = current.clicked;
    const activeTool = backpack[activeSlotIndex];
    const heldItemLabel =
      activeTool && activeTool.type === "item" ? activeTool.label : null;

    const idResp = await postJSON("/.netlify/functions/openai", {
      op: "identify_click",
      original_url: current.imageUrl,
      marked_image_data_url: markedDataUrl,
      x, y,
      canvas_size: { width: W, height: H },
      held_item_label: heldItemLabel,
      prior_prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      npcs: getNpcArray(),
      player_character: playerCharacter,
    }).catch(e => { throw new Error("E201-ID: " + String(e)); });

    if (!idResp.label) throw new Error("E201-ID: No label from vision");
    if (!Array.isArray(idResp.options) || idResp.options.length === 0) {
      throw new Error("E201-ID: No options returned");
    }

    current.labeled = idResp.label;
    current.options = idResp.options;
    current.carryable = !!idResp.carryable;
    current.stowOptionIndex =
      Number.isInteger(idResp.stow_option_index) ? idResp.stow_option_index : null;

    if (idResp.is_character && idResp.character_name) {
      upsertNpc(idResp.character_name, idResp.character_summary || "");
      log(`NPC updated: ${idResp.character_name}`);
    }

    log(`Identified selection as: "${current.labeled}"`);
    log("Options:\n - " + current.options.join("\n - "));

    els.hud.textContent =
      `You focus on: ${current.labeled}.\n\n` +
      "Below are several ways you might choose to interact with this part of the scene. " +
      "Pick the option that best matches the role you want to play.";

    renderChoices();

    if (heldItemLabel) {
      setStatus(`Choose how to use the ${heldItemLabel} on the ${current.labeled}.`);
    } else {
      setStatus(`Choose how to interact with the ${current.labeled}.`);
    }
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    els.genBtn.disabled = false;
    setViewButtonsDisabled(false);
  }
}

/* ---------------- Step 6: choose option → new scene + story ---------------- */

async function onChooseOption(index) {
  if (!current.labeled) {
    log("E301-FOLLOW: No labeled selection yet");
    return;
  }
  if (!current.options || !current.options[index]) {
    log("E301-FOLLOW: Invalid option index");
    return;
  }

  const optionText = current.options[index];
  const isStow =
    current.carryable &&
    current.stowOptionIndex !== null &&
    index === current.stowOptionIndex;

  try {
    setStatus("Playing out your choice…");
    els.genBtn.disabled = true;
    els.confirmBtn.disabled = true;
    disableChoiceButtons(true);
    setViewButtonsDisabled(true);

    const follow = await postJSON("/.netlify/functions/openai", {
      op: "gen_followup_image",
      clicked_label: current.labeled,
      interaction_choice: optionText,
      prior_prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      npcs: getNpcArray(),
      player_character: playerCharacter,
    }).catch(e => { throw new Error("E301-FOLLOW: " + String(e)); });

    if (!follow.image_url) throw new Error("E301-FOLLOW: Missing image_url");

    current.imageUrl = follow.image_url;
    current.prompt = follow.next_prompt || current.prompt;
    current.clicked = null;
    const story = follow.story || "";
    const storyTrim = story.trim();

    log(`New scene created from choice:\n"${optionText}"`);
    if (storyTrim) {
      log("Story:\n" + storyTrim);
    }

    current.labeled = "";
    current.options = [];
    current.carryable = false;
    current.stowOptionIndex = null;
    renderChoices();

    els.hud.textContent =
      (storyTrim
        ? storyTrim + "\n\n"
        : "") +
      "Click somewhere in this new scene when you’re ready to make your next choice.";

    await drawImageToCanvas(current.imageUrl);
    setStatus("New scene ready – click to select, then confirm");

    if (isStow && follow.clicked_label_for_sprite !== false) {
      try {
        const spriteResp = await postJSON("/.netlify/functions/openai", {
          op: "make_item_sprite",
          item_label: follow.clicked_label_for_sprite || follow.clicked_label || current.labeled
        });
        if (spriteResp.image_url) {
          const labelForBackpack = follow.clicked_label_for_sprite || follow.clicked_label || "Item";
          addToBackpack(labelForBackpack, spriteResp.image_url);
          log(`Added "${labelForBackpack}" to backpack.`);
        }
      } catch (e) {
        log("E401-SPRITE: " + String(e));
      }
    }
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    els.genBtn.disabled = false;
    setViewButtonsDisabled(false);
  }
}

function disableChoiceButtons(disabled) {
  const buttons = els.choices.querySelectorAll("button");
  buttons.forEach(b => b.disabled = disabled);
}

/* ---------------- Equip: send to backend ---------------- */

async function onEquipItem() {
  const active = backpack[activeSlotIndex];
  if (!active || active.type !== "item") {
    setStatus("Select an item from the backpack first.");
    return;
  }
  if (!playerCharacter || !els.playerPortrait.src) {
    setStatus("Generate and accept a character first.");
    return;
  }
  if (!equipClick) {
    setStatus("Click on the character portrait to choose where to equip the item.");
    return;
  }

  try {
    setStatus("Trying to equip item on your character…");
    els.equipBtn.disabled = true;

    const resp = await postJSON("/.netlify/functions/openai", {
      op: "equip_item_on_character",
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      player_character: playerCharacter,
      current_portrait_url: els.playerPortrait.src,
      item_label: active.label,
      click: equipClick,
      equipped_items: equippedItems,
    });

    if (!resp) throw new Error("E701-EQUIP: Empty response");

    if (!resp.equip_success) {
      const reason = resp.reason || "Item could not be equipped.";
      setStatus("Equip failed.");
      els.playerHint.textContent = `Equip failed: ${reason}`;
      log(`Equip failed for ${active.label}: ${reason}`);
      return;
    }

    if (!resp.image_url) throw new Error("E701-EQUIP: Missing image_url from server");

    // success – update portrait and item state
    els.playerPortrait.src = resp.image_url;
    log(`Equipped ${active.label} on character.`);
    els.playerHint.textContent =
      `The ${active.label} is now equipped on your character. Click on them again to place more items.`;

    equippedItems.push(active.label);

    if (resp.replaced_item_label) {
      const rep = resp.replaced_item_label;
      equippedItems = equippedItems.filter(l => l !== rep);
      addToBackpack(rep, null);
      log(`Replaced item: ${rep} (added to backpack).`);
    }

    // remove equipped item from backpack and reset selection
    backpack[activeSlotIndex] = null;
    activeSlotIndex = 0;
    renderBackpack();

    // clear marker
    equipClick = null;
    els.portraitMarker.style.display = "none";
    els.equipBtn.disabled = true;

    setStatus("Item equipped. Select another item or continue exploring scenes.");
  } catch (e) {
    setStatus("Error equipping item.");
    log(String(e));
  }
}

/* ---------------- Camera / view navigation ---------------- */

async function onChangeView(direction) {
  if (!current.prompt || !current.imageUrl) {
    log("E501-VIEW: No scene yet – generate one first");
    return;
  }

  try {
    setStatus(`Shifting your viewpoint ${direction.replace("_", " ")}…`);
    els.genBtn.disabled = true;
    els.confirmBtn.disabled = true;
    setViewButtonsDisabled(true);
    disableChoiceButtons(true);

    const resp = await postJSON("/.netlify/functions/openai", {
      op: "change_view",
      direction,
      prior_prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      npcs: getNpcArray(),
      player_character: playerCharacter,
    }).catch(e => { throw new Error("E501-VIEW: " + String(e)); });

    if (!resp.image_url) throw new Error("E501-VIEW: Missing image_url");

    current.imageUrl = resp.image_url;
    current.prompt = resp.next_prompt || current.prompt;
    current.clicked = null;
    current.labeled = "";
    current.options = [];
    current.carryable = false;
    current.stowOptionIndex = null;
    renderChoices();

    const story = (resp.story || "").trim();
    if (story) {
      log(`View shift (${direction}):\n${story}`);
      els.hud.textContent =
        story + "\n\nClick somewhere in this new viewpoint to keep role-playing.";
    } else {
      els.hud.textContent =
        `You adjust your view ${direction}.\n\n` +
        "Click somewhere in this new vantage point to decide what you pay attention to next.";
    }

    await drawImageToCanvas(current.imageUrl);
    setStatus("New viewpoint ready – click to select, then confirm");
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    els.genBtn.disabled = false;
    setViewButtonsDisabled(false);
  }
}

/* ---------------- render choices ---------------- */

function renderChoices() {
  els.choices.innerHTML = "";
  if (!current.options || current.options.length === 0) return;

  const labelEl = document.createElement("div");
  labelEl.textContent = `How do you interact with the ${current.labeled || "selection"}?`;
  els.choices.appendChild(labelEl);

  current.options.forEach((opt, idx) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = opt;
    b.onclick = () => onChooseOption(idx);
    els.choices.appendChild(b);
  });
}

/* ---------------- wiring ---------------- */

els.genBtn.onclick = generateImage;
els.confirmBtn.onclick = onConfirmSelection;
els.resetBtn.onclick = () => {
  const w = els.sceneSelect.value || "magical_school";
  current = {
    prompt: SCENE_PROMPTS[w] || SCENE_PROMPTS.magical_school,
    worldTag: w,
    imageUrl: "",
    clicked: null,
    labeled: "",
    options: [],
    carryable: false,
    stowOptionIndex: null,
  };
  backpack = new Array(BACKPACK_SLOTS).fill(null);
  backpack[0] = { type: "cursor", label: "Cursor", spriteUrl: null };
  activeSlotIndex = 0;
  npcMap = {};
  playerCharacter = null;
  playerReady = false;
  els.playerPortrait.src = "";
  els.playerHint.textContent = "No portrait yet. Generate or randomize to see your character.";
  els.charAcceptBtn.disabled = true;
  els.genBtn.disabled = true;

  equippedItems = [];
  equipClick = null;
  els.portraitMarker.style.display = "none";
  els.equipBtn.disabled = true;

  ctx.clearRect(0,0,W,H);
  clearLog();
  renderBackpack();
  els.confirmBtn.disabled = true;
  setViewButtonsDisabled(true);
  setStatus("Pick a world, then create your character.");
};

els.canvas.addEventListener("click", onCanvasClick);
els.portraitWrapper.addEventListener("click", onPortraitClick);
els.viewLeftBtn.onclick = () => onChangeView("left");
els.viewRightBtn.onclick = () => onChangeView("right");
els.viewUpBtn.onclick = () => onChangeView("up");
els.viewDownBtn.onclick = () => onChangeView("down");
els.viewZoomOutBtn.onclick = () => onChangeView("zoom_out");

// player character events
els.charGenBtn.onclick = () => generatePlayerPortrait(false);
els.charRandomBtn.onclick = () => generatePlayerPortrait(true);
els.charAcceptBtn.onclick = acceptPlayerCharacter;
els.equipBtn.onclick = onEquipItem;

// Initial render
renderBackpack();
setViewButtonsDisabled(true);
els.genBtn.disabled = true;
