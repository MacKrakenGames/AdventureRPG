// main.js
// Frontend logic for the role-playing point-and-click MVP

// Canvas size (keep in sync with CSS)
const W = 512;
const H = 512;
const SCENE_PLACEHOLDER_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect x="48" y="48" width="416" height="416" rx="24" fill="#111827" stroke="#1f2937" stroke-width="2"/>
    <path d="M120 340 L220 220 L300 300 L380 200" stroke="#475569" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="175" cy="180" r="18" fill="#64748b"/>
    <text x="256" y="420" font-family="system-ui, sans-serif" font-size="18" fill="#94a3b8" text-anchor="middle">Scene placeholder</text>
  </svg>`
)}`;
const PORTRAIT_PLACEHOLDER_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect x="88" y="64" width="336" height="384" rx="28" fill="#111827" stroke="#1f2937" stroke-width="2"/>
    <circle cx="256" cy="210" r="62" fill="#1f2937"/>
    <rect x="180" y="280" width="152" height="120" rx="52" fill="#1f2937"/>
    <text x="256" y="418" font-family="system-ui, sans-serif" font-size="18" fill="#94a3b8" text-anchor="middle">Character placeholder</text>
  </svg>`
)}`;

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
  playerCreatorForm: document.getElementById("playerCreatorForm"), // Note: this ID does not exist in HTML, logic handles via charControls
};

// Canvas 2D context
const ctx = els.canvas.getContext("2d");
els.canvas.width = W;
els.canvas.height = H;
const scenePlaceholderImg = new Image();
scenePlaceholderImg.src = SCENE_PLACEHOLDER_SRC;

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
  lootItemLabels: null,
};

let playerCharacter = null; // object from character creator
let npcs = []; // [{ name, summary }]

// Interaction modes (4-slot bar)
const INTERACTION_MODES = ["wildcard", "pickup", "dialogue", "move"];
let activeInteractionMode = "wildcard";

// Backpack: 32 slots
const BACKPACK_SLOTS = 32;
let backpack = new Array(BACKPACK_SLOTS).fill(null);
// activeSlotIndex: which backpack item is currently "in hand"
let activeSlotIndex = null;

// Equipped items logic (Fix 5)
const WORN_SLOT_NAMES = [
  "head", "hair", "ears", "neck",
  "torso_1", "torso_2", "arms", "hands",
  "legs_1", "legs_2", "feet", "accessory"
];
const WORN_SLOT_POSITIONS = {
  head: { top: "6%", left: "14%" },
  hair: { top: "6%", left: "86%" },
  ears: { top: "16%", left: "92%" },
  neck: { top: "22%", left: "8%" },
  torso_1: { top: "36%", left: "86%" },
  torso_2: { top: "46%", left: "14%" },
  arms: { top: "42%", left: "6%" },
  hands: { top: "50%", left: "94%" },
  legs_1: { top: "68%", left: "12%" },
  legs_2: { top: "68%", left: "88%" },
  feet: { top: "86%", left: "18%" },
  accessory: { top: "82%", left: "90%" },
};
const WORN_SLOT_ANCHORS = {
  head: { top: "10%", left: "50%" },
  hair: { top: "8%", left: "30%" },
  ears: { top: "12%", left: "70%" },
  neck: { top: "20%", left: "50%" },
  torso_1: { top: "32%", left: "50%" },
  torso_2: { top: "44%", left: "50%" },
  arms: { top: "34%", left: "24%" },
  hands: { top: "46%", left: "76%" },
  legs_1: { top: "62%", left: "40%" },
  legs_2: { top: "62%", left: "60%" },
  feet: { top: "82%", left: "50%" },
  accessory: { top: "72%", left: "78%" },
};
let wornItems = {}; // Map of slotName -> { label, spriteUrl }

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

