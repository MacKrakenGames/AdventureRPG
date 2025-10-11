/* main.js — v2 + Map integration */

const startScenarios = [
  { id: "forest", prompt: "You wake in a misty forest clearing near a mossy altar." },
  { id: "library", prompt: "At midnight, an ancient library door creaks open by itself." },
  { id: "harbor", prompt: "Fog rolls across a moonlit harbor as a lantern flickers." },
  { id: "ruins",  prompt: "You stand amid vine-choked ruins humming with faint energy." }
];

const els = {
  startBtns: document.getElementById("start-buttons"),
  status: document.getElementById("status"),
  sceneDesc: document.getElementById("scene-desc"),
  sceneImg: document.getElementById("scene-img"),
  overlay: document.getElementById("overlay"),
  options: document.getElementById("options"),
  regen: document.getElementById("regen-btn"),
  log: document.getElementById("log"),
  backpack: document.getElementById("backpack"),
  bpCount: document.getElementById("bp-count"),
  resetBtn: document.getElementById("reset-btn"),
  historyList: document.getElementById("history-list"),
  histBack: document.getElementById("hist-back"),
  histFwd: document.getElementById("hist-forward"),
  grabHint: document.getElementById("grab-hint"),
  // [MAP]
  mapSvg: document.getElementById("map-svg"),
  mapSummary: document.getElementById("map-summary"),
};

let currentState = {
  sceneDesc: "",
  imageUrl: "",
  options: [],
  regions: [],
};

let historyStack = []; // [{sceneDesc,imageUrl,options,timestamp,action}]
let historyIndex = -1;

let backpack = load("adventure_bp") || [];
let selectedItemId = null;

// Mobile "grab" mode (tap-hold)
let grabItemId = null;
let grabTimer = null;

