// main.js
// Frontend logic for the role-playing point-and-click MVP

// Canvas size (keep in sync with CSS)
const W = 512;
const H = 512;

// DOM references
const els = {
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  canvas: document.getElementById("imgCanvas"),
  hud: document.getElementById("hud"),
  choices: document.getElementById("choices"),
  sceneSelect: document.getElementById("sceneSelect"),

  genBtn: document.getElementById("genBtn"),
  confirmBtn: document.getElementById("confirmBtn"),
  resetBtn: document.getElementById("resetBtn"),

  viewLeftBtn: document.getElementById("viewLeftBtn"),
  viewRightBtn: document.getElementById("viewRightBtn"),
  viewUpBtn: document.getElementById("viewUpBtn"),
  viewDownBtn: document.getElementById("viewDownBtn"),
  viewZoomOutBtn: document.getElementById("viewZoomOutBtn"),

  backpackGrid: document.getElementById("backpackGrid"),
  interactRow: document.getElementById("interactRow"),

  // quality selector
  imgQuality: document.getElementById("imgQuality"),

  // Player character creator
  ageRange: document.getElementById("ageRange"),
  sex: document.getElementById("sex"),
  weightRange: document.getElementById("weightRange"),
  chestSize: document.getElementById("chestSize"),
  hipSize: document.getElementById("hipSize"),
  hairStyle: document.getElementById("hairStyle"),
  hairColor: document.getElementById("hairColor"),
  eyeColor: document.getElementById("eyeColor"),
  profession: document.getElementById("profession"),

  genPortraitBtn: document.getElementById("genPortraitBtn"),
  randomCharacterBtn: document.getElementById("randomCharacterBtn"),
  useCharacterBtn: document.getElementById("useCharacterBtn"),
  playerPortrait: document.getElementById("playerPortrait"),
  playerCreatorForm: document.getElementById("playerCreatorForm"),
};

// Canvas 2D context
const ctx = els.canvas.getContext("2d");
els.canvas.width = W;
els.canvas.height = H;

// Simple logging helpers
function setStatus(msg) {
  els.status.textContent = msg;
}
function log(msg) {
  const line = document.createElement("div");
  line.textContent = msg;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}
function clearLog() {
  els.log.textContent = "";
}

// Quality helper
function getQuality() {
  return els.imgQuality?.value || "medium";
}

// POST helper with basic error mapping
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  if (!res.ok) {
    const msg = json?.error || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json || {};
}

/* ------------------------------------------------------------------ */
/* World configuration                                                */
/* ------------------------------------------------------------------ */

const WORLD_DESCRIPTIONS = {
  western:
    "A dusty 1880s American frontier town with wooden buildings, dirt streets, horses, and period-appropriate clothing. No modern technology.",
  university:
    "A present-day university campus with lawns, brick buildings, backpacks, and modern casual clothing.",
  magical_school:
    "A grounded magical boarding school. Castle-like campus, robes or academic attire with subtle mystical touches, but still photographed realistically.",
  private_eye:
    "A 1940s American city in noir style: trench coats, fedoras, alleyways, neon signs, and smoky bars. No modern tech.",
};

const WORLD_STARTERS = {
  western:
    "You are standing on the main street of a small western frontier town. Weathered wooden storefronts line the dusty road, horses are tied to hitching posts, and townsfolk move about their business.",
  university:
    "You are standing on a modern university quad on a pleasant day. Students lounge on the grass, chat in small groups, and carry backpacks between classes.",
  magical_school:
    "You are in a stone courtyard of a magical boarding school. Robed students move under archways, carrying books and odd artifacts.",
  private_eye:
    "You are in a rain-slicked alley in a 1940s city, neon signs flickering above. The air smells like cigarette smoke and city grime.",
};

/* ------------------------------------------------------------------ */
/* Global state                                                       */
/* ------------------------------------------------------------------ */

let current = {
  worldTag: "western",
  prompt: "",
  imageUrl: null,
  clicked: null,
  labeled: null,
  options: [],
  carryable: false,
  stowOptionIndex: null,
  story: "",
  isCharacter: false,
  characterName: null,
  characterSummary: null,
  lootItemLabels: null, // when we generate per-character loot options
};

