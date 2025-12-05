/* main.js — Point & Click MVP with stepwise error codes */

const els = {
  genBtn: document.getElementById("genBtn"),
  resetBtn: document.getElementById("resetBtn"),
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  canvas: document.getElementById("imgCanvas"),
  hud: document.getElementById("hud"),
};
const ctx = els.canvas.getContext("2d");

// Known pixel coordinate system
const W = 768, H = 512;

let current = {
  prompt: "A mysterious table with assorted objects under warm lamp light, cinematic, photoreal",
  imageUrl: "",
  clicked: null, // {x,y}
  labeled: "",   // what model said we clicked
};

function setStatus(s){ els.status.textContent = s; }
function log(msg){ els.log.textContent += msg + "\n"; els.log.scrollTop = els.log.scrollHeight; }
function clearLog(){ els.log.textContent = ""; els.hud.textContent = ""; }

// Robust JSON POST with basic guards
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

// Step 1: Generate image (API) — error code: E101-GEN
async function generateImage() {
  try {
    setStatus("Generating image…");
    const out = await postJSON("/.netlify/functions/openai", {
      op: "gen_image",
      prompt: current.prompt
    });
    if (!out.image_url) throw new Error("E101-GEN: Missing image_url");
    current.imageUrl = out.image_url;
    els.hud.textContent = `Image: 768x512 canvas • Click anywhere to place cursor\nURL: ${current.imageUrl}`;
    await drawImageToCanvas(current.imageUrl); // Step 2 draw
    setStatus("Image ready – click the picture");
  } catch (e) {
    setStatus("Error");
    log(String(e));
  }
}

// Step 2: Display image in a fixed 768x512 canvas — error code: E111-DRAW
async function drawImageToCanvas(url) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          ctx.clearRect(0,0,W,H);
          // Fit image into canvas (contain)
          const rImg = img.width / img.height;
          const rCan = W / H;
          let dw, dh, dx, dy;
          if (rImg > rCan) { // image wider
            dw = W; dh = Math.round(W / rImg); dx = 0; dy = Math.round((H - dh)/2);
          } else {          // image taller
            dh = H; dw = Math.round(H * rImg); dy = 0; dx = Math.round((W - dw)/2);
          }
          ctx.drawImage(img, dx, dy, dw, dh);
          resolve();
        } catch (err) {
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

// Step 3: Register pixel click — error code: E121-CLICK (assigned if no image yet)
function onCanvasClick(evt) {
  if (!current.imageUrl) { log("E121-CLICK: Click ignored; no image yet"); return; }
  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) * (W / rect.width));
  const y = Math.floor((evt.clientY - rect.top) * (H / rect.height));
  current.clicked = { x, y };
  log(`Click @ (${x}, ${y})`);

  // Step 4: draw cursor & get dataURL — error code: E131-CURSOR
  try {
    drawCursor(x, y);
  } catch(e) {
    log("E131-CURSOR: " + String(e));
    return;
  }

  // Step 5 + 6: identify & generate follow-up image (API)
  identifyAndRegenerate().catch(err => {
    setStatus("Error");
    log(String(err));
  });
}

// Step 4: Draw a visible cursor at pixel — error code: E131-CURSOR
function drawCursor(x, y) {
  // draw over current canvas image
  const R = 6;
  ctx.save();
  // outline for visibility
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath(); ctx.arc(x, y, R+2, 0, Math.PI*2); ctx.stroke();
  // crosshair
  ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x-12, y); ctx.lineTo(x+12, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y-12); ctx.lineTo(x, y+12); ctx.stroke();
  // ring
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}

// Step 5 & 6 combined: send cursor-marked image to identify clicked thing, then generate new image
// Error codes: E201-ID (identify), E301-FOLLOW (follow-up)
async function identifyAndRegenerate() {
  if (!current.clicked) throw new Error("E201-ID: No click recorded");
  setStatus("Identifying click…");

  // Export cursor-marked canvas as PNG data URL
  let markedDataUrl;
  try {
    markedDataUrl = els.canvas.toDataURL("image/png");
  } catch {
    throw new Error("E131-CURSOR: Canvas export failed");
  }

  // Identify
  const idResp = await postJSON("/.netlify/functions/openai", {
    op: "identify_click",
    original_url: current.imageUrl,
    marked_image_data_url: markedDataUrl,
    x: current.clicked.x, y: current.clicked.y,
    canvas_size: { width: W, height: H }
  }).catch(e => { throw new Error("E201-ID: " + String(e)); });

  if (!idResp.label) throw new Error("E201-ID: No label from vision");
  current.labeled = idResp.label;
  log(`Identified: "${current.labeled}"`);

  // Follow-up image
  setStatus("Generating follow-up image…");
  const follow = await postJSON("/.netlify/functions/openai", {
    op: "gen_followup_image",
    clicked_label: current.labeled,
    prior_prompt: current.prompt
  }).catch(e => { throw new Error("E301-FOLLOW: " + String(e)); });

  if (!follow.image_url) throw new Error("E301-FOLLOW: Missing image_url");
  current.imageUrl = follow.image_url;
  current.prompt = follow.next_prompt || current.prompt;
  current.clicked = null;

  await drawImageToCanvas(current.imageUrl);
  setStatus("New image ready – click again if you like");
}

// Wire UI
els.genBtn.onclick = generateImage;
els.resetBtn.onclick = () => { current = { prompt: current.prompt, imageUrl:"", clicked:null, labeled:"" }; ctx.clearRect(0,0,W,H); clearLog(); setStatus("Ready"); };
els.canvas.addEventListener("click", onCanvasClick);