function setStatus(s) { els.status.textContent = s; }
function log(msg) { els.log.textContent = msg || ""; }
function btn(label, onclick) {
  const b = document.createElement("button");
  b.className = "px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-left";
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

// ---------- persistence ----------
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function saveAll() {
  save("adventure_bp", backpack);
  save("adventure_state", { historyStack, historyIndex });
}
function restoreAll() {
  const saved = load("adventure_state");
  if (!saved || !Array.isArray(saved.historyStack) || saved.historyStack.length === 0) return false;
  historyStack = saved.historyStack;
  historyIndex = Math.min(saved.historyIndex ?? (historyStack.length - 1), historyStack.length - 1);
  const snap = historyStack[historyIndex];
  currentState.sceneDesc = snap.sceneDesc;
  currentState.imageUrl  = snap.imageUrl;
  currentState.options   = snap.options;
  renderScene();
  segmentCurrentImage();
  renderHistory();
  renderBackpack();
  return true;
}

// ---------- history ----------
function pushHistory(actionLabel) {
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  const snap = {
    sceneDesc: currentState.sceneDesc,
    imageUrl: currentState.imageUrl,
    options: currentState.options,
    timestamp: Date.now(),
    action: actionLabel || ""
  };
  historyStack.push(snap);
  historyIndex = historyStack.length - 1;
  renderHistory();
  saveAll();
}
function gotoHistory(idx) {
  if (idx < 0 || idx >= historyStack.length) return;
  historyIndex = idx;
  const snap = historyStack[historyIndex];
  currentState.sceneDesc = snap.sceneDesc;
  currentState.imageUrl  = snap.imageUrl;
  currentState.options   = snap.options;
  renderScene();
  segmentCurrentImage();
  renderHistory();
  saveAll();
}
function renderHistory() {
  els.historyList.innerHTML = "";
  historyStack.forEach((snap, i) => {
    const row = document.createElement("button");
    row.className = "text-left px-2 py-1 rounded border border-slate-800 hover:bg-slate-800";
    if (i === historyIndex) row.classList.add("bg-slate-800");
    const when = new Date(snap.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const action = snap.action ? ` • ${snap.action}` : "";
    row.textContent = `${i+1}. ${when}${action}`;
    row.title = snap.sceneDesc;
    row.onclick = () => gotoHistory(i);
    els.historyList.appendChild(row);
  });
  els.histBack.onclick = () => gotoHistory(Math.max(0, historyIndex - 1));
  els.histFwd.onclick  = () => gotoHistory(Math.min(historyStack.length - 1, historyIndex + 1));
}

// ---------- UI ----------
function renderStart() {
  els.startBtns.innerHTML = "";
  startScenarios.forEach(s => {
    els.startBtns.appendChild(btn(s.prompt, () => newSceneFromPrompt(s.prompt, "", `Start: ${s.id}`)));
  });
}
function renderBackpack() {
  els.backpack.innerHTML = "";
  backpack.forEach(item => {
    const div = document.createElement("button");
    div.className = "sprite";
    div.setAttribute("draggable", "true");
    if (selectedItemId === item.id) div.classList.add("selected");
    if (item.spriteDataUrl) {
      const img = document.createElement("img");
      img.src = item.spriteDataUrl;
      img.alt = item.label; img.title = item.label;
      div.appendChild(img);
    } else {
      div.textContent = item.label.slice(0,2).toUpperCase();
      div.title = item.label;
    }

    // tooltip
    let tip;
    div.addEventListener("mouseenter", () => {
      tip = document.createElement("div"); tip.className = "tooltip"; tip.textContent = item.label; div.appendChild(tip);
    });
    div.addEventListener("mouseleave", () => { if (tip) tip.remove(); });

    // click select
    div.onclick = (e) => { e.stopPropagation(); selectedItemId = (selectedItemId===item.id)?null:item.id; renderBackpack(); };

    // drag & drop
    div.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", item.id); div.dataset.dragging = "true"; selectedItemId = item.id; });
    div.addEventListener("dragend", () => { div.dataset.dragging = "false"; });

    // mobile long-press grab
    div.addEventListener("touchstart", () => {
      if (grabTimer) clearTimeout(grabTimer);
      grabTimer = setTimeout(()=>{ grabItemId=item.id; selectedItemId=item.id; renderBackpack(); showGrabHint(true); }, 350);
    }, {passive:true});
    div.addEventListener("touchend", () => { if (grabTimer) clearTimeout(grabTimer); });

    els.backpack.appendChild(div);
  });
  els.bpCount.textContent = backpack.length ? `${backpack.length} item(s)` : "Empty";
}
function showGrabHint(show){ document.getElementById("grab-hint").classList.toggle("hidden", !show); }

function renderScene() {
  els.sceneDesc.textContent = currentState.sceneDesc;
  els.sceneImg.crossOrigin = "anonymous";
  els.sceneImg.src = currentState.imageUrl;
  els.overlay.innerHTML = "";
  renderOptions();
  setupDropTargets();
}
function renderOptions() {
  els.options.innerHTML = "";
  currentState.options.forEach((opt) => {
    els.options.appendChild(btn(opt, () => branchByOption(opt)));
  });
}

// ---------- scene generation ----------
async function newSceneFromPrompt(userPrompt, extraContext = "", actionLabel = "Choice") {
  try {
    setStatus("Generating scene…");
    log("creating scene + image");
    const res = await fetch("/.netlify/functions/openai", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ op: "scene", prompt: userPrompt, context: extraContext })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "API error");

    currentState.sceneDesc = json.scene_description;
    currentState.imageUrl  = json.image_url;
    currentState.options   = json.options;

    renderScene();
    await segmentCurrentImage();

    // [MAP] update facts based on this scene
    await updateMapFromScene(currentState.sceneDesc);

    pushHistory(actionLabel);
  } catch (err) {
    setStatus("Error");
    console.error(err);
    log(err.message);
  } finally {
    setStatus("Ready");
  }
}