let playerCharacter = null; // object from character creator
let npcs = []; // [{ name, summary }]

// Interaction modes (4-slot bar)
const INTERACTION_MODES = ["wildcard", "pickup", "dialogue", "move"];
let activeInteractionMode = "wildcard";

// Backpack: 32 slots, now ONLY items
const BACKPACK_SLOTS = 32;
let backpack = new Array(BACKPACK_SLOTS).fill(null);
// activeSlotIndex: which backpack item is currently "in hand"
let activeSlotIndex = null;

// Equipped items on player portrait (labels only)
let equippedItems = [];

// Remember last equip click for the portrait
let equipClick = null;

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                  */
/* ------------------------------------------------------------------ */

function renderInteractModes() {
  const buttons = document.querySelectorAll("#interactRow .interact-slot");
  buttons.forEach((btn) => {
    const mode = btn.dataset.mode;
    if (mode === activeInteractionMode) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

function renderBackpack() {
  els.backpackGrid.innerHTML = "";
  for (let i = 0; i < BACKPACK_SLOTS; i++) {
    const slot = backpack[i];
    const div = document.createElement("div");
    div.className = "backpack-slot";
    if (activeSlotIndex === i) div.classList.add("active");
    div.title = slot ? slot.label : "Empty slot";

    if (slot) {
      if (slot.spriteUrl) {
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

function renderChoices() {
  els.choices.innerHTML = "";
  current.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = opt;
    btn.onclick = () => onChooseOption(idx);
    els.choices.appendChild(btn);
  });
}

function drawPlaceholder() {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#64748b";
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Generate an image to begin.", W / 2, H / 2);
}

/* ------------------------------------------------------------------ */
/* NPC helpers                                                        */
/* ------------------------------------------------------------------ */

function getNpcArray() {
  return npcs.slice();
}

function upsertNpc(name, summary) {
  if (!name) return;
  const i = npcs.findIndex((n) => n.name === name);
  if (i >= 0) {
    if (summary) npcs[i].summary = summary;
  } else {
    npcs.push({ name, summary: summary || "" });
  }
}

/* ------------------------------------------------------------------ */
/* Backpack & interact bar behaviour                                  */
/* ------------------------------------------------------------------ */

function firstEmptyBackpackSlot() {
  for (let i = 0; i < BACKPACK_SLOTS; i++) {
    if (!backpack[i]) return i;
  }
  return -1;
}

function onBackpackSlotClick(i) {
  const slot = backpack[i];
  if (!slot) return;

  if (activeSlotIndex === i) {
    activeSlotIndex = null;
  } else {
    activeSlotIndex = i;
  }
  renderBackpack();

  const active = activeSlotIndex != null ? backpack[activeSlotIndex] : null;
  if (!active) {
    setStatus("No item selected from the backpack.");
    els.hud.textContent =
      "You put your backpacked items away for now.\n" +
      "You can still interact using the mode bar above.";
    return;
  }

  setStatus(`Using item: ${active.label}. Click the scene or your portrait, then confirm/equip.`);
  els.hud.textContent =
    `You ready the ${active.label} from your backpack.\n` +
    `Click in the scene to use it there, or click your character portrait to try equipping it.`;
}

/* ------------------------------------------------------------------ */
/* Buttons: world view controls                                       */
/* ------------------------------------------------------------------ */

function setViewButtonsDisabled(disabled) {
  els.viewLeftBtn.disabled = disabled;
  els.viewRightBtn.disabled = disabled;
  els.viewUpBtn.disabled = disabled;
  els.viewDownBtn.disabled = disabled;
  els.viewZoomOutBtn.disabled = disabled;
}

/* ------------------------------------------------------------------ */
/* Scene generation                                                   */
/* ------------------------------------------------------------------ */

async function generateImage() {
  clearLog();
  current.worldTag = els.sceneSelect.value || "western";
  setStatus("Generating starting scene image…");
  els.genBtn.disabled = true;
  els.confirmBtn.disabled = true;

  const starter = WORLD_STARTERS[current.worldTag] || WORLD_STARTERS.western;
  const basePrompt = `${starter} Hyper-realistic photograph, camera-quality image.`;
  current.prompt = basePrompt;

  try {
    const out = await postJSON("/.netlify/functions/openai", {
      op: "gen_image",
      prompt: basePrompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      player_character: playerCharacter,
      quality: getQuality(),
    });

    current.imageUrl = out.image_url;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
    };
    img.src = current.imageUrl;
    setStatus("Scene generated. Click somewhere, then confirm to interact.");
    els.hud.textContent =
      "You arrive in this world. Click on anything that interests you, then press “4) Confirm selection”.";
    setViewButtonsDisabled(false);
    els.confirmBtn.disabled = true;
  } catch (e) {
    log("S101-GEN: " + String(e));
    setStatus("Error generating starting scene. See console.");
  } finally {
    els.genBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Canvas click & cursor overlay                                      */
/* ------------------------------------------------------------------ */

async function redrawImageWithCursor(x, y) {
  if (!current.imageUrl) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, W, H);
    // Draw crosshair
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
  };
  img.src = current.imageUrl;
}

async function onCanvasClick(evt) {
  if (!current.imageUrl) {
    log("E121-CLICK: Click ignored; no image yet");
    return;
  }

  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor(((evt.clientX - rect.left) / rect.width) * W);
  const y = Math.floor(((evt.clientY - rect.top) / rect.height) * H);
  current.clicked = { x, y };
  current.options = [];
  current.carryable = false;
  current.stowOptionIndex = null;
  current.lootItemLabels = null;
  renderChoices();

  const heldItem = activeSlotIndex != null ? backpack[activeSlotIndex] : null;

  const mode = activeInteractionMode;
  let modeLabel;
  switch (mode) {
    case "pickup":
      modeLabel = "pick-up";
      break;
    case "dialogue":
      modeLabel = "dialogue";
      break;
    case "move":
      modeLabel = "move-to";
      break;
    default:
      modeLabel = "wildcard";
      break;
  }

  log(`Selection: (${x}, ${y}) in ${mode} mode`);

  if (heldItem) {
    setStatus(`Using ${heldItem.label} in ${modeLabel} mode at (${x}, ${y}) – press confirm.`);
    els.hud.textContent =
      `You ready the ${heldItem.label} in ${modeLabel} mode and focus it on the scene at (${x}, ${y}).\n\n` +
      "Press “4) Confirm selection” to see how the scene responds to this choice.";
  } else {
    let expl;
    if (mode === "pickup") {
      expl =
        "You mark a spot where you might reach for a small object—or something a person is wearing—to carry.\n\n" +
        "Press “4) Confirm selection” to see what might be taken here.";
    } else if (mode === "dialogue") {
      expl =
        "You mark a spot where you might address someone or draw attention.\n\n" +
        "Press “4) Confirm selection” to see who might respond.";
    } else if (mode === "move") {
      expl =
        "You mark a place you might walk toward.\n\n" +
        "Press “4) Confirm selection” to see what it’s like to move there.";
    } else {
      expl =
        "You mark a general point of interest.\n\n" +
        "Press “4) Confirm selection” to explore what this part of the scene represents.";
    }

    setStatus(`Selection at (${x}, ${y}) in ${modeLabel} mode – press confirm.`);
    els.hud.textContent = expl;
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

/* ------------------------------------------------------------------ */
/* Confirm selection: identify click, possibly branch into            */
/* character-item targeting in pickup mode                            */
/* ------------------------------------------------------------------ */

async function onConfirmSelection() {
  if (!current.imageUrl || !current.clicked) return;

  els.confirmBtn.disabled = true;
  setStatus("Identifying your selection…");
  const { x, y } = current.clicked;

  // Get marked image data URL from canvas
  const markedDataUrl = els.canvas.toDataURL("image/png");

  const activeTool = activeSlotIndex != null ? backpack[activeSlotIndex] : null;
  const heldItemLabel =
    activeTool && activeTool.type === "item" ? activeTool.label : null;

  try {
    const idResp = await postJSON("/.netlify/functions/openai", {
      op: "identify_click",
      original_url: current.imageUrl,
      marked_image_data_url: markedDataUrl,
      x,
      y,
      canvas_size: { width: W, height: H },
      held_item_label: heldItemLabel,
      interaction_mode: activeInteractionMode,
      prior_prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      npcs: getNpcArray(),
      player_character: playerCharacter,
    });

    const {
      label,
      options,
      carryable,
      stow_option_index,
      is_character,
      character_name,
      character_summary,
    } = idResp;

    current.labeled = label;
    current.carryable = carryable;
    current.stowOptionIndex = stow_option_index;
    current.isCharacter = is_character;
    current.characterName = character_name || null;
    current.characterSummary = character_summary || null;
    current.lootItemLabels = null;

    if (is_character && character_name) {
      upsertNpc(character_name, character_summary);
    }

    log(`Identified selection as: "${label}"`);

    // SPECIAL BRANCH:
    // If we are in PICKUP mode, no held tool, and the target is a CHARACTER,
    // we ask a second helper which *specific* visible items can be looted.
    if (
      activeInteractionMode === "pickup" &&
      !heldItemLabel &&
      is_character
    ) {
      setStatus(
        `You focus on: ${label}. Asking what visible items you might try to take…`
      );

      let items = [];
      try {
        const lootResp = await postJSON("/.netlify/functions/openai", {
          op: "list_character_items",
          character_label: label,
          world_tag: current.worldTag,
          world_description: WORLD_DESCRIPTIONS[current.worldTag],
          npcs: getNpcArray(),
          player_character: playerCharacter,
        });
        items = Array.isArray(lootResp.items) ? lootResp.items.slice(0, 4) : [];
      } catch (e) {
        log("E210-LOOTLIST: " + String(e));
      }

      if (items.length) {
        // Build options that map 1:1 to loot items
        current.lootItemLabels = items;
        current.options = items.map(
          (it) => `Try to quietly take the ${it} and add it to your belongings.`
        );
        current.stowOptionIndex = null; // not using auto-stow index here
        current.carryable = true;

        els.hud.textContent =
          `You study ${label}, considering what you might walk away with.\n\n` +
          "Choose which specific thing you want to target. Your choice may have social consequences.";
        renderChoices();
        setStatus(
          `You focus on: ${label}. Choose a specific item to try to acquire.`
        );
        els.confirmBtn.disabled = true;
        return;
      }

      // If helper failed, fall back to generic options
      log("No specific character items returned; falling back to generic pickup options.");
    }

    // Default path: use options from identify_click
    current.options = options;
    renderChoices();

    setStatus(`You focus on: ${label}. Choose how you wish to interact with it.`);
    els.hud.textContent =
      `You focus on: ${label}.\n\n` +
      "Below are several ways you might choose to interact with this part of the scene. " +
      "Pick the option that best matches the role you want to play.";
  } catch (e) {
    log("E201-ID: " + String(e));
    setStatus("Error identifying click. See console.");
  } finally {
    els.confirmBtn.disabled = true;
  }
}

/* ------------------------------------------------------------------ */
/* Option selection                                                   */
/* ------------------------------------------------------------------ */

async function onChooseOption(idx) {
  if (!current.options || idx < 0 || idx >= current.options.length) return;

  const optionText = current.options[idx];
  const usingLootTargetMode =
    current.lootItemLabels &&
    current.lootItemLabels.length &&
    activeInteractionMode === "pickup" &&
    current.isCharacter;

  setStatus("Creating a new scene from your choice…");
  els.genBtn.disabled = true;
  els.confirmBtn.disabled = true;

  try {
    let clickedLabelForFollow = current.labeled;

    // If we are in special character-loot mode, remap clickedLabel to the specific item
    if (usingLootTargetMode) {
      clickedLabelForFollow = current.lootItemLabels[idx];
    }

    const follow = await postJSON("/.netlify/functions/openai", {
      op: "gen_followup_image",
      clicked_label: clickedLabelForFollow,
      interaction_choice: optionText,
      prior_prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      npcs: getNpcArray(),
      player_character: playerCharacter,
      quality: getQuality(),
    });

    current.prompt = follow.next_prompt || current.prompt;
    current.imageUrl = follow.image_url;
    current.story = follow.story || "";

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
    };
    img.src = current.imageUrl;

    // HUD story text goes below image in HTML
    els.hud.textContent = current.story || "";

    log(
      `New scene created from selection "${clickedLabelForFollow}" with choice "${optionText}".`
    );

    // Backpack handling:
    // 1) If we are in special character-loot mode: always treat as stowing that item.
    // 2) Otherwise, use stow_option_index from identify_click if appropriate.
    let labelForBackpack = null;
    if (usingLootTargetMode) {
      labelForBackpack = clickedLabelForFollow;
    } else if (
      current.carryable &&
      current.stowOptionIndex != null &&
      idx === current.stowOptionIndex
    ) {
      labelForBackpack = current.labeled;
    } else if (follow.clicked_label_for_sprite) {
      labelForBackpack = follow.clicked_label_for_sprite;
    }

    if (labelForBackpack) {
      const slot = firstEmptyBackpackSlot();
      if (slot === -1) {
        log("Backpack full; cannot store new item.");
      } else {
        try {
          const spriteResp = await postJSON("/.netlify/functions/openai", {
            op: "make_item_sprite",
            item_label: labelForBackpack,
            quality: getQuality(),
          });
          backpack[slot] = {
            type: "item",
            label: labelForBackpack,
            spriteUrl: spriteResp.image_url || null,
          };
          renderBackpack();
          log(`Item "${labelForBackpack}" added to backpack slot ${slot + 1}.`);
        } catch (e) {
          log("E401-SPRITE: " + String(e));
          setStatus(
            `You tried to store "${labelForBackpack}", but something went wrong with icon generation.`
          );
        }
      }
    }

    // Reset per-click state
    current.clicked = null;
    current.labeled = null;
    current.options = [];
    current.carryable = false;
    current.stowOptionIndex = null;
    current.lootItemLabels = null;
    renderChoices();
    els.confirmBtn.disabled = true;
  } catch (e) {
    log("E301-FOLLOW: " + String(e));
    setStatus("Error creating follow-up scene. See console.");
  } finally {
    els.genBtn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* View shifting                                                      */
/* ------------------------------------------------------------------ */

async function onChangeView(direction) {
  if (!current.imageUrl || !current.prompt) return;
  setStatus(`Shifting view ${direction}…`);
  setViewButtonsDisabled(true);

  try {
    const resp = await postJSON("/.netlify/functions/openai", {
      op: "change_view",
      direction,
      prior_prompt: current.prompt,
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      npcs: getNpcArray(),
      player_character: playerCharacter,
      quality: getQuality(),
    });

    current.prompt = resp.next_prompt || current.prompt;
    current.imageUrl = resp.image_url;
    current.story = resp.story || current.story;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
    };
    img.src = current.imageUrl;

    els.hud.textContent = current.story || "";
    current.clicked = null;
    current.options = [];
    current.carryable = false;
    current.stowOptionIndex = null;
    current.lootItemLabels = null;
    renderChoices();
    els.confirmBtn.disabled = true;
  } catch (e) {
    log("S501-VIEW: " + String(e));
    setStatus("Error changing view. See console.");
  } finally {
    setViewButtonsDisabled(false);
  }
}

/* ------------------------------------------------------------------ */
/* Player character creator                                           */
/* ------------------------------------------------------------------ */

function collectPlayerSheetFromForm() {
  return {
    age_range: els.ageRange?.value || "adult",
    sex: els.sex?.value || "person",
    weight_range: els.weightRange?.value || "average",
    chest_size: els.chestSize?.value || "medium",
    hip_size: els.hipSize?.value || "medium",
    hair_style: els.hairStyle?.value || "short",
    hair_color: els.hairColor?.value || "brown",
    eye_color: els.eyeColor?.value || "brown",
    profession: els.profession?.value || "student",
  };
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomizeCharacterForm() {
  if (!els.ageRange) return; // safety if creator not present

  const ages = ["early teens", "late teens", "twenties", "thirties"];
  const sexes = ["woman", "man"];
  const weights = ["slender", "average", "stocky"];
  const chest = ["small", "medium", "large"];
  const hips = ["narrow", "medium", "wide"];
  const hairStyles = ["short", "curly", "long", "wavy"];
  const hairColors = ["brown", "black", "blonde", "red"];
  const eyes = ["brown", "blue", "green", "hazel"];
  const profs = ["student", "ranch hand", "bartender", "detective"];

  els.ageRange.value = randomChoice(ages);
  els.sex.value = randomChoice(sexes);
  els.weightRange.value = randomChoice(weights);
  els.chestSize.value = randomChoice(chest);
  els.hipSize.value = randomChoice(hips);
  els.hairStyle.value = randomChoice(hairStyles);
  els.hairColor.value = randomChoice(hairColors);
  els.eyeColor.value = randomChoice(eyes);
  els.profession.value = randomChoice(profs);
}

async function generatePlayerPortrait() {
  if (!els.playerPortrait) return;

  setStatus("Generating player character portrait…");
  els.genPortraitBtn.disabled = true;
  els.randomCharacterBtn.disabled = true;
  els.useCharacterBtn.disabled = true;

  const sheet = collectPlayerSheetFromForm();
  const worldTag = els.sceneSelect.value || "university";

  try {
    const resp = await postJSON("/.netlify/functions/openai", {
      op: "gen_player_portrait",
      world_tag: worldTag,
      world_description: WORLD_DESCRIPTIONS[worldTag],
      player_character: sheet,
      quality: getQuality(),
    });

    els.playerPortrait.src = resp.image_url;
    els.playerPortrait.style.display = "block";

    setStatus("Portrait generated. If you like this character, click “Use this character”.");
  } catch (e) {
    log("S601-CHAR: " + String(e));
    setStatus("Error generating player portrait. See console.");
  } finally {
    els.genPortraitBtn.disabled = false;
    els.randomCharacterBtn.disabled = false;
    els.useCharacterBtn.disabled = false;
  }
}

function useCurrentCharacter() {
  playerCharacter = collectPlayerSheetFromForm();

  // Hide the dropdowns after character has been chosen (per your earlier request)
  if (els.playerCreatorForm) {
    els.playerCreatorForm.style.display = "none";
  }

  setStatus("Player character locked in. Now generate a scene to begin role-playing.");
}

/* ------------------------------------------------------------------ */
/* Equipping items on the character portrait                          */
/* ------------------------------------------------------------------ */

function onPortraitClick(evt) {
  if (!els.playerPortrait || !els.playerPortrait.src) return;
  if (activeSlotIndex == null) {
    setStatus("Select an item from the backpack, then click the portrait to try equipping it.");
    return;
  }

  const slot = backpack[activeSlotIndex];
  if (!slot || slot.type !== "item") {
    setStatus("Select an item from the backpack first.");
    return;
  }

  const rect = els.playerPortrait.getBoundingClientRect();
  const nx = (evt.clientX - rect.left) / rect.width;
  const ny = (evt.clientY - rect.top) / rect.height;
  equipClick = { nx, ny };

  setStatus(`Equip attempt: ${slot.label} at (${nx.toFixed(2)}, ${ny.toFixed(2)}). Click “Equip item” if present, or trigger your equip action.`);
  els.hud.textContent =
    `You line the ${slot.label} up with part of your character's body.\n` +
    "Use your equip control (if wired) to try putting it on. (In this MVP, equipping is usually triggered from another button.)";
}

// In your UI you might have a dedicated "Equip item" button wired to this.
async function onEquipItem() {
  if (activeSlotIndex == null) {
    setStatus("Select an item from the backpack first.");
    return;
  }
  const active = backpack[activeSlotIndex];
  if (!active || active.type !== "item") {
    setStatus("Select an item from the backpack first.");
    return;
  }
  if (!els.playerPortrait || !els.playerPortrait.src) {
    setStatus("Generate and select a player portrait first.");
    return;
  }
  if (!equipClick) {
    setStatus("Click on the portrait where you want the item to go, then try equipping again.");
    return;
  }

  setStatus(`Trying to equip ${active.label} on your character…`);

  try {
    const resp = await postJSON("/.netlify/functions/openai", {
      op: "equip_item_on_character",
      world_tag: current.worldTag,
      world_description: WORLD_DESCRIPTIONS[current.worldTag],
      player_character: playerCharacter,
      current_portrait_url: els.playerPortrait.src,
      item_label: active.label,
      click: equipClick,
      equipped_items: equippedItems,
      quality: getQuality(),
    });

    if (!resp.equip_success) {
      setStatus("Equip failed: " + (resp.reason || "item incompatible"));
      return;
    }

    els.playerPortrait.src = resp.image_url;
    setStatus(`Equipped ${active.label} on your character.`);

    // Track equipped item, and if something was replaced, push replacement into backpack
    if (!equippedItems.includes(active.label)) {
      equippedItems.push(active.label);
    }
    if (resp.replaced_item_label) {
      const slot = firstEmptyBackpackSlot();
      if (slot !== -1) {
        backpack[slot] = {
          type: "item",
          label: resp.replaced_item_label,
          spriteUrl: null,
        };
      }
    }

    // Remove from backpack
    backpack[activeSlotIndex] = null;
    activeSlotIndex = null;
    renderBackpack();
  } catch (e) {
    log("S701-EQUIP: " + String(e));
    setStatus("Error equipping item. See console.");
  }
}

/* ------------------------------------------------------------------ */
/* Reset                                                              */
/* ------------------------------------------------------------------ */

function resetAll() {
  current = {
    worldTag: els.sceneSelect.value || "western",
    prompt: "",
    imageUrl: null,
    clicked: null,
    labeled: null,
    options: [],
    carryable: false,
    stowOptionIndex: null,
    story: "",
    isCharacter: false,
    characterName: null,
    characterSummary: null,
    lootItemLabels: null,
  };
  npcs = [];
  backpack = new Array(BACKPACK_SLOTS).fill(null);
  activeSlotIndex = null;
  activeInteractionMode = "wildcard";
  renderBackpack();
  renderInteractModes();
  drawPlaceholder();
  clearLog();
  setViewButtonsDisabled(true);
  els.confirmBtn.disabled = true;
  setStatus("Reset complete. Choose a world and (optionally) a character, then generate a new scene.");
  els.hud.textContent =
    "Reset complete.\n\nUse the character creator if you want to define yourself, then click “Generate image”.";
}

/* ------------------------------------------------------------------ */
/* Wire up listeners                                                  */
/* ------------------------------------------------------------------ */

drawPlaceholder();
renderBackpack();
renderInteractModes();
setViewButtonsDisabled(true);
els.genBtn.disabled = true; // until a character is chosen or we decide to allow free start

// Enable generate once we either pick a character or we allow immediate start.
// For now, just allow immediate start.
els.genBtn.disabled = false;

// Canvas click
els.canvas.addEventListener("click", onCanvasClick);

// Buttons
els.genBtn.addEventListener("click", generateImage);
els.confirmBtn.addEventListener("click", onConfirmSelection);
els.resetBtn.addEventListener("click", resetAll);

els.viewLeftBtn.addEventListener("click", () => onChangeView("left"));
els.viewRightBtn.addEventListener("click", () => onChangeView("right"));
els.viewUpBtn.addEventListener("click", () => onChangeView("up"));
els.viewDownBtn.addEventListener("click", () => onChangeView("down"));
els.viewZoomOutBtn.addEventListener("click", () => onChangeView("zoom_out"));

// Interact mode bar
document.querySelectorAll("#interactRow .interact-slot").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    if (!INTERACTION_MODES.includes(mode)) return;
    activeInteractionMode = mode;
    renderInteractModes();
    switch (mode) {
      case "pickup":
        setStatus(
          "Pick-up mode: click near a small object—or part of a person whose clothing you want to target—then confirm."
        );
        break;
      case "dialogue":
        setStatus("Dialogue mode: click near a person or gathering to talk, then confirm.");
        break;
      case "move":
        setStatus("Move-to mode: click where you want to go, then confirm.");
        break;
      default:
        setStatus("Wildcard mode: click anything interesting, then confirm.");
        break;
    }
  });
});

// Character creator
if (els.genPortraitBtn) {
  els.genPortraitBtn.addEventListener("click", generatePlayerPortrait);
}
if (els.randomCharacterBtn) {
  els.randomCharacterBtn.addEventListener("click", () => {
    randomizeCharacterForm();
    generatePlayerPortrait();
  });
}
if (els.useCharacterBtn) {
  els.useCharacterBtn.addEventListener("click", useCurrentCharacter);
}

// Portrait click for equip targeting
if (els.playerPortrait) {
  els.playerPortrait.addEventListener("click", onPortraitClick);
}

// NOTE: if you have a dedicated "Equip item" button, wire it to onEquipItem()
// e.g. document.getElementById("equipBtn").addEventListener("click", onEquipItem);