function renderWornInventory() {
  const overlay = document.getElementById("portraitSlots");
  if (!overlay) return;
  overlay.innerHTML = "";
  const overlayRect = overlay.getBoundingClientRect();
  const hasRect = overlayRect.width > 0 && overlayRect.height > 0;
  const toPixels = (pos) => {
    const left = parseFloat(pos.left || "50");
    const top = parseFloat(pos.top || "50");
    return {
      x: (left / 100) * overlayRect.width,
      y: (top / 100) * overlayRect.height,
    };
  };

  WORN_SLOT_NAMES.forEach((slotKey) => {
    const item = wornItems[slotKey];
    const div = document.createElement("div");
    div.className = "backpack-slot portrait-slot";
    div.title = `${slotKey}: ${item ? item.label : "empty"}`;

    const pos = WORN_SLOT_POSITIONS[slotKey] || { top: "50%", left: "50%" };
    div.style.top = pos.top;
    div.style.left = pos.left;

    if (hasRect) {
      const anchor = WORN_SLOT_ANCHORS[slotKey] || pos;
      const anchorPx = toPixels(anchor);
      const slotPx = toPixels(pos);
      const dx = slotPx.x - anchorPx.x;
      const dy = slotPx.y - anchorPx.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      const connector = document.createElement("div");
      connector.className = "portrait-connector";
      connector.style.left = `${anchorPx.x}px`;
      connector.style.top = `${anchorPx.y}px`;
      connector.style.width = `${length}px`;
      connector.style.transform = `rotate(${angle}deg)`;
      overlay.appendChild(connector);
    }

    // Visual label for the slot name (tiny)
    const lbl = document.createElement("div");
    lbl.style.position = "absolute";
    lbl.style.top = "1px";
    lbl.style.left = "2px";
    lbl.style.fontSize = "0.5rem";
    lbl.style.opacity = "0.6";
    lbl.textContent = slotKey.replace(/_\d/, "");
    div.appendChild(lbl);

    if (item) {
      if (item.spriteUrl) {
        const img = document.createElement("img");
        img.src = item.spriteUrl;
        div.appendChild(img);
      } else {
        const span = document.createElement("span");
        span.textContent = item.label.slice(0, 4);
        div.appendChild(span);
      }
      div.style.borderColor = "#fbbf24";
    } else {
      div.style.opacity = "0.5";
    }

    div.onclick = () => onWornSlotClick(slotKey);
    overlay.appendChild(div);
  });
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
  if (scenePlaceholderImg.complete) {
    ctx.drawImage(scenePlaceholderImg, 0, 0, W, H);
    return;
  }
  scenePlaceholderImg.onload = () => {
    ctx.drawImage(scenePlaceholderImg, 0, 0, W, H);
  };
}

function setPortraitPlaceholder() {
  if (!els.playerPortrait) return;
  els.playerPortrait.src = PORTRAIT_PLACEHOLDER_SRC;
  els.playerPortrait.style.display = "block";
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
  renderWornInventory(); // refresh state if needed

  const active = activeSlotIndex != null ? backpack[activeSlotIndex] : null;
  if (!active) {
    setStatus("No item selected from the backpack.");
    els.hud.textContent =
      "You put your backpacked items away for now.\n" +
      "You can still interact using the mode bar above.";
    return;
  }

  setStatus(`Using item: ${active.label}. Click the scene or an equipment slot.`);
  els.hud.textContent =
    `You ready the ${active.label} from your backpack.\n` +
    `Click in the scene to use it there, or click a Worn Item slot to equip it.`;
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
/* Confirm selection                                                  */
/* ------------------------------------------------------------------ */

async function onConfirmSelection() {
  if (!current.imageUrl || !current.clicked) return;

  els.confirmBtn.disabled = true;
  setStatus("Identifying your selection…");
  const { x, y } = current.clicked;
  const markedDataUrl = els.canvas.toDataURL("image/png");

  const activeTool = activeSlotIndex != null ? backpack[activeSlotIndex] : null;
  const heldItemLabel = activeTool && activeTool.type === "item" ? activeTool.label : null;

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
      label, options, carryable, stow_option_index,
      is_character, character_name, character_summary
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

    // Special Branch: Pickup Character Item
    if (activeInteractionMode === "pickup" && !heldItemLabel && is_character) {
      setStatus(`You focus on: ${label}. Asking what visible items you might try to take…`);

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
        current.lootItemLabels = items;
        current.options = items.map(
          (it) => `Try to quietly take the ${it} and add it to your belongings.`
        );
        current.stowOptionIndex = null;
        current.carryable = true;

        els.hud.textContent =
          `You study ${label}, considering what you might walk away with.\n\n` +
          "Choose which specific thing you want to target. Your choice may have social consequences.";
        renderChoices();
        setStatus(`You focus on: ${label}. Choose a specific item to try to acquire.`);
        els.confirmBtn.disabled = true;
        return;
      }
      log("No specific character items returned; falling back to generic pickup options.");
    }

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

    els.hud.textContent = current.story || "";
    log(`New scene created from selection "${clickedLabelForFollow}" with choice "${optionText}".`);

    // Backpack handling
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
          setStatus(`You tried to store "${labelForBackpack}", but icon generation failed.`);
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
  if (!els.ageRange) return;

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

  // Fix 3: Proper ID usage
  const charControls = document.getElementById("charControls");
  if (charControls) {
    charControls.style.display = "none";
  }
  const playerHint = document.getElementById("playerHint");
  if (playerHint) {
    playerHint.style.display = "none";
  }

  setStatus("Player character locked in. Now generate a scene to begin role-playing.");
}