// ---------- segmentation ----------
async function segmentCurrentImage() {
  try {
    setStatus("Analyzing image…");
    const res = await fetch("/.netlify/functions/openai", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ op: "segment", imageUrl: currentState.imageUrl })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Segmentation failed");

    currentState.regions = (json.regions || []).map(r => ({ ...r, area: (r.w*r.h)||0 }));
    drawOverlays();
  } catch (e) {
    console.warn("Segmentation issue:", e);
    log("Segmentation failed (continuing without boxes).");
    currentState.regions = [];
    drawOverlays();
  } finally {
    setStatus("Ready");
  }
}
function drawOverlays() {
  const img = els.sceneImg;
  const update = () => {
    const rect = img.getBoundingClientRect();
    Object.assign(els.overlay.style, { position:"absolute",left:0,top:0,width:rect.width+"px",height:rect.height+"px",pointerEvents:"none" });
    els.overlay.innerHTML = "";
    currentState.regions.forEach((r, idx) => {
      const div = document.createElement("div");
      div.className="hitbox";
      div.style.left=(r.x*rect.width)+"px"; div.style.top=(r.y*rect.height)+"px";
      div.style.width=(r.w*rect.width)+"px"; div.style.height=(r.h*rect.height)+"px";
      div.style.pointerEvents="auto";

      const tag=document.createElement("div"); tag.className="tag";
      const small=r.area<0.035; tag.textContent=(small?"👜 ":"")+(r.label||`Region ${idx+1}`); div.appendChild(tag);

      div.onclick=(ev)=>{
        ev.stopPropagation();
        if (grabItemId) {
          const item = backpack.find(b=>b.id===grabItemId);
          if (item) useItemOnRegion(item, r, `Use ${item.label} → ${r.label}`);
          grabItemId=null; showGrabHint(false);
          return;
        }
        if (selectedItemId) {
          const item = backpack.find(b=>b.id===selectedItemId);
          if (item) useItemOnRegion(item, r, `Use ${item.label} → ${r.label}`);
          return;
        }
        showRegionPopover(ev.clientX, ev.clientY, r);
      };
      els.overlay.appendChild(div);
    });
  };
  if (!img.complete) img.onload = update;
  update();
  window.addEventListener("resize", update, { passive:true });
}
function showRegionPopover(clientX, clientY, region){
  const existing=document.querySelector(".popover"); if (existing) existing.remove();
  const pop=document.createElement("div"); pop.className="popover";
  const title=document.createElement("div"); title.className="text-xs text-slate-300 mb-2";
  const small=region.area<0.035; title.textContent=(region.label||"Region")+(small?" (small item)":""); pop.appendChild(title);
  const optInteract=document.createElement("button"); optInteract.className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 mb-1"; optInteract.textContent="Interact here";
  optInteract.onclick=()=>{ pop.remove(); branchByRegion(region); }; pop.appendChild(optInteract);
  if (small){ const optTake=document.createElement("button"); optTake.className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"; optTake.textContent=`Take the ${region.label}`;
    optTake.onclick=async()=>{ pop.remove(); await takeRegionItem(region); }; pop.appendChild(optTake); }
  document.body.appendChild(pop);
  const {innerWidth:vw,innerHeight:vh}=window; const w=220,h=110; let left=clientX+10,top=clientY+10;
  if (left+w>vw) left=vw-w-10; if (top+h>vh) top=vh-h-10; pop.style.left=`${left}px`; pop.style.top=`${top}px`;
  const close=(e)=>{ if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener("click", close); } };
  setTimeout(()=>document.addEventListener("click", close),0);
}

