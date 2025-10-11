// map.js — lightweight world graph + layout + rendering

(function () {
  const LS_KEY = "adventure_map";

  /** @typedef {{id:string,name:string,tags:string[],visited:boolean,x?:number,y?:number,notes?:string}} Place */
  /** @typedef {{a:string,b:string,type:"path"|"near"|"river"|"road"|"door",bearing?:"N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW",distance?:1|2|3}} Relation */
  /** @typedef {{places:Record<string,Place>,relations:Relation[],lastPlaceId?:string}} World */

  const state = {
    world: load() || { places: {}, relations: [], lastPlaceId: undefined },
    svg: null,
    summaryEl: null,
    onFastTravel: null, // callback set by main.js
  };

  // ---------- persistence ----------
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(state.world)); }
  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }

  // ---------- helpers ----------
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  // ---------- public API ----------
  function init({ svgEl, summaryEl }) {
    state.svg = svgEl;
    state.summaryEl = summaryEl || null;
    render();
  }

  function setOnFastTravel(cb) {
    state.onFastTravel = cb;
  }

  function clearAll() {
    state.world = { places: {}, relations: [], lastPlaceId: undefined };
    render();
    save();
  }

  function mergeFacts(facts) {
    if (!facts) return;
    const w = state.world;

    // 1) Places
    (facts.places || []).forEach(p => {
      const id = p.id || slug(p.name);
      if (!w.places[id]) {
        w.places[id] = { id, name: p.name, tags: p.tags || [], visited: false, notes: p.notes || "" };
      } else {
        // merge tags + notes conservatively
        const pl = w.places[id];
        pl.tags = Array.from(new Set([...(pl.tags||[]), ...(p.tags||[])]));
        if (p.notes && (!pl.notes || p.notes.length > pl.notes.length)) pl.notes = p.notes;
      }
    });

    // 2) Relations (dedupe)
    const keyOf = (r) => `${r.a}|${r.b}|${r.type}|${r.bearing||""}|${r.distance||""}`;
    const have = new Set(state.world.relations.map(keyOf));
    (facts.relations || []).forEach(r => {
      if (!r.a || !r.b) return;
      if (!w.places[r.a] || !w.places[r.b]) return;
      const k = keyOf(r);
      if (!have.has(k)) {
        have.add(k);
        w.relations.push({ a: r.a, b: r.b, type: r.type || "near", bearing: r.bearing, distance: r.distance });
      }
    });

    // 3) Current place
    if (facts.current_place_id && w.places[facts.current_place_id]) {
      w.lastPlaceId = facts.current_place_id;
      w.places[facts.current_place_id].visited = true;
    }

    layout(w);
    render();
    save();
  }

  function setCurrentPlaceByName(name) {
    // convenience: allow main.js to mark a place visited by name
    const id = Object.keys(state.world.places).find(pid => state.world.places[pid].name.toLowerCase() === name.toLowerCase());
    if (id) {
      state.world.lastPlaceId = id;
      state.world.places[id].visited = true;
      render();
      save();
    }
  }

  // ---------- layout (bearing-constrained, simple springs) ----------
  function layout(world) {
    const ids = Object.keys(world.places);
    if (ids.length === 0) return;

    const seed = world.lastPlaceId && world.places[world.lastPlaceId];
    ids.forEach(id => {
      const p = world.places[id];
      if (p.x == null || p.y == null) {
        if (seed) { p.x = seed.x + (Math.random() - 0.5) * 0.12; p.y = seed.y + (Math.random() - 0.5) * 0.12; }
        else { p.x = Math.random() * 0.8 + 0.1; p.y = Math.random() * 0.8 + 0.1; }
      }
    });

    const vec = (bearing, d) => ({
      N:[0,-d], NE:[d*0.7,-d*0.7], E:[d,0], SE:[d*0.7,d*0.7],
      S:[0,d],  SW:[-d*0.7,d*0.7], W:[-d,0], NW:[-d*0.7,-d*0.7]
    }[bearing] || [0,0]);

    for (let step = 0; step < 80; step++) {
      // relation springs
      world.relations.forEach(r => {
        const a = world.places[r.a], b = world.places[r.b]; if (!a || !b) return;
        const d = 0.18 * (r.distance || 1);
        const [tx, ty] = vec(r.bearing || "E", d);
        const gx = a.x + tx, gy = a.y + ty;
        b.x += (gx - b.x) * 0.08;
        b.y += (gy - b.y) * 0.08;
      });
      // repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const p = world.places[ids[i]], q = world.places[ids[j]];
          let dx = p.x - q.x, dy = p.y - q.y;
          const dist = Math.hypot(dx, dy) + 1e-6;
          const min = 0.07;
          if (dist < min) {
            const push = (min - dist) * 0.035 / dist;
            p.x += dx * push; p.y += dy * push;
            q.x -= dx * push; q.y -= dy * push;
          }
        }
      }
    }
    ids.forEach(id => { const p = world.places[id]; p.x = clamp01(p.x); p.y = clamp01(p.y); });
  }

  // ---------- rendering ----------
  function render() {
    if (!state.svg) return;
    const svg = state.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const W = 600, H = 420;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const world = state.world;

    // edges
    world.relations.forEach(r => {
      const a = world.places[r.a], b = world.places[r.b]; if (!a || !b) return;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", (a.x * W).toFixed(1));
      line.setAttribute("y1", (a.y * H).toFixed(1));
      line.setAttribute("x2", (b.x * W).toFixed(1));
      line.setAttribute("y2", (b.y * H).toFixed(1));
      line.setAttribute("stroke", "rgba(148,163,184,0.55)");
      line.setAttribute("stroke-width", "1.5");
      svg.appendChild(line);
    });

    // pins
    Object.values(world.places).forEach(p => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const cx = p.x * W, cy = p.y * H;

      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", cx); c.setAttribute("cy", cy);
      c.setAttribute("r", 6);
      c.setAttribute("fill", p.visited ? "#38bdf8" : "transparent");
      c.setAttribute("stroke", "#38bdf8");
      c.setAttribute("stroke-width", "1.5");
      g.appendChild(c);

      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", cx + 9); t.setAttribute("y", cy - 9);
      t.setAttribute("font-size", "10");
      t.setAttribute("fill", "#e5e7eb");
      t.textContent = p.name;
      g.appendChild(t);

      g.style.cursor = "pointer";
      g.addEventListener("click", () => openPlaceCard(p.id));
      svg.appendChild(g);
    });

    if (state.summaryEl) {
      const n = Object.keys(world.places).length;
      const v = Object.values(world.places).filter(p => p.visited).length;
      state.summaryEl.textContent = `${v}/${n} visited`;
    }
  }

  // ---------- place card ----------
  function openPlaceCard(placeId) {
    const p = state.world.places[placeId];
    if (!p) return;
    const modal = document.getElementById("place-card");
    const name = document.getElementById("pc-name");
    const tags = document.getElementById("pc-tags");
    const notes = document.getElementById("pc-notes");
    const closeBtn = document.getElementById("pc-close");
    const travelBtn = document.getElementById("pc-travel");

    name.textContent = p.name;
    tags.textContent = (p.tags && p.tags.length) ? p.tags.join(", ") : "—";
    notes.textContent = p.notes || "No notes yet.";
    modal.style.display = "flex";

    closeBtn.onclick = () => { modal.style.display = "none"; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };
    travelBtn.onclick = () => {
      modal.style.display = "none";
      if (typeof state.onFastTravel === "function") {
        state.onFastTravel(p);
      }
    };
  }

  // expose
  window.MapAPI = {
    init,
    mergeFacts,
    setOnFastTravel,
    setCurrentPlaceByName,
    clearAll,
    _debug: () => state.world
  };
})();
