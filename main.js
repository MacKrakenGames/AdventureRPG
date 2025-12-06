/* main.js — Point & Click MVP with text interaction choices */

const els = {
  genBtn: document.getElementById("genBtn"),
  confirmBtn: document.getElementById("confirmBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  canvas: document.getElementById("imgCanvas"),
  hud: document.getElementById("hud"),
  choices: document.getElementById("choices"),
};
const ctx = els.canvas.getContext("2d");

// Logical pixel coordinate system (canvas)
const W = 768, H = 512;

let current = {
  prompt: "A mysterious table with assorted objects under warm lamp light, cinematic, photoreal",
  imageUrl: "",
  clicked: null, // {x,y}
  labeled: "",   // what the model said we clicked
  options: [],   // interaction options for the clicked object
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
    ctx.clearRect(0,0,W,H);
    clearLog();

    const out = await postJSON("/.netlify/functions/openai", {
      op: "gen_image",
      prompt: current.prompt
    });
    if (!out.image_url) throw new Error("E101-GEN: Missing image_url");
    current.imageUrl = out.image_url;

    els.hud.textContent =
      `Image loaded on 768x512 canvas.\n` +
      `Tap/click anywhere to select a point, then press "2) Confirm selection".\n` +
      `URL: ${current.imageUrl.slice(0,80)}…`;

    await drawImageToCanvas(current.imageUrl);  // step 2
    setStatus("Image ready – tap to select, then confirm");
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    // Re-enable generate button (user can always start over)
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
  renderChoices();

  log(`Selection: (${x}, ${y})`);
  setStatus(`Selection at (${x}, ${y}) – click "2) Confirm selection"`);

  els.hud.textContent =
    `Selected point: (${x}, ${y})\nTap Confirm when ready.`;

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

/* ---------------- STEP 5: Confirm selection → identify object + get options ----------------
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

    const idResp = await postJSON("/.netlify/functions/openai", {
      op: "identify_click",
      original_url: current.imageUrl,
      marked_image_data_url: markedDataUrl,
      x, y,
      canvas_size: { width: W, height: H }
    }).catch(e => { throw new Error("E201-ID: " + String(e)); });

    if (!idResp.label) throw new Error("E201-ID: No label from vision");
    if (!Array.isArray(idResp.options) || idResp.options.length === 0) {
      throw new Error("E201-ID: No options returned");
    }

    current.labeled = idResp.label;
    current.options = idResp.options;
    log(`Identified selection as: "${current.labeled}"`);
    log("Options:\n - " + current.options.join("\n - "));

    renderChoices();

    setStatus(`Choose how to interact with the ${current.labeled}.`);
  } catch (e) {
    setStatus("Error");
    log(String(e));
  } finally {
    els.genBtn.disabled = false;
    // confirm remains disabled until next selection
  }
}

/* ---------------- STEP 6: User chooses an interaction option → generate next image ----------------
   Client error code:
     - E301-FOLLOW (follow-up image step) */
async function onChooseOption(optionText) {
  if (!current.labeled) {
    log("E301-FOLLOW: No labeled selection yet");
    return;
  }
  try {
    setStatus("Creating new scene from selection…");
    els.genBtn.disabled = true;
    els.confirmBtn.disabled = true;
    disableChoiceButtons(true);

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
    current.labeled = "";
    current.options = [];

    log(`New scene created from "${optionText}" on "${current.prompt.slice(0,40)}..."`);

    renderChoices();
    els.hud.textContent =
      `New image generated from choice:\n"${optionText}".\nTap to select another point, then Confirm selection.`;

    await drawImageToCanvas(current.imageUrl);
    setStatus("New image ready – tap to select, then confirm");
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

  current.options.forEach(opt => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = opt;
    b.onclick = () => onChooseOption(opt);
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
    options: []
  };
  ctx.clearRect(0,0,W,H);
  clearLog();
  els.confirmBtn.disabled = true;
  setStatus("Ready");
};

els.canvas.addEventListener("click", onCanvasClick);