// ---------- actions ----------
async function branchByOption(optionText){
  await newSceneFromPrompt(optionText, `Follow this choice from the current scene: "${currentState.sceneDesc}"`, "Option");
}
async function branchByRegion(region){
  const regionHint=`Focus on interacting with the "${region.label}" at bbox {x:${region.x.toFixed(2)}, y:${region.y.toFixed(2)}, w:${region.w.toFixed(2)}, h:${region.h.toFixed(2)}}.`;
  await newSceneFromPrompt(`Interact with the ${region.label}.`, regionHint, `Interact: ${region.label}`);
}
async function takeRegionItem(region){
  try {
    setStatus("Picking up item…");
    const spriteDataUrl = await cropSpriteFromImage(region).catch(()=>null);
    const id = `${region.label}-${Date.now()}`;
    backpack.push({ id, label: region.label, spriteDataUrl });
    saveAll();
    renderBackpack();
    log(`Picked up ${region.label}.`);
  } finally { setStatus("Ready"); }
}
async function cropSpriteFromImage(region){
  return new Promise((resolve, reject)=>{
    const img=new Image(); img.crossOrigin="anonymous";
    img.onload=()=>{ try{
      const canvas=document.createElement("canvas"); const size=80; canvas.width=size; canvas.height=size;
      const ctx=canvas.getContext("2d");
      const sx=Math.max(0,Math.floor(region.x*img.width));
      const sy=Math.max(0,Math.floor(region.y*img.height));
      const sw=Math.max(1,Math.floor(region.w*img.width));
      const sh=Math.max(1,Math.floor(region.h*img.height));
      ctx.drawImage(img,sx,sy,sw,sh,0,0,size,size);
      resolve(canvas.toDataURL("image/png"));
    }catch(e){reject(e)} }; img.onerror=reject; img.src=currentState.imageUrl;
  });
}
async function useItemOnRegion(item, region, actionLabel="Use"){
  try{
    setStatus("Using item…"); log(`Using ${item.label} on ${region.label}…`);
    const res=await fetch("/.netlify/functions/openai",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({op:"use",sceneDesc:currentState.sceneDesc,itemLabel:item.label,targetLabel:region.label})});
    const json=await res.json(); if(!res.ok) throw new Error(json.error||"Use failed");

    if (json.consume_item===true){
      backpack = backpack.filter(b=>b.id!==item.id);
      if (selectedItemId===item.id) selectedItemId=null;
      if (grabItemId===item.id){ grabItemId=null; showGrabHint(false); }
      saveAll(); renderBackpack();
    }

    currentState.sceneDesc=json.scene_description;
    currentState.imageUrl=json.image_url;
    currentState.options=json.options;

    renderScene();
    await segmentCurrentImage();

    // [MAP] update after consequence scene too
    await updateMapFromScene(currentState.sceneDesc);

    pushHistory(actionLabel);
  }catch(e){ console.error(e); log(e.message); } finally{ setStatus("Ready"); }
}

// desktop drop targets
function setupDropTargets(){
  els.overlay.querySelectorAll(".hitbox").forEach((box, idx)=>{
    box.addEventListener("dragover",(ev)=>{ ev.preventDefault(); });
    box.addEventListener("drop",(ev)=>{
      ev.preventDefault();
      const itemId=ev.dataTransfer.getData("text/plain");
      const item=backpack.find(b=>b.id===itemId);
      const region=currentState.regions[idx];
      if(item&&region) useItemOnRegion(item, region, `Drop ${item.label} → ${region.label}`);
    });
  });
  els.sceneImg.onclick=()=>{ if (grabItemId){ grabItemId=null; showGrabHint(false); } };
}

// regen/reset
els.regen.onclick = async () => {
  await newSceneFromPrompt(currentState.sceneDesc + " Give a different visual angle and mood.", "regenerate variations", "Regenerate");
};
els.resetBtn.onclick = () => {
  currentState = { sceneDesc: "", imageUrl: "", options: [], regions: [] };
  historyStack = []; historyIndex = -1;
  backpack = []; selectedItemId = null; grabItemId = null;
  // [MAP] clear map too
  MapAPI.clearAll();
  saveAll();
  renderBackpack();
  els.sceneDesc.textContent = ""; els.sceneImg.removeAttribute("src");
  els.overlay.innerHTML = ""; els.options.innerHTML = ""; els.historyList.innerHTML = "";
  log(""); setStatus("Ready"); renderStart();
};

// ---------- [MAP] integration ----------
async function updateMapFromScene(sceneDesc){
  try{
    const knownNames = Object.values(MapAPI._debug().places || {}).map(p=>p.name);
    const res = await fetch("/.netlify/functions/mapFacts",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ sceneDesc, knownPlaces: knownNames })
    });
    const facts = await res.json();
    if (res.ok){
      MapAPI.mergeFacts(facts);
    } else {
      console.warn("mapFacts error:", facts.error);
    }
  } catch (e) {
    console.warn("mapFacts failed:", e);
  }
}

// ---------- boot ----------
renderBackpack();
renderStart();
// init map
MapAPI.init({ svgEl: els.mapSvg, summaryEl: els.mapSummary });
// wire fast travel
MapAPI.setOnFastTravel((place)=>{
  // seed a prompt to “travel to” this place
  newSceneFromPrompt(`Travel to ${place.name}.`, `Fast travel to a previously discovered place: ${place.name}.`, `Travel: ${place.name}`);
});
// Try restore last session
if (!restoreAll()) {
  // no saved state yet
}
