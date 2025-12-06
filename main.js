/* main.js — Point & Click MVP with story-rich choices and a backpack */

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
};
const ctx = els.canvas.getContext("2d");

// Logical pixel coordinate system (canvas)
const W = 768, H = 512;

// Backpack state
const BACKPACK_SLOTS = 32;
let backpack = new Array(BACKPACK_SLOTS).fill(null);
// Slot 0 is always the cursor tool
backpack[0] = { type: "cursor", label: "Cursor", spriteUrl: null };
let activeSlotIndex = 0;

let current = {
  prompt: "A mysterious table with assorted objects under warm lamp light, cinematic, photoreal",
  imageUrl: "",
  clicked: null, // {x,y}
  labeled: "",   // what the model said we clicked
  options: [],   // interaction options for the clicked object
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

// Simple JSON POST helper with content-type guard
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
        span.textContent = "✛"; // crosshair-ish
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
  if (!backpack[i]) {
    // Can't select an empty slot
    return;
  }
  activeSlotIndex = i;
  renderBackpack();
  if (i === 0) {
    setStatus("Cursor tool selected – click the scene, then confirm.");
    els.hud.textContent =
      "You switch to the simple cursor.\nClick in the scene to choose a point, then confirm.";
  } else {
    setStatus(`Using item: ${backpack[i].label}. Click the scene, then confirm.`);
    els.hud.textContent =
      `You ready the ${backpack[i].label} from your backpack.\n` +
      `Click in the scene where you want to use it, then confirm.`;
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

/* ---------------- STEP 1: Generate base image (API) ----------------
   Client error code: E101-GEN  (server: S101-GEN) */
async function generateImage() {
  try {
    setStatus("Generating image…");
    els.genBtn.disabled = true;
    els.confirmBtn.disabled = true;
    current.clicked = null;
    current.labeled = "";
    current.options = [];
    current.carryable = false;
    current.stowOptionIndex = null;
    ctx.clearRect(0,0,W,H);
    clearLog();

    const out = await postJSON("/.netlify/functions/openai", {
      op: "gen_image",
      prompt: current.prompt
    });
    if (!out.image_url) throw new Error("E101-GEN: Missing image_url");
    current.imageUrl = out.image_url;

    els.hud.textContent =
      `An opening scene is ready.\n` +
      `Tap/click anywhere to select a point, then press "2) Confirm selection".\n` +
      `URL: ${current.imageUrl.slice(0,80)}…`;

    await drawImageToCanvas(current.imageUrl);  // step 2
    setStatus("Image ready – tap to select, then confirm");
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    els.genBtn.disabled = false;
  }
}

/* ---------------- STEP 2: Draw image into 768x512 canvas ----------------
   Client error code: E111-DRAW */
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

/* ---------------- STEP 3: User click → record pixel coords ----------------
   Client error code: E121-CLICK */
async function onCanvasClick(evt) {
  if (!current.imageUrl) {
    log("E121-CLICK: Click ignored; no image yet");
    return;
  }

  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) * (W / rect.width));
  const y = Math.floor((evt.clientY - rect.top) * (H / rect.height));
  current.clicked = { x, y };
  current.options = []; // clear old options when new spot is chosen
  current.carryable = false;
  current.stowOptionIndex = null;
  renderChoices();

  log(`Selection: (${x}, ${y})`);

  const activeTool = backpack[activeSlotIndex];
  if (activeTool && activeTool.type === "item") {
    setStatus(`Using ${activeTool.label} at (${x}, ${y}) – click "2) Confirm selection"`);
    els.hud.textContent =
      `You aim the ${activeTool.label} at (${x}, ${y}).\n` +
      `Confirm to see how the scene responds.`;
  } else {
    setStatus(`Selection at (${x}, ${y}) – click "2) Confirm selection"`);
    els.hud.textContent =
      `You mark a point at (${x}, ${y}).\n` +
      `Confirm to discover what this part of the scene represents.`;
  }

  try {
    els.confirmBtn.disabled = true; // avoid double confirm while redrawing
    await redrawImageWithCursor(x, y); // redraw base + single cursor
    els.confirmBtn.disabled = false;
  } catch (e) {
    log("E131-CURSOR: " + String(e));
    els.confirmBtn.disabled = true;
  }
}

/* ---------------- STEP 4: Draw cursor on canvas ----------------
   Client error code: E131-CURSOR */
function drawCursor(x, y) {
  const R = 6;
  ctx.save();
  // dark outline
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.arc(x, y, R + 2, 0, Math.PI * 2);
  ctx.stroke();

  // crosshair
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

  // ring
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// helper: redraw base image, then draw a single cursor
async function redrawImageWithCursor(x, y) {
  if (!current.imageUrl) return;
  await drawImageToCanvas(current.imageUrl);
  drawCursor(x, y);
}

/* ---------------- STEP 5: Confirm selection → identify object + get story-rich options ----------------
   Client error codes:
     - E201-ID (identify + options) */
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

    // Export canvas (with cursor) as PNG data URL
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
      held_item_label: heldItemLabel
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

    log(`Identified selection as: "${current.labeled}"`);
    log("Options:\n - " + current.options.join("\n - "));

    els.hud.textContent =
      `You focus on: ${current.labeled}.\n` +
      `Choose how you wish to interact with it.`;

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
    // confirm remains disabled until next selection
  }
}

/* ---------------- STEP 6: User chooses an interaction option → generate next image + story ----------------
   Client error code:
     - E301-FOLLOW (follow-up image step)
     - E401-SPRITE (sprite generation) */
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
    setStatus("Creating new scene from selection…");
    els.genBtn.disabled = true;
    els.confirmBtn.disabled = true;
    disableChoiceButtons(true);

    // First, generate the new scene + story
    const follow = await postJSON("/.netlify/functions/openai", {
      op: "gen_followup_image",
      clicked_label: current.labeled,
      interaction_choice: optionText,
      prior_prompt: current.prompt
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
      `Tap somewhere in this new scene to continue the story.`;

    await drawImageToCanvas(current.imageUrl);
    setStatus("New image ready – tap to select, then confirm");

    // If this option represents stowing a carryable item, generate a sprite and add to backpack
    if (isStow && follow.clicked_label_for_sprite !== false) {
      try {
        const spriteResp = await postJSON("/.netlify/functions/openai", {
          op: "make_item_sprite",
          item_label: follow.clicked_label_for_sprite || follow.clicked_label || current.labeled
        });
        if (spriteResp.image_url) {
          // For sprite label, use the original label from the selection (not the long option text)
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
    // Confirm will be re-enabled on next click
  }
}

function disableChoiceButtons(disabled) {
  const buttons = els.choices.querySelectorAll("button");
  buttons.forEach(b => b.disabled = disabled);
}

/* ---------------- UI: render choices ---------------- */
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

/* ---------------- Wiring ---------------- */

els.genBtn.onclick = generateImage;
els.confirmBtn.onclick = onConfirmSelection;
els.resetBtn.onclick = () => {
  current = {
    prompt: current.prompt,
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
  ctx.clearRect(0,0,W,H);
  clearLog();
  renderBackpack();
  els.confirmBtn.disabled = true;
  setStatus("Ready");
};

els.canvas.addEventListener("click", onCanvasClick);

// Initial render
renderBackpack();