/* ------------------------------------------------------------------ */
/* Equipping items on the character (Fix 5: Slot Logic)               */
/* ------------------------------------------------------------------ */

async function onWornSlotClick(slotKey) {
  // 1. Check if we have a portrait
  if (!els.playerPortrait || !els.playerPortrait.src) {
    setStatus("Generate a character portrait first.");
    return;
  }

  // 2. Check if we are holding an item from backpack
  if (activeSlotIndex === null) {
    const existing = wornItems[slotKey];
    if (existing) {
      setStatus(`Slot ${slotKey} contains: ${existing.label}.`);
    } else {
      setStatus(`Select an item from your backpack to equip to ${slotKey}.`);
    }
    return;
  }

  const backpackItem = backpack[activeSlotIndex];
  if (!backpackItem || backpackItem.type !== "item") {
    setStatus("That slot is empty.");
    return;
  }

  // 3. Attempt to equip
  setStatus(`Attempting to equip ${backpackItem.label} to ${slotKey}...`);
  
  const currentWornList = Object.entries(wornItems)
    .map(([k, v]) => `${k}:${v.label}`)
    .join(", ");

  try {
    const resp = await postJSON("/.netlify/functions/openai", {
      op: "equip_item_on_character",
      world_tag: current.worldTag,
      player_character: playerCharacter,
      current_portrait_url: els.playerPortrait.src,
      item_label: backpackItem.label,
      target_slot: slotKey,
      equipped_items: currentWornList,
      quality: getQuality(),
    });

    if (!resp.equip_success) {
      setStatus("Equip failed: " + (resp.reason || "Item doesn't fit there."));
      return;
    }

    els.playerPortrait.src = resp.image_url;
    
    // Update data
    const oldItemInSlot = wornItems[slotKey];
    wornItems[slotKey] = {
      label: backpackItem.label,
      spriteUrl: backpackItem.spriteUrl
    };

    // Remove from backpack
    backpack[activeSlotIndex] = null;
    activeSlotIndex = null;

    // Handle swap (old item back to backpack)
    if (oldItemInSlot) {
      let free = -1; 
      for(let i=0; i<BACKPACK_SLOTS; i++) { if(!backpack[i]) { free=i; break; } }
      if (free !== -1) {
        backpack[free] = { type:"item", ...oldItemInSlot };
        log(`Swapped ${oldItemInSlot.label} back to backpack.`);
      } else {
        log(`No room for ${oldItemInSlot.label}, it was discarded!`);
      }
    }

    renderBackpack();
    renderWornInventory();
    setStatus(`Successfully equipped ${backpackItem.label} on ${slotKey}.`);

  } catch (e) {
    log("E702-EQUIP: " + String(e));
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
  
  wornItems = {}; // Clear worn
  renderWornInventory(); // Clear UI

  activeInteractionMode = "wildcard";
  renderBackpack();
  renderInteractModes();
  drawPlaceholder();
  setPortraitPlaceholder();
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
setPortraitPlaceholder();
renderBackpack();
renderWornInventory();
renderInteractModes();
setViewButtonsDisabled(true);
els.genBtn.disabled = false;

els.canvas.addEventListener("click", onCanvasClick);
els.genBtn.addEventListener("click", generateImage);
els.confirmBtn.addEventListener("click", onConfirmSelection);
els.resetBtn.addEventListener("click", resetAll);

els.viewLeftBtn.addEventListener("click", () => onChangeView("left"));
els.viewRightBtn.addEventListener("click", () => onChangeView("right"));
els.viewUpBtn.addEventListener("click", () => onChangeView("up"));
els.viewDownBtn.addEventListener("click", () => onChangeView("down"));
els.viewZoomOutBtn.addEventListener("click", () => onChangeView("zoom_out"));

document.querySelectorAll("#interactRow .interact-slot").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    if (!INTERACTION_MODES.includes(mode)) return;
    activeInteractionMode = mode;
    renderInteractModes();
    switch (mode) {
      case "pickup":
        setStatus("Pick-up mode: click near a small object or clothing to target, then confirm.");
        break;
      case "dialogue":
        setStatus("Dialogue mode: click near a person to talk, then confirm.");
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

if (els.genPortraitBtn) els.genPortraitBtn.addEventListener("click", generatePlayerPortrait);
if (els.randomCharacterBtn) {
  els.randomCharacterBtn.addEventListener("click", () => {
    randomizeCharacterForm();
    generatePlayerPortrait();
  });
}
if (els.useCharacterBtn) els.useCharacterBtn.addEventListener("click", useCurrentCharacter);
if (els.playerPortrait) {
  els.playerPortrait.addEventListener("load", () => {
    renderWornInventory();
  });
}
window.addEventListener("resize", () => {
  renderWornInventory();
});
