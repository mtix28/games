// Battleship · Schiffe versenken — DOM + SVG (kein Canvas).
//
// Solo gegen den Computer (drei Stufen) und im Hub zu zweit. Eine Factory, zwei Einstiege:
//   window.createBattleship({ root?, net? })  → { go(), destroy() }
// Solo baut die Seite das Spiel selbst (initGame, ganz unten); der Hub (hub-games/battleship.js) reicht
// seinen ctx als `net` durch.
//
// Ablauf: Flotte aufstellen (Drag & Drop, R / Rechtsklick / Klick dreht) → abwechselnd feuern → Flotte versenkt.
// Regeln: 10×10, 5 Schiffe (5-4-3-3-2), Schiffe dürfen sich nicht berühren. Wer trifft (oder versenkt), schießt
// gleich nochmal – erst bei Wasser wechselt das Recht. Versenkte Schiffe werden angesagt; wer zuerst alle hat, gewinnt.
//
// Mehrspieler: Jede Seite hält ihre Flotte geheim. Der Schütze schickt "shot", der Verteidiger antwortet mit
// "res" (Wasser / Treffer / versenkt + Schiff). Erst wenn die Flotte fällt, gibt der Verlierer sie zur Kontrolle preis.

window.createBattleship = (env = {}) => {
  const NET = env.net || null, HUB = !!NET;
  const N = 10, C = 50, M = 36, VB = M + N * C + 12;       // Raster, Zellgröße, Rand links/oben (Koordinaten), viewBox
  const LETTERS = "ABCDEFGHIJ";
  const FLEET = [
    { id: "carrier", name: "Flugzeugträger", len: 5 },
    { id: "battleship", name: "Schlachtschiff", len: 4 },
    { id: "cruiser", name: "Kreuzer", len: 3 },
    { id: "submarine", name: "U-Boot", len: 3 },
    { id: "destroyer", name: "Zerstörer", len: 2 },
  ];
  const LEVELS = { easy: "Leicht", normal: "Normal", hard: "Schwer" };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const coord = (x, y) => LETTERS[x] + (y + 1);
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rnd(a.length)];
  const grid = (v = 0) => Array.from({ length: N }, () => Array(N).fill(v));
  const inB = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
  const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let dead = false;
  const timers = new Set();
  const sleep = (ms) => new Promise((res) => { const t = setTimeout(() => { timers.delete(t); if (!dead) res(); }, REDUCED ? ms * 0.4 : ms); timers.add(t); });

  // ================= Regeln (rein) =================

  const cellsOf = (s) => Array.from({ length: s.len }, (_, i) => (s.h ? [s.x + i, s.y] : [s.x, s.y + i]));
  const pub = (s) => ({ id: s.id, name: s.name, len: s.len, x: s.x, y: s.y, h: s.h });

  // passt das Schiff aufs Feld, ohne ein anderes zu überlappen oder zu berühren?
  function fits(others, s) {
    for (const [cx, cy] of cellsOf(s)) {
      if (!inB(cx, cy)) return false;
      for (const o of others) for (const [ox, oy] of cellsOf(o)) if (Math.abs(ox - cx) <= 1 && Math.abs(oy - cy) <= 1) return false;
    }
    return true;
  }
  // nächste passende Position (Radius r) — Wunschposition zuerst
  function nearestFit(others, base, r = 1) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const s = { ...base, x: base.x + dx, y: base.y + dy };
      if (!fits(others, s)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function randomFleet() {
    for (let tries = 0; tries < 200; tries++) {
      const out = []; let ok = true;
      for (const f of FLEET) {
        let s = null;
        for (let t = 0; t < 120 && !s; t++) {
          const h = Math.random() < 0.5;
          const c = { ...f, h, x: rnd(h ? N - f.len + 1 : N), y: rnd(h ? N : N - f.len + 1) };
          if (fits(out, c)) s = c;
        }
        if (!s) { ok = false; break; }
        out.push(s);
      }
      if (ok) return out;
    }
    return FLEET.map((f, i) => ({ ...f, h: true, x: 0, y: i * 2 }));
  }
  const fresh = (list) => list.map((s) => ({ ...s, hits: 0, sunk: false }));

  // Schuss auf ein Feld mit vollständiger Flotte; marks: 0 offen, 1 Wasser, 2 Treffer
  function applyShot(ships, marks, x, y) {
    if (marks[y][x]) return null;
    const s = ships.find((q) => cellsOf(q).some(([a, b]) => a === x && b === y));
    if (!s) { marks[y][x] = 1; return { r: "miss" }; }
    marks[y][x] = 2; s.hits++;
    if (s.hits >= s.len) { s.sunk = true; return { r: "sunk", ship: pub(s) }; }
    return { r: "hit" };
  }
  const ringOf = (s) => {                                   // Felder rund um ein Schiff (dort kann kein weiteres liegen)
    const out = [];
    for (let y = s.y - 1; y <= (s.h ? s.y + 1 : s.y + s.len); y++) for (let x = s.x - 1; x <= (s.h ? s.x + s.len : s.x + 1); x++) if (inB(x, y)) out.push([x, y]);
    return out;
  };

  // ================= Computer-Gegner =================

  function makeAI(level) {
    const g = grid(0);                                       // 0 unbekannt, 1 Wasser, 2 Treffer (offen), 3 ausgeschlossen/versenkt
    let left = FLEET.map((f) => f.len);
    const unknown = () => { const a = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g[y][x]) a.push([x, y]); return a; };
    const hits = () => { const a = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === 2) a.push([x, y]); return a; };
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const free = (x, y) => inB(x, y) && !g[y][x];
    function neighbours(hs) { const a = []; for (const [x, y] of hs) for (const [dx, dy] of DIRS) if (free(x + dx, y + dy)) a.push([x + dx, y + dy]); return a; }
    function lineEnds(hs) {                                  // zwei Treffer in einer Reihe → verlängern
      const a = [];
      for (const [x, y] of hs) for (const [dx, dy] of DIRS) {
        if (!inB(x + dx, y + dy) || g[y + dy][x + dx] !== 2) continue;
        let cx = x + dx, cy = y + dy;
        while (inB(cx, cy) && g[cy][cx] === 2) { cx += dx; cy += dy; }
        if (free(cx, cy)) a.push([cx, cy]);
      }
      return a;
    }
    function density(hs) {
      const sc = grid(0); let any = false;
      for (const len of left) for (const h of [true, false]) for (let y = 0; y < (h ? N : N - len + 1); y++) for (let x = 0; x < (h ? N - len + 1 : N); x++) {
        let ok = true, cov = 0;
        for (let i = 0; i < len && ok; i++) { const v = g[h ? y : y + i][h ? x + i : x]; if (v === 1 || v === 3) ok = false; else if (v === 2) cov++; }
        if (!ok) continue;
        if (hs.length && !cov) continue;
        any = true;
        const w = 1 + cov * 40;
        for (let i = 0; i < len; i++) { const cx = h ? x + i : x, cy = h ? y : y + i; if (!g[cy][cx]) sc[cy][cx] += w; }
      }
      if (!any) return null;
      let best = -1, cands = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g[y][x]) { if (sc[y][x] > best) { best = sc[y][x]; cands = [[x, y]]; } else if (sc[y][x] === best) cands.push([x, y]); }
      return cands.length ? pick(cands) : null;
    }
    return {
      pick() {
        const hs = hits();
        if (level === "hard") { const d = density(hs); if (d) return d; }
        if (level === "normal") {
          if (hs.length) { const l = lineEnds(hs); if (l.length) return pick(l); const n = neighbours(hs); if (n.length) return pick(n); }
          const par = unknown().filter(([x, y]) => (x + y) % 2 === 0);
          if (par.length) return pick(par);
        }
        if (level === "easy" && hs.length && Math.random() < 0.75) { const n = neighbours(hs); if (n.length) return pick(n); }
        return pick(unknown());
      },
      feed(x, y, res) {
        if (res.r === "miss") { g[y][x] = 1; return; }
        g[y][x] = 2;
        if (res.r === "sunk") {
          const s = res.ship; left.splice(left.indexOf(s.len), 1);
          for (const [cx, cy] of ringOf(s)) g[cy][cx] = g[cy][cx] === 2 || cellsOf(s).some(([a, b]) => a === cx && b === cy) ? 3 : g[cy][cx] || 3;
        }
      },
    };
  }

  // ================= Ton (WebAudio, synthetisch) =================

  const snd = (() => {
    let ac = null, muted = lsGet("bs-mute", "0") === "1";
    const A = () => {
      if (muted) return null;
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
      if (ac.state === "suspended") ac.resume();
      return ac;
    };
    function noise(a, dur, type, f0, f1, vol, delay = 0) {
      const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = type; const t = a.currentTime + delay;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t);
    }
    function tone(a, f0, f1, dur, vol, type = "sine", delay = 0) {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
    }
    return {
      get muted() { return muted; },
      toggle() { muted = !muted; lsSet("bs-mute", muted ? "1" : "0"); return muted; },
      fire() { const a = A(); if (!a) return; noise(a, 0.18, "lowpass", 1800, 300, 0.25); tone(a, 140, 50, 0.3, 0.25); tone(a, 1500, 400, 0.5, 0.05, "sine", 0.06); },
      boom() { const a = A(); if (!a) return; noise(a, 0.9, "lowpass", 1400, 60, 0.7); tone(a, 120, 28, 0.7, 0.55); noise(a, 0.25, "highpass", 3000, 1200, 0.18); },
      splash() { const a = A(); if (!a) return; noise(a, 0.5, "bandpass", 1400, 500, 0.32); noise(a, 0.3, "highpass", 4000, 1500, 0.1, 0.05); },
      sunk() { const a = A(); if (!a) return; noise(a, 1.6, "lowpass", 500, 40, 0.5); tone(a, 90, 24, 1.4, 0.4); tone(a, 330, 110, 0.9, 0.08, "triangle", 0.1); },
      click() { const a = A(); if (!a) return; tone(a, 520, 380, 0.07, 0.12, "triangle"); },
      place() { const a = A(); if (!a) return; tone(a, 220, 120, 0.14, 0.2, "triangle"); noise(a, 0.12, "lowpass", 700, 200, 0.12); },
      nope() { const a = A(); if (!a) return; tone(a, 180, 120, 0.16, 0.12, "square"); },
      win() { const a = A(); if (!a) return; [523, 659, 784, 1047].forEach((f, i) => tone(a, f, f, 0.32, 0.13, "triangle", i * 0.13)); },
      lose() { const a = A(); if (!a) return; [392, 330, 262, 196].forEach((f, i) => tone(a, f, f * 0.98, 0.42, 0.13, "triangle", i * 0.22)); },
      close() { try { ac && ac.close(); } catch {} },
    };
  })();

  // ================= Schiffs-Grafik =================

  function ensureDefs() {
    if (window.__bsDefs) { window.__bsDefs.n++; return; }
    const d = document.createElement("div");
    d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    d.setAttribute("aria-hidden", "true");
    d.innerHTML = `<svg width="0" height="0"><defs>
      <linearGradient id="bs-sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f93c4"/><stop offset=".5" stop-color="#1b6397"/><stop offset="1" stop-color="#0e3a66"/></linearGradient>
      <linearGradient id="bs-hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dde3ea"/><stop offset=".45" stop-color="#97a2b0"/><stop offset="1" stop-color="#5a6574"/></linearGradient>
      <linearGradient id="bs-hullDark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a7783"/><stop offset=".5" stop-color="#3c4752"/><stop offset="1" stop-color="#1c242c"/></linearGradient>
      <linearGradient id="bs-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2f6"/><stop offset="1" stop-color="#8e99a8"/></linearGradient>
      <linearGradient id="bs-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8e4ff"/><stop offset="1" stop-color="#4a88bb"/></linearGradient>
      <linearGradient id="bs-flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#d92b0c"/><stop offset=".5" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ffe680"/></linearGradient>
      <linearGradient id="bs-sweepg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8affc8" stop-opacity="0"/><stop offset="1" stop-color="#8affc8" stop-opacity=".34"/></linearGradient>
      <radialGradient id="bs-fireball"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ffe27a"/><stop offset=".55" stop-color="#ff8a1f"/><stop offset=".85" stop-color="#d3250b"/><stop offset="1" stop-color="#d3250b" stop-opacity="0"/></radialGradient>
      <radialGradient id="bs-glow"><stop offset="0" stop-color="#ff9a3c" stop-opacity=".6"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
      <radialGradient id="bs-water"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#bfe6ff" stop-opacity="0"/></radialGradient>
      <pattern id="bs-wave" width="100" height="50" patternUnits="userSpaceOnUse"><path d="M0 12Q25 2 50 12T100 12" fill="none" stroke="#fff" stroke-opacity=".11" stroke-width="1.6"/><path d="M0 37Q25 27 50 37T100 37" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1.2"/></pattern>
      <pattern id="bs-wood" width="30" height="12" patternUnits="userSpaceOnUse"><rect width="30" height="12" fill="#bf8f58"/><rect y="1" width="30" height="2" fill="#fff" opacity=".08"/><path d="M0 .5H30M0 6.5H30" stroke="#8c6236" stroke-width=".9"/><path d="M10 0V6M22 6V12" stroke="#8c6236" stroke-width=".8"/></pattern>
      <pattern id="bs-steel" width="20" height="10" patternUnits="userSpaceOnUse"><path d="M0 .5H20M0 5.5H20M5 0V5M15 5V10" stroke="#000" stroke-opacity=".16" stroke-width=".8"/><circle cx="1.5" cy="2.5" r=".55" fill="#fff" fill-opacity=".3"/><circle cx="18.5" cy="7.5" r=".55" fill="#fff" fill-opacity=".3"/></pattern>
      <pattern id="bs-tarmac" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#58626d"/><circle cx="3" cy="4" r=".7" fill="#707b87"/><circle cx="11" cy="9" r=".6" fill="#4a535d"/><circle cx="7" cy="13" r=".8" fill="#6c7782"/><circle cx="14" cy="2" r=".5" fill="#4a535d"/></pattern>
      <filter id="bs-blur" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="2.2"/></filter>
      <clipPath id="bs-clip"><rect x="${M}" y="${M}" width="${N * C}" height="${N * C}" rx="12"/></clipPath>
    </defs></svg>`;
    document.body.appendChild(d);
    window.__bsDefs = { el: d, n: 1 };
  }
  function releaseDefs() { const d = window.__bsDefs; if (d && --d.n <= 0) { d.el.remove(); window.__bsDefs = null; } }

  const turret = (x, y = 25, r = 8) => `<g transform="translate(${x},${y})"><circle r="${r}" fill="url(#bs-metal)" stroke="#39424e" stroke-width="1.2"/><rect x="${r - 3}" y="-3.7" width="${r * 1.5}" height="2.5" rx="1" fill="#2d343d"/><rect x="${r - 3}" y="1.2" width="${r * 1.5}" height="2.5" rx="1" fill="#2d343d"/><circle r="${r * 0.42}" fill="#c9d1db" stroke="#39424e" stroke-width=".8"/></g>`;
  const funnel = (x, y = 25, rx = 5, ry = 8) => `<g transform="translate(${x},${y})"><ellipse rx="${rx}" ry="${ry}" fill="#454e5a" stroke="#1d2228" stroke-width="1"/><ellipse rx="${rx * 0.62}" ry="${ry * 0.62}" fill="#0d0f12"/><ellipse cx="${-rx * 0.4}" rx="1.1" ry="${ry * 0.5}" fill="#fff" opacity=".2"/></g>`;
  const bridge = (x, w = 24, h = 18, y = 25) => `<g transform="translate(${x},${y})"><rect y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="url(#bs-metal)" stroke="#39424e" stroke-width="1.2"/><rect x="${w * 0.62}" y="${-h / 2 + 2.5}" width="${w * 0.3}" height="${h - 5}" rx="1.5" fill="url(#bs-glass)"/><rect x="${w * 0.12}" y="${-h / 2 + 3}" width="${w * 0.34}" height="${h - 6}" rx="2" fill="#a9b3c0" stroke="#39424e" stroke-width=".7"/><g class="bs-radar" transform="translate(${w * 0.29},0)"><line x1="-6" x2="6" stroke="#2b323b" stroke-width="2" stroke-linecap="round"/><circle r="1.6" fill="#2b323b"/></g></g>`;
  const plane = (x, y, rot = 0) => `<g transform="translate(${x},${y}) rotate(${rot})"><rect x="-10" y="-1.7" width="20" height="3.4" rx="1.6" fill="#eef1f5" stroke="#5c6672" stroke-width=".6"/><rect x="-2" y="-9.5" width="5" height="19" rx="1" fill="#dde3ea" stroke="#5c6672" stroke-width=".6"/><rect x="-10" y="-4" width="3" height="8" rx="1" fill="#cfd6df" stroke="#5c6672" stroke-width=".5"/><circle cx="9" r="1.6" fill="#7a8591"/></g>`;
  const HULL = {
    ship: (L) => `M10,12 L${L - 36},9 C${L - 16},9 ${L - 5},18 ${L - 3},25 C${L - 5},32 ${L - 16},41 ${L - 36},41 L10,38 Q4,38 4,32 L4,18 Q4,12 10,12Z`,
    carrier: (L) => `M6,6 L${L - 46},6 C${L - 20},6 ${L - 6},17 ${L - 3},25 C${L - 6},33 ${L - 20},44 ${L - 46},44 L6,44 Q3,44 3,41 L3,9 Q3,6 6,6Z`,
    sub: (L) => `M5,25 C5,18 12,15 22,15 L${L - 28},15 C${L - 10},15 ${L - 3},20 ${L - 3},25 C${L - 3},30 ${L - 10},35 ${L - 28},35 L22,35 C12,35 5,32 5,25Z`,
  };
  // Schiff in lokalen Koordinaten: Länge len*50, Breite 50, Bug nach +x
  function art(id, len, mini = false) {
    const L = len * C, kind = id === "carrier" ? "carrier" : id === "submarine" ? "sub" : "ship", hp = HULL[kind](L);
    let s = "";
    if (!mini) {
      s += `<path d="${hp}" transform="translate(3,5)" fill="#02121f" opacity=".38" filter="url(#bs-blur)"/>`;
      s += `<g class="bs-wake"><path d="M4,${kind === "carrier" ? 12 : 20} Q-16,14 -40,11 Q-26,25 -40,39 Q-16,36 4,${kind === "carrier" ? 38 : 30}Z" fill="#fff" opacity=".3"/><path d="M${L - 36},${kind === "sub" ? 13 : 8} Q${L - 12},3 ${L + 3},19" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/><path d="M${L - 36},${kind === "sub" ? 37 : 42} Q${L - 12},47 ${L + 3},31" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".55"/></g>`;
    }
    s += `<path d="${hp}" fill="url(#${kind === "sub" ? "bs-hullDark" : "bs-hull"})" stroke="#2a323c" stroke-width="1.6"/><path d="${hp}" fill="url(#bs-steel)"/>`;
    const deck = (fill = "url(#bs-wood)") => `<path d="${hp}" transform="translate(${L * 0.03} 6.5) scale(.94 .74)" fill="${fill}" stroke="#5e4226" stroke-width="1"/>`;
    if (id === "carrier") {
      s += `<path d="M8,9 L${L - 30},9 L${L - 8},17 L${L - 8},33 L${L - 30},41 L8,41Z" fill="url(#bs-tarmac)" stroke="#2f3740" stroke-width="1.4"/>`;
      s += `<path d="M26,25H${L - 34}" stroke="#f4f4f4" stroke-width="1.8" stroke-dasharray="9 6" opacity=".9"/><path d="M12,13H${L - 42}M12,37H${L - 42}" stroke="#ecc54a" stroke-width="1" opacity=".75"/><path d="M${L - 70},11V39M${L - 62},11V39" stroke="#fff" stroke-width=".8" opacity=".35"/>`;
      s += plane(34, 17, -6) + plane(62, 33, 5) + plane(92, 17, 0);
      s += `<g transform="translate(${L * 0.52},37)"><rect x="0" y="-1" width="36" height="12" rx="3" fill="url(#bs-metal)" stroke="#39424e" stroke-width="1.2"/><rect x="22" y="1.5" width="11" height="7" rx="1.5" fill="url(#bs-glass)"/><g class="bs-radar" transform="translate(10,5)"><line x1="-6" x2="6" stroke="#2b323b" stroke-width="2" stroke-linecap="round"/><circle r="1.6" fill="#2b323b"/></g></g>`;
    } else if (id === "battleship") {
      s += deck() + turret(40) + turret(68) + funnel(98) + bridge(112, 26, 20) + turret(L - 38, 25, 8.5);
    } else if (id === "cruiser") {
      s += deck() + turret(34) + funnel(60) + bridge(74, 24, 18) + turret(L - 32, 25, 7.5);
    } else if (id === "destroyer") {
      s += deck() + turret(24, 25, 6.5) + funnel(42, 25, 4, 6.5) + bridge(52, 18, 15) + turret(L - 24, 25, 6);
    } else {                                                  // U-Boot
      s += `<path d="M12,25H${L - 22}" stroke="#fff" stroke-opacity=".16" stroke-width="2" stroke-linecap="round"/>`;
      s += `<rect x="${L - 44}" y="9" width="10" height="3.4" rx="1.5" fill="#2b343c"/><rect x="${L - 44}" y="37.6" width="10" height="3.4" rx="1.5" fill="#2b343c"/><rect x="10" y="10" width="8" height="3" rx="1.4" fill="#2b343c"/><rect x="10" y="37" width="8" height="3" rx="1.4" fill="#2b343c"/>`;
      s += `<g transform="translate(${L * 0.46},25)"><rect x="-15" y="-6.5" width="30" height="13" rx="6.5" fill="#4c5964" stroke="#1b2229" stroke-width="1.3"/><rect x="-11" y="-4.3" width="14" height="3" rx="1.5" fill="#fff" opacity=".2"/><circle cx="7" r="2.8" fill="#1b2229"/><circle cx="7" r="1.1" fill="#8fe3ff"/></g>`;
      s += `<circle cx="${L * 0.22}" cy="25" r="3.4" fill="#313b44" stroke="#1b2229" stroke-width=".9"/>`;
    }
    if (!mini) s += `<path class="bs-char" d="${hp}"/>`;
    return s;
  }
  function shipG(s, cls = "", i = 0) {
    const L = s.len * C;
    const t = s.h ? `translate(${M + s.x * C},${M + s.y * C})` : `translate(${M + (s.x + 1) * C},${M + s.y * C}) rotate(90)`;
    return `<g class="bs-ship ${cls}" data-id="${s.id}" transform="${t}"><g class="bs-bob" style="animation-delay:${-((i * 1.3) % 4).toFixed(2)}s">${art(s.id, s.len)}</g></g>`;
  }
  const miniSVG = (f, u = 17) => `<svg class="bs-mini" viewBox="0 6 ${f.len * C} 38" style="width:${u * f.len}px;height:${(u * f.len * 38) / (f.len * C)}px">${art(f.id, f.len, true)}</svg>`;

  // ================= Spielfeld =================

  function makeBoard(kind) {
    const root = document.createElement("div");
    root.className = "bs-board " + kind;
    let lab = "";
    for (let i = 0; i < N; i++) lab += `<text x="${M + i * C + C / 2}" y="${M - 13}">${LETTERS[i]}</text><text x="${M - 14}" y="${M + i * C + C / 2 + 1}">${i + 1}</text>`;
    let lines = "";
    for (let i = 1; i < N; i++) lines += `M${M + i * C},${M}V${M + N * C}M${M},${M + i * C}H${M + N * C}`;
    const mid = M + (N * C) / 2;
    root.innerHTML = `<svg class="bs-svg" viewBox="0 0 ${VB} ${VB}" role="img" aria-label="${kind === "foe" ? "Gegnerisches Feld" : "Deine Flotte"}">
      <rect class="bs-frame" width="${VB}" height="${VB}" rx="22"/>
      <g class="bs-lab">${lab}</g>
      <g clip-path="url(#bs-clip)">
        <rect x="${M}" y="${M}" width="${N * C}" height="${N * C}" fill="url(#bs-sea)"/>
        <rect class="bs-waves" x="${M - 100}" y="${M - 50}" width="${N * C + 200}" height="${N * C + 100}" fill="url(#bs-wave)"/>
        <rect class="bs-waves w2" x="${M - 100}" y="${M - 50}" width="${N * C + 200}" height="${N * C + 100}" fill="url(#bs-wave)"/>
        ${kind === "foe" ? `<g transform="translate(${mid},${mid})"><g class="bs-sweep"><path d="M0,0 L420,0 A420,420 0 0 1 ${(420 * Math.cos(0.5)).toFixed(1)},${(420 * Math.sin(0.5)).toFixed(1)}Z" fill="url(#bs-sweepg)"/></g></g><g class="bs-rings"><circle cx="${mid}" cy="${mid}" r="110"/><circle cx="${mid}" cy="${mid}" r="220"/></g>` : ""}
        <path class="bs-grid" d="${lines}"/>
        <g class="L-ships"></g>
      </g>
      <rect class="bs-edge" x="${M}" y="${M}" width="${N * C}" height="${N * C}" rx="12"/>
      <g class="L-marks"></g><g class="L-fx"></g><g class="L-over"></g>
      <rect class="bs-pad" x="${M}" y="${M}" width="${N * C}" height="${N * C}"/>
    </svg><div class="bs-banner" hidden></div>`;
    const svg = root.querySelector("svg"), $ = (c) => root.querySelector(c);
    const Ls = $(".L-ships"), Lm = $(".L-marks"), Lf = $(".L-fx"), Lo = $(".L-over"), banner = $(".bs-banner");
    const ctr = (x, y) => [M + x * C + C / 2, M + y * C + C / 2];
    const svgEl = (html) => { const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.innerHTML = html; return g; };
    const anim = (el, kf, o) => { try { return el.animate(kf, { fill: "forwards", easing: "ease-out", ...o }); } catch { return null; } };
    const fxAdd = (html, life) => { const g = svgEl(html); Lf.appendChild(g); if (life) { const t = setTimeout(() => { timers.delete(t); g.remove(); }, life); timers.add(t); } return g; };
    let ret = null;

    const B = {
      kind, root, svg,
      toCell(cx, cy) {                                       // Bildschirmposition → [Zelle x, Zelle y, float x, float y]
        const r = svg.getBoundingClientRect(), k = r.width / VB;
        const fx = ((cx - r.left) / k - M) / C, fy = ((cy - r.top) / k - M) / C;
        return [Math.floor(fx), Math.floor(fy), fx, fy];
      },
      cellPx() { return (svg.getBoundingClientRect().width / VB) * C; },
      setShips(list, cls = "") { Ls.innerHTML = list.map((s, i) => shipG(s, cls + (s.sunk ? " sunk" : ""), i)).join(""); },
      addShip(s, cls = "") { Ls.insertAdjacentHTML("beforeend", shipG(s, cls + (s.sunk ? " sunk" : ""), Ls.children.length)); },
      shipEl: (id) => Ls.querySelector(`[data-id="${id}"]`),
      clearMarks() { Lm.innerHTML = ""; Lf.innerHTML = ""; },
      mark(x, y, st) {                                       // 1 Wasser, 2 Treffer, 3 sicheres Wasser (rund um ein versenktes Schiff)
        const [cx, cy] = ctr(x, y), k = `${x},${y}`;
        const old = Lm.querySelector(`[data-k="${k}"]`); if (old) old.remove();
        let h;
        if (st === 1) h = `<g class="bs-miss bs-in"><circle class="r" r="13"/><circle class="d" r="3.4"/></g>`;
        else if (st === 3) h = `<circle class="bs-safe" r="2.4"/>`;
        else h = `<g class="bs-fire bs-in"><circle r="22" fill="url(#bs-glow)"/><g class="bs-flame f1"><path d="M0,12 C-11,6 -9,-5 -3,-14 C-2,-7 3,-7 4,-14 C11,-7 11,6 0,12Z" fill="url(#bs-flame)"/></g><g class="bs-flame f2"><path d="M0,10 C-5,6 -4,-1 0,-7 C4,-1 5,6 0,10Z" fill="#fff0a0" opacity=".9"/></g><circle class="bs-smoke s1" r="5"/><circle class="bs-smoke s2" r="4"/><circle class="bs-smoke s3" r="5"/></g>`;
        Lm.insertAdjacentHTML("beforeend", `<g data-k="${k}" transform="translate(${cx},${cy})">${h}</g>`);
      },
      sunkMarks(s) { for (const [x, y] of cellsOf(s)) { const m = Lm.querySelector(`[data-k="${x},${y}"] .bs-fire`); if (m) m.classList.add("out"); } },
      ghost(g) {                                             // Platzier-Vorschau
        if (!g) { Lo.innerHTML = ""; return; }
        const tiles = cellsOf(g).filter(([x, y]) => inB(x, y)).map(([x, y]) => `<rect x="${M + x * C + 2}" y="${M + y * C + 2}" width="${C - 4}" height="${C - 4}" rx="8"/>`).join("");
        Lo.innerHTML = `<g class="bs-ghost ${g.ok ? "ok" : "bad"}">${tiles}<g opacity="${g.ok ? 0.82 : 0.5}">${shipG(g, "ghost")}</g></g>`;
      },
      reticle(x, y, bad) {
        if (x == null) { if (ret) { ret.remove(); ret = null; } return; }
        if (!ret) {
          ret = svgEl(`<rect class="bs-rl row" x="${M}" width="${N * C}" height="${C}"/><rect class="bs-rl col" y="${M}" width="${C}" height="${N * C}"/><g class="bs-rt"><circle class="ring" r="${C * 0.4}"/><path class="br" d="M-22,-10V-22H-10M10,-22H22V-10M22,10V22H10M-10,22H-22V10"/><path class="cr" d="M-9,0H9M0,-9V9"/></g>`);
          ret.setAttribute("class", "bs-ret"); Lo.appendChild(ret);
        }
        const [cx, cy] = ctr(x, y);
        ret.classList.toggle("bad", !!bad);
        ret.querySelector(".row").setAttribute("y", M + y * C); ret.querySelector(".col").setAttribute("x", M + x * C);
        ret.querySelector(".bs-rt").style.transform = `translate(${cx}px,${cy}px)`;
      },
      shake() { root.classList.remove("shake"); void root.offsetWidth; root.classList.add("shake"); const t = setTimeout(() => { timers.delete(t); root.classList.remove("shake"); }, 420); timers.add(t); },
      // Zielerfassung: Ring zieht sich zusammen
      async lock(x, y) {
        const [cx, cy] = ctr(x, y);
        const g = fxAdd(`<g transform="translate(${cx},${cy})"><g class="bs-o"><circle r="34" fill="none" stroke="#ff5470" stroke-width="2.5"/><path d="M-44,0H-26M26,0H44M0,-44V-26M0,26V44" stroke="#ff5470" stroke-width="2.5" stroke-linecap="round"/></g></g>`);
        const inner = g.querySelector(".bs-o");
        anim(inner, [{ transform: "scale(1.9) rotate(60deg)", opacity: 0 }, { transform: "scale(1) rotate(0)", opacity: 1 }], { duration: 250 });
        await sleep(260);
        const t = setTimeout(() => { timers.delete(t); g.remove(); }, 650); timers.add(t);
        anim(inner, [{ opacity: 1 }, { opacity: 0 }], { duration: 650 });
      },
      async shell(x, y) {                                    // Granate fällt vom Himmel aufs Feld
        const [cx, cy] = ctr(x, y);
        const g = fxAdd(`<g transform="translate(${cx},${cy})"><ellipse class="sh" rx="9" ry="5" fill="#000" opacity=".4"/><g class="bs-o bd"><ellipse rx="3.6" ry="8" fill="#e9eef5" stroke="#3b4550" stroke-width="1.2"/><path d="M0,-14V-52" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/></g></g>`, 700);
        snd.fire();
        anim(g.querySelector(".sh"), [{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 0.45 }], { duration: 480, easing: "ease-in" });
        anim(g.querySelector(".bd"), [{ transform: "translateY(-300px) scale(2.6)" }, { transform: "translateY(0) scale(.9)" }], { duration: 480, easing: "cubic-bezier(.5,0,.9,.6)" });
        await sleep(470);
        g.remove();
      },
      impact(x, y, hit) {
        const [cx, cy] = ctr(x, y);
        if (!hit) {
          snd.splash();
          let h = `<g class="bs-o c"><ellipse rx="9" ry="16" fill="url(#bs-water)"/></g>`;
          for (let i = 0; i < 3; i++) h += `<circle class="rg" r="8" fill="none" stroke="#e4f6ff" stroke-width="${2.6 - i * 0.6}"/>`;
          for (let i = 0; i < 9; i++) h += `<circle class="dr" r="${(1.8 + Math.random() * 1.8).toFixed(1)}" fill="#eaf7ff"/>`;
          const g = fxAdd(`<g transform="translate(${cx},${cy})">${h}</g>`, 1300);
          anim(g.querySelector(".c"), [{ transform: "scale(.2,.2)", opacity: 1 }, { transform: "scale(1.1,1.5)", opacity: 0.95, offset: 0.35 }, { transform: "scale(.8,.3)", opacity: 0 }], { duration: 600 });
          g.querySelectorAll(".rg").forEach((r, i) => { r.style.cssText = "transform-box:fill-box;transform-origin:center"; anim(r, [{ transform: "scale(.4)", opacity: 0.95 }, { transform: `scale(${3.4 + i * 0.5})`, opacity: 0 }], { duration: 900, delay: i * 140 }); });
          g.querySelectorAll(".dr").forEach((d) => {
            const a = Math.random() * 6.283, dist = 14 + Math.random() * 22, up = 16 + Math.random() * 18;
            anim(d, [{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * dist * 0.6}px,${Math.sin(a) * dist * 0.4 - up}px)`, opacity: 1, offset: 0.45 }, { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist * 0.5}px)`, opacity: 0 }], { duration: 700 + Math.random() * 200 });
          });
          return;
        }
        snd.boom(); B.shake();
        let h = `<circle class="fl" r="40" fill="#fff"/><circle class="fb" r="30" fill="url(#bs-fireball)"/><circle class="sw" r="12" fill="none" stroke="#fff" stroke-width="3.5"/>`;
        for (let i = 0; i < 12; i++) h += `<circle class="sp" r="${(1.6 + Math.random() * 1.6).toFixed(1)}" fill="${pick(["#ffd36b", "#ff9a3c", "#fff3b0"])}"/>`;
        for (let i = 0; i < 4; i++) h += `<circle class="pf" r="9" fill="#2b2f36"/>`;
        const g = fxAdd(`<g transform="translate(${cx},${cy})">${h}</g>`, 1500);
        const o = "transform-box:fill-box;transform-origin:center";
        g.querySelectorAll("circle").forEach((c) => (c.style.cssText = o));
        anim(g.querySelector(".fl"), [{ transform: "scale(.2)", opacity: 1 }, { transform: "scale(1.2)", opacity: 0 }], { duration: 260 });
        anim(g.querySelector(".fb"), [{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.15)", opacity: 1, offset: 0.35 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 800 });
        anim(g.querySelector(".sw"), [{ transform: "scale(.5)", opacity: 1 }, { transform: "scale(4.2)", opacity: 0 }], { duration: 650 });
        g.querySelectorAll(".sp").forEach((s) => {
          const a = Math.random() * 6.283, d = 26 + Math.random() * 40;
          anim(s, [{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.2)`, opacity: 0 }], { duration: 600 + Math.random() * 300 });
        });
        g.querySelectorAll(".pf").forEach((p, i) => anim(p, [{ transform: "translate(0,0) scale(.4)", opacity: 0.7 }, { transform: `translate(${(i - 1.5) * 10}px,${-24 - i * 7}px) scale(2.4)`, opacity: 0 }], { duration: 1100, delay: 120 + i * 80 }));
      },
      // Versenkt: Schiff aufdecken, Ringe, Banner
      async sink(s, reveal) {
        snd.sunk();
        let el = B.shipEl(s.id);
        if (!el && reveal) { B.addShip({ ...s, sunk: true }, "reveal"); el = B.shipEl(s.id); }
        else if (el) el.classList.add("sunk");
        B.sunkMarks(s);
        const cs = cellsOf(s), mx = cs.reduce((a, c) => a + c[0], 0) / cs.length, my = cs.reduce((a, c) => a + c[1], 0) / cs.length;
        const [cx, cy] = ctr(mx, my);
        let h = ""; for (let i = 0; i < 3; i++) h += `<circle class="rg" r="${s.len * 12}" fill="none" stroke="#e4f6ff" stroke-width="2.6"/>`;
        const g = fxAdd(`<g transform="translate(${cx},${cy})">${h}</g>`, 2200);
        g.querySelectorAll(".rg").forEach((r, i) => { r.style.cssText = "transform-box:fill-box;transform-origin:center"; anim(r, [{ transform: "scale(.3)", opacity: 0.9 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 1300, delay: i * 260 }); });
        banner.hidden = false; banner.textContent = `${s.name} versenkt!`;
        banner.classList.remove("show"); void banner.offsetWidth; banner.classList.add("show");
        await sleep(1250);
        banner.hidden = true;
      },
      popShip(id) { const el = B.shipEl(id); if (!el) return; el.classList.add("pop"); },
      ripple(x, y) {
        const [cx, cy] = ctr(x, y);
        const g = fxAdd(`<g transform="translate(${cx},${cy})"><circle class="rg" r="14" fill="none" stroke="#e4f6ff" stroke-width="2.2"/></g>`, 800);
        const r = g.querySelector(".rg"); r.style.cssText = "transform-box:fill-box;transform-origin:center";
        anim(r, [{ transform: "scale(.5)", opacity: 0.9 }, { transform: "scale(2.6)", opacity: 0 }], { duration: 700 });
      },
      setPresence(on) { root.classList.toggle("dim", !on); },
    };
    return B;
  }

  // ================= Zustand =================

  const S = {
    phase: "setup", round: 0, live: !HUB,
    placed: [], sel: null, selH: true,
    level: LEVELS[lsGet("bs-level", "normal")] ? lsGet("bs-level", "normal") : "normal",
    myReady: false, foeReady: false, hide: lsGet("bs-hide", "0") === "1",
    mine: [], myGrid: grid(), foeGrid: grid(), foeShips: [], foeSunk: [], turn: "me", busy: false, pending: null,
    stats: { shots: 0, hits: 0, t0: 0, t1: 0 }, ai: null, aim: null, log: [], over: null, foeGone: false, overOpen: false,
  };
  const myName = () => (HUB ? (NET.me && NET.me.name) || "Du" : "Du");
  const foeObj = () => (HUB ? (NET.players || []).find((p) => !NET.me || p.id !== NET.me.id) || null : null);
  const foeName = () => (HUB ? (foeObj() && foeObj().name) || "Gegner" : "Computer");
  let boardMine = null, boardFoe = null;

  // ================= DOM-Gerüst =================

  const cleanups = [];
  ensureDefs();
  if (!document.getElementById("bs-style")) {
    const st = document.createElement("style"); st.id = "bs-style"; st.textContent = CSS_TEXT(); document.head.appendChild(st);
  }
  const root = document.createElement("div");
  root.className = "bs " + (HUB ? "hub" : "solo");
  root.innerHTML = `<div class="bs-view"></div>`;
  (env.root || document.getElementById("canvas-wrap") || document.body).appendChild(root);
  const view = root.querySelector(".bs-view");
  const sndBtn = document.createElement("button");           // sitzt in der Kopfleiste der Shell bzw. des Hubs
  sndBtn.type = "button"; sndBtn.className = "bs-snd info-btn"; sndBtn.title = "Ton an/aus"; sndBtn.setAttribute("aria-label", "Ton an/aus");
  const bar = HUB ? env.root.closest(".hk") && env.root.closest(".hk").querySelector(".hk-actions") : document.querySelector("#ui-overlay .row.tight");
  if (bar) bar.prepend(sndBtn); else root.prepend(sndBtn);
  const paintSnd = () => { sndBtn.innerHTML = snd.muted ? `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke-width="2" stroke-linecap="round"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke-width="2" stroke-linecap="round"/></svg>`; };
  paintSnd();
  sndBtn.addEventListener("click", () => { snd.toggle(); paintSnd(); snd.click(); });
  if (!HUB) {                                              // Abstand zur Kopfleiste der Shell
    const top = document.getElementById("ui-overlay");
    if (top) { const fit = () => root.style.setProperty("--bs-top", top.offsetHeight + 10 + "px"); fit(); const ro = new ResizeObserver(fit); ro.observe(top); cleanups.push(() => ro.disconnect()); }
  }

  // eigene Flotte verstecken (falls jemand mitschaut) – am Ende wird sie wieder aufgedeckt
  const EYE = `<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  function applyHide() {
    const on = S.hide && S.phase !== "over";
    boardMine && boardMine.root.classList.toggle("veil", on);
    root.querySelectorAll("[data-a=hide]").forEach((b) => { b.classList.toggle("on", S.hide); b.setAttribute("aria-pressed", S.hide); b.innerHTML = EYE + (S.hide ? "Flotte zeigen" : "Flotte verstecken"); });
  }

  // ================= Aufstellen =================

  const placedIds = () => new Set(S.placed.map((s) => s.id));
  const complete = () => S.placed.length === FLEET.length;
  let drag = null, lastPtr = { x: 0, y: 0 };

  function enterSetup() {
    root.scrollTop = 0; S.phase = "setup"; S.placed = []; S.sel = null; S.selH = true; S.myReady = false; S.foeReady = false; S.pending = null;
    S.busy = false; S.over = null; S.overOpen = false; S.log = []; S.aim = null; S.foeSunk = []; S.mine = []; S.ai = null;
    S.myGrid = grid(); S.foeGrid = grid();
    boardMine = makeBoard("mine"); boardFoe = null;
    view.innerHTML = `<div class="bs-setup">
      <div class="bs-card bs-main"><div class="bs-head"><div><h2>Flotte aufstellen</h2><p class="bs-sub" id="bs-hint"></p></div><span class="bs-count" id="bs-count"></span></div><button type="button" class="bs-hide" data-a="hide" title="Taste H"></button><div class="bs-bw" id="bs-bw"></div></div>
      <div class="bs-card bs-dock" id="bs-dock"></div></div>`;
    view.querySelector("#bs-bw").appendChild(boardMine.root);
    renderDock(); paintShips(); applyHide();
    if (HUB && S.foeGone) setNote("Dein Gegner hat den Raum verlassen.");
  }
  function paintShips(popId) {
    boardMine.setShips(S.placed);
    if (popId) { boardMine.popShip(popId); const s = S.placed.find((q) => q.id === popId); if (s) boardMine.ripple(s.x + (s.h ? (s.len - 1) / 2 : 0), s.y + (s.h ? 0 : (s.len - 1) / 2)); }
  }
  function renderDock() {
    const dock = view.querySelector("#bs-dock"); if (!dock) return;
    const ids = placedIds(), live = S.live;
    const cards = FLEET.map((f) => {
      const on = ids.has(f.id), held = drag && drag.moved && drag.id === f.id;
      return `<div class="bs-sc ${on && !held ? "placed" : ""} ${S.sel === f.id ? "sel" : ""}" data-id="${f.id}" role="button" tabindex="0" aria-label="${f.name}, ${f.len} Felder${on ? ", platziert" : ""}">
        <span class="ico">${miniSVG(f, 18)}</span><span class="nm">${f.name}<small>${f.len} Felder</small></span><span class="st">${on && !held ? `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : ""}</span></div>`;
    }).join("");
    const ready = S.myReady;
    dock.innerHTML = `<h3>Deine Flotte</h3><div class="bs-fl">${cards}</div>
      <div class="bs-row"><button type="button" data-a="rot" ${ready ? "disabled" : ""} title="Taste R · Rechtsklick">⟳ Drehen</button><button type="button" data-a="rnd" ${ready ? "disabled" : ""}>🎲 Zufällig</button><button type="button" data-a="clr" ${ready || !S.placed.length ? "disabled" : ""}>Leeren</button></div>
      ${HUB ? "" : `<div class="bs-lv"><span>Gegner</span><div class="bs-seg" role="radiogroup">${Object.entries(LEVELS).map(([k, v]) => `<button type="button" role="radio" aria-checked="${S.level === k}" data-lv="${k}" class="${S.level === k ? "on" : ""}">${v}</button>`).join("")}</div></div>`}
      <ul class="bs-rules"><li>Treffer oder versenkt: du schießt nochmal</li><li>Wasser: der Gegner ist dran</li><li>Schiffe dürfen sich nicht berühren</li><li>Wer zuerst alle Schiffe versenkt, gewinnt</li></ul>
      <button type="button" class="primary bs-go" data-a="ready" ${!complete() || ready || !live ? "disabled" : ""}>${ready ? "Warte auf " + esc(foeName()) + " …" : HUB ? "Bereit" : "Schlacht beginnen"}</button>
      <p class="bs-note" id="bs-note"></p>`;
    const cnt = view.querySelector("#bs-count"); if (cnt) cnt.textContent = `${S.placed.length} / ${FLEET.length} platziert`;
    const hint = view.querySelector("#bs-hint");
    if (hint) hint.textContent = ready ? "Flotte steht – gleich geht’s los." : S.sel ? `Tippe aufs Feld, um den ${FLEET.find((f) => f.id === S.sel).name} zu setzen.` : "Zieh die Schiffe aufs Feld. Klick auf ein Schiff, R oder Rechtsklick dreht es.";
    if (HUB && !live && !ready) setNote("Verbinde mit den Mitspielern …");
    else if (HUB && S.foeGone) setNote("Dein Gegner hat den Raum verlassen.");
    else if (HUB && ready && !S.foeReady) setNote(`${foeName()} stellt noch auf …`);
  }
  const setNote = (t) => { const n = view.querySelector("#bs-note"); if (n) n.textContent = t || ""; };

  function randomise() {
    S.placed = randomFleet(); S.sel = null; paintShips(); renderDock(); snd.place();
    S.placed.forEach((s, i) => { const t = setTimeout(() => { timers.delete(t); boardMine.popShip(s.id); }, i * 90); timers.add(t); });
  }
  function rotateSel() {
    if (drag && drag.moved) { drag.h = !drag.h; updateDrag(lastPtr.x, lastPtr.y); snd.click(); return; }
    if (S.sel) { S.selH = !S.selH; snd.click(); boardMine.ghost(null); }
  }
  function rotatePlaced(s) {                                 // Klick auf ein platziertes Schiff
    const others = S.placed.filter((q) => q.id !== s.id);
    const f = { ...s, h: !s.h };
    let n = null;
    const cands = [f, { ...f, x: s.h ? s.x + ((s.len / 2) | 0) : s.x - ((s.len / 2) | 0), y: s.h ? s.y - ((s.len / 2) | 0) : s.y + ((s.len / 2) | 0) }];
    for (const c of cands) { n = nearestFit(others, c, 1); if (n) break; }
    if (!n) { snd.nope(); boardMine.shake(); return; }
    S.placed = S.placed.map((q) => (q.id === s.id ? n : q)); paintShips(s.id); renderDock(); snd.place();
  }
  const shipAt = (x, y) => S.placed.find((s) => cellsOf(s).some(([a, b]) => a === x && b === y));

  function placeSel(cx, cy) {
    const f = FLEET.find((q) => q.id === S.sel); if (!f) return false;
    const base = { ...f, h: S.selH, x: S.selH ? cx - ((f.len / 2) | 0) : cx, y: S.selH ? cy : cy - ((f.len / 2) | 0) };
    const clamped = clampShip(base);
    const n = nearestFit(S.placed, clamped, 1);
    if (!n) { snd.nope(); boardMine.shake(); return false; }
    S.placed.push(n); S.sel = null; boardMine.ghost(null); paintShips(n.id); renderDock(); snd.place();
    return true;
  }
  const clampShip = (s) => ({ ...s, x: Math.max(0, Math.min(s.h ? N - s.len : N - 1, s.x)), y: Math.max(0, Math.min(s.h ? N - 1 : N - s.len, s.y)) });

  // ---- Ziehen ----
  function startDrag(e, d) {
    const f = FLEET.find((q) => q.id === d.id), placed = S.placed.find((q) => q.id === d.id);
    drag = { ...d, f, ptr: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, h: placed ? placed.h : S.selH, orig: placed ? { ...placed } : null, ghost: null, inside: false, el: null };
    lastPtr = { x: e.clientX, y: e.clientY };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  }
  function lift() {
    drag.moved = true;
    if (drag.orig) { S.placed = S.placed.filter((q) => q.id !== drag.id); paintShips(); }
    S.sel = null; boardMine.root.classList.add("dragging");
    const cp = boardMine.cellPx(), f = drag.f, el = document.createElement("div");
    el.className = "bs-float"; el.style.cssText = `width:${f.len * cp}px;height:${cp}px`;
    el.innerHTML = `<svg viewBox="0 0 ${f.len * C} ${C}" width="${f.len * cp}" height="${cp}">${art(f.id, f.len, true)}</svg>`;
    document.body.appendChild(el); drag.el = el; drag.cp = cp;
    renderDock();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.ptr) return;
    lastPtr = { x: e.clientX, y: e.clientY };
    if (!drag.moved) { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return; lift(); }
    updateDrag(e.clientX, e.clientY);
  }
  function updateDrag(px, py) {
    if (!drag || !drag.moved) return;
    const [cx, cy, fx, fy] = boardMine.toCell(px, py), f = drag.f, cp = drag.cp;
    drag.inside = fx > -0.7 && fx < N + 0.7 && fy > -0.7 && fy < N + 0.7;
    const grab = drag.from === "board" ? Math.min(drag.grab, f.len - 1) : (f.len / 2) | 0;
    drag.grabUsed = grab;
    const el = drag.el;
    el.style.transformOrigin = `${(grab + 0.5) * cp}px ${cp / 2}px`;
    el.style.transform = `rotate(${drag.h ? 0 : 90}deg)`;
    el.style.left = px - (grab + 0.5) * cp + "px"; el.style.top = py - cp / 2 + "px";
    if (drag.inside) {
      const base = clampShip({ ...f, h: drag.h, x: drag.h ? cx - grab : cx, y: drag.h ? cy : cy - grab });
      const others = S.placed.filter((q) => q.id !== drag.id), n = nearestFit(others, base, 1);
      drag.ghost = n ? { ...n, ok: true } : { ...base, ok: false };
      boardMine.ghost(drag.ghost); el.style.opacity = "0";
    } else { drag.ghost = null; boardMine.ghost(null); el.style.opacity = "1"; }
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.ptr) return;
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
    const d = drag; drag = null;
    if (d.el) d.el.remove();
    boardMine.root.classList.remove("dragging"); boardMine.ghost(null);
    if (!d.moved) {                                          // Klick
      if (d.from === "dock") { S.sel = S.sel === d.id ? null : d.id; S.selH = true; snd.click(); renderDock(); }
      else rotatePlaced(S.placed.find((q) => q.id === d.id));
      return;
    }
    if (d.ghost && d.ghost.ok && e.type !== "pointercancel") {
      const { ok, ...s } = d.ghost; S.placed = [...S.placed.filter((q) => q.id !== d.id), s]; snd.place(); paintShips(d.id);
    } else if (d.orig && d.inside) { S.placed.push(d.orig); snd.nope(); paintShips(); }   // ungültig → zurück
    else if (d.orig) { snd.click(); paintShips(); }                                       // übers Feld hinaus → zurück ins Dock
    else if (d.inside) { snd.nope(); boardMine.shake(); }
    renderDock();
  }

  // ================= Kampf =================

  function enterBattle(first) {
    root.scrollTop = 0; S.phase = "battle"; S.mine = fresh(S.placed); S.myGrid = grid(); S.foeGrid = grid(); S.foeSunk = []; S.log = []; S.aim = null; S.over = null; S.overOpen = false;
    S.foeShips = HUB ? [] : fresh(randomFleet()); S.ai = HUB ? null : makeAI(S.level);
    S.turn = first; S.chain = false; S.busy = false; S.pending = null; S.inbox = []; S.reveal = []; S.stats = { shots: 0, hits: 0, t0: Date.now(), t1: 0 };
    boardMine.clearMarks(); boardMine.setShips(S.mine); boardMine.ghost(null);
    boardFoe = makeBoard("foe");
    view.innerHTML = `<div class="bs-battle">
      <div class="bs-turn" id="bs-turn" aria-live="polite"></div>
      <div class="bs-grid">
        <section class="bs-pane foe" id="bs-pf"><header><div><h3>${esc(foeName())}</h3><span class="bs-sub" id="bs-fs"></span></div><div class="bs-chips" id="bs-cf"></div></header><div class="bs-bw big" id="bs-bwf"></div>
          <div class="bs-aimbar" id="bs-ab"><span id="bs-aim">Ziel wählen</span><button type="button" class="primary" id="bs-fire" disabled>Feuer!</button></div></section>
        <section class="bs-pane mine" id="bs-pm"><header><div><h3>${esc(myName())}</h3><span class="bs-sub" id="bs-ms"></span></div><div class="bs-chips" id="bs-cm"></div><button type="button" class="bs-hide" data-a="hide" title="Taste H"></button></header><div class="bs-bw" id="bs-bwm"></div></section>
        <aside class="bs-pane bs-logp"><h3>Gefechtsbericht</h3><ol class="bs-log" id="bs-log"></ol></aside>
      </div></div>`;
    view.querySelector("#bs-bwf").appendChild(boardFoe.root); view.querySelector("#bs-bwm").appendChild(boardMine.root);
    view.querySelector("#bs-fire").addEventListener("click", () => S.aim && fire(S.aim.x, S.aim.y));
    renderFleets(); renderLog(); renderTurn(); renderAim(); applyHide();
    logAdd({ sys: true, text: first === "me" ? "Du eröffnest das Feuer." : `${foeName()} eröffnet das Feuer.` });
    if (!HUB && first === "foe") aiTurn();
  }

  function renderFleets() {
    const chips = (list, sunkSet, hitsOf) => FLEET.map((f) => {
      const sunk = sunkSet.has(f.id), h = hitsOf ? hitsOf(f.id) : sunk ? f.len : 0;
      return `<span class="bs-chip ${sunk ? "sunk" : ""}" title="${f.name}${sunk ? " – versenkt" : ""}">${miniSVG(f, 11)}<i>${Array.from({ length: f.len }, (_, k) => `<b class="${k < h ? "h" : ""}"></b>`).join("")}</i></span>`;
    }).join("");
    const mSunk = new Set(S.mine.filter((s) => s.sunk).map((s) => s.id)), fSunk = new Set(S.foeSunk.map((s) => s.id));
    const el = (id) => view.querySelector(id);
    if (el("#bs-cm")) el("#bs-cm").innerHTML = chips(S.mine, mSunk, (id) => (S.mine.find((s) => s.id === id) || {}).hits || 0);
    if (el("#bs-cf")) el("#bs-cf").innerHTML = chips(FLEET, fSunk, null);
    if (el("#bs-ms")) el("#bs-ms").textContent = `${S.mine.length - mSunk.size} von ${S.mine.length} Schiffen schwimmen`;
    if (el("#bs-fs")) el("#bs-fs").textContent = `${FLEET.length - fSunk.size} von ${FLEET.length} Schiffen schwimmen`;
  }
  function logAdd(e) { S.log.unshift(e); if (S.log.length > 40) S.log.pop(); renderLog(); }
  function renderLog() {
    const ol = view.querySelector("#bs-log"); if (!ol) return;
    ol.innerHTML = S.log.map((e) => e.sys ? `<li class="sys">${esc(e.text)}</li>` :
      `<li class="${e.who}"><span class="who">${e.who === "me" ? "Du" : esc(foeName())}</span><b>${coord(e.x, e.y)}</b><em class="b-${e.r}">${e.r === "miss" ? "Wasser" : e.r === "hit" ? "Treffer" : esc(e.name) + " versenkt"}</em></li>`).join("");
  }
  function renderTurn() {
    const t = view.querySelector("#bs-turn"); if (!t) return;
    const pf = view.querySelector("#bs-pf"), pm = view.querySelector("#bs-pm");
    const over = S.phase === "over", mine = S.turn === "me" && !over;
    pf && pf.classList.toggle("act", mine); pm && pm.classList.toggle("act", S.turn === "foe" && !over);
    boardFoe && boardFoe.setPresence(over || mine); boardMine.setPresence(over || S.turn === "foe");
    if (over) {
      const w = S.over && S.over.win;
      t.className = "bs-turn " + (w ? "win" : "lose");
      t.innerHTML = `<span class="ic">${w ? "🏆" : "⚓"}</span><div><b>${w ? "Sieg!" : "Niederlage"}</b><small>${esc((S.over && S.over.text) || "")}</small></div><span class="sp"></span>${S.over && S.over.again !== false ? `<button type="button" class="primary" data-a="again">${HUB ? "Revanche" : "Nochmal"}</button>` : ""}`;
    } else if (mine) {
      t.className = "bs-turn me";
      t.innerHTML = `<span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg></span><div><b>${S.chain ? "Treffer! Nochmal dran" : "Du bist dran"}</b><small>${S.chain ? "Wer trifft, darf gleich weiterschießen" : "Wähle ein Ziel auf dem gegnerischen Feld"}</small></div>`;
    } else {
      t.className = "bs-turn foe";
      t.innerHTML = `<span class="ic wait"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12L19 7"/></svg></span><div><b>${esc(foeName())} ${S.chain ? "hat getroffen und zielt nochmal" : "zielt"}<span class="dots"><i>.</i><i>.</i><i>.</i></span></b><small>Dein Feld wird beschossen</small></div>`;
    }
  }
  function renderAim() {
    const a = view.querySelector("#bs-aim"), b = view.querySelector("#bs-fire"); if (!a) return;
    const can = S.phase === "battle" && S.turn === "me" && !S.busy;
    a.innerHTML = S.aim ? `Ziel <b>${coord(S.aim.x, S.aim.y)}</b>` : "Ziel wählen";
    b.disabled = !(can && S.aim && !S.foeGrid[S.aim.y][S.aim.x]);
    view.querySelector("#bs-ab").hidden = S.phase === "over";
    boardFoe.root.classList.toggle("armed", can);
  }

  function aimTo(x, y) {
    if (S.phase !== "battle" || !boardFoe) return;
    if (!inB(x, y)) { if (S.turn === "me" || S.aim) { S.aim = null; boardFoe.reticle(null); renderAim(); } return; }
    S.aim = { x, y }; boardFoe.reticle(x, y, !!S.foeGrid[y][x]); renderAim();
  }

  // ---- ein Schuss, von der Anzeige her ----
  async function playShot(side, x, y, res, lockP, rd) {
    const b = side === "me" ? boardFoe : boardMine, hit = res.r !== "miss";
    await lockP; if (dead || rd !== S.round) return false;
    await b.shell(x, y); if (dead || rd !== S.round) return false;
    if (side === "me") { S.foeGrid[y][x] = hit ? 2 : 1; }
    b.mark(x, y, hit ? 2 : 1); b.impact(x, y, hit);
    logAdd({ who: side, x, y, r: res.r, name: res.ship && res.ship.name });
    if (side === "me") { S.stats.shots++; if (hit) S.stats.hits++; }
    await sleep(hit ? 620 : 520); if (dead || rd !== S.round) return false;
    if (res.r === "sunk") {
      if (side === "me") { S.foeSunk.push(res.ship); for (const [cx, cy] of ringOf(res.ship)) if (!S.foeGrid[cy][cx]) { S.foeGrid[cy][cx] = 3; boardFoe.mark(cx, cy, 3); } }
      await b.sink(res.ship, side === "me"); if (dead || rd !== S.round) return false;
      renderFleets();
    } else if (side === "foe") renderFleets();
    if (boardFoe && S.aim) boardFoe.reticle(S.aim.x, S.aim.y, !!S.foeGrid[S.aim.y][S.aim.x]);
    return true;
  }

  async function fire(x, y) {
    if (S.phase !== "battle" || S.turn !== "me" || S.busy || !inB(x, y) || S.foeGrid[y][x]) { if (S.foeGrid[y] && S.foeGrid[y][x]) { snd.nope(); boardFoe.shake(); } return; }
    const rd = S.round; S.busy = true; renderAim(); snd.click();
    boardFoe.reticle(null);
    const lockP = boardFoe.lock(x, y);
    if (HUB) {
      S.pending = { x, y, lockP }; net("shot", { x, y });
      return;                                                // die Antwort ("res") setzt es fort
    }
    const res = applyShot(S.foeShips, S.foeGrid, x, y);
    S.foeGrid[y][x] = 0;                                     // playShot setzt das Feld erst beim Einschlag
    if (!await playShot("me", x, y, res, lockP, rd)) return;
    afterMyShot(res);
  }
  function afterMyShot(res) {
    S.busy = false;
    if (S.foeSunk.length === FLEET.length || (res && res.over)) { finish(true, "Die gegnerische Flotte ist versenkt."); return; }
    if (res.r !== "miss") { S.chain = true; renderTurn(); renderAim(); return; }     // Treffer → nochmal dran
    S.chain = false; S.turn = "foe"; renderTurn(); renderAim();
    if (!HUB) aiTurn(); else drainInbox();
  }
  async function aiTurn() {
    const rd = S.round;
    await sleep(450); if (dead || rd !== S.round) return;
    const [x, y] = S.ai.pick();
    const lockP = boardMine.lock(x, y);
    const res = applyShot(S.mine, S.myGrid, x, y);
    S.ai.feed(x, y, res);
    if (!await playShot("foe", x, y, res, lockP, rd)) return;
    if (S.mine.every((s) => s.sunk)) { finish(false, "Deine Flotte ist versenkt."); return; }
    if (res.r !== "miss") { S.chain = true; renderTurn(); return aiTurn(); }          // Treffer → Computer schießt nochmal
    S.chain = false; S.turn = "me"; renderTurn(); renderAim();
  }

  function finish(win, text) {
    S.phase = "over"; S.busy = false; S.stats.t1 = Date.now(); S.over = { win, text, again: !S.foeGone };
    boardFoe.reticle(null); S.aim = null;
    if (win) { snd.win(); confetti(); } else snd.lose();
    // übrige Schiffe des Verlierers aufdecken
    revealFoe(HUB ? S.reveal || [] : S.foeShips.map(pub));
    if (HUB && win) net("reveal", { fleet: S.mine.map(pub) });      // der Verlierer sieht jetzt auch meine Flotte
    renderTurn(); renderAim(); renderFleets(); applyHide();
    const rd = S.round;
    sleep(1100).then(() => { if (rd === S.round && S.phase === "over") { S.overOpen = true; renderOver(); } });
  }
  // übrige gegnerische Schiffe aufdecken (am Spielende, egal ob Sieg oder Niederlage)
  function revealFoe(list) {
    for (const s of list) if (!S.foeSunk.some((q) => q.id === s.id) && !boardFoe.shipEl(s.id)) boardFoe.addShip(s, "survivor");
  }
  function confetti() {
    if (typeof window.confetti !== "function") return;
    const col = ["#74e2b2", "#6cb6ff", "#ffcc70", "#ff6e8c", "#b098ff"];
    const f = (a, x) => window.confetti({ particleCount: 90, spread: 75, startVelocity: 46, angle: a, origin: { x, y: 0.7 }, colors: col, zIndex: 300, disableForReducedMotion: true });
    f(60, 0.15); f(120, 0.85);
  }
  function renderOver() {
    root.querySelector(".bs-over")?.remove();
    if (!S.overOpen || !S.over) return;
    const st = S.stats, secs = Math.max(1, Math.round((st.t1 - st.t0) / 1000)), acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    const el = document.createElement("div"); el.className = "bs-over";
    el.innerHTML = `<div class="bs-ov-card ${S.over.win ? "win" : "lose"}" role="dialog" aria-modal="true">
      <div class="big">${S.over.win ? "🏆" : "⚓"}</div><h2>${S.over.win ? "Sieg!" : "Niederlage"}</h2><p>${esc(S.over.text)}</p>
      <div class="bs-stats"><div><b>${st.shots}</b><span>Schüsse</span></div><div><b>${st.hits}</b><span>Treffer</span></div><div><b>${acc}%</b><span>Quote</span></div><div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</b><span>Dauer</span></div></div>
      <div class="bs-row c">${S.over.again !== false ? `<button type="button" class="primary" data-a="again">${HUB ? "Revanche" : "Nochmal spielen"}</button>` : ""}<button type="button" data-a="close">Spielfeld ansehen</button></div></div>`;
    root.appendChild(el);
  }

  // ================= Eingaben =================

  const onPointerDown = (e) => {
    if (S.phase === "setup" && !S.myReady && e.button <= 0) {
      const card = e.target.closest(".bs-sc");
      if (card && !card.classList.contains("placed")) { e.preventDefault(); startDrag(e, { id: card.dataset.id, from: "dock" }); return; }
      if (e.target.closest(".bs-svg") === boardMine.svg) {
        const [cx, cy] = boardMine.toCell(e.clientX, e.clientY), s = inB(cx, cy) && shipAt(cx, cy);
        if (s) { e.preventDefault(); startDrag(e, { id: s.id, from: "board", grab: s.h ? cx - s.x : cy - s.y }); }
        else if (S.sel && inB(cx, cy)) placeSel(cx, cy);
      }
    }
  };
  const onClick = (e) => {
    const a = e.target.closest("[data-a]"), lv = e.target.closest("[data-lv]");
    if (lv) { S.level = lv.dataset.lv; lsSet("bs-level", S.level); snd.click(); renderDock(); return; }
    if (!a) {
      if (S.phase === "battle" && boardFoe && e.target.closest(".bs-svg") === boardFoe.svg) {
        const [cx, cy] = boardFoe.toCell(e.clientX, e.clientY);
        if (!inB(cx, cy) || S.turn !== "me" || S.busy) return;
        if (e.pointerType === "touch" || e.pointerType === "pen") { if (S.aim && S.aim.x === cx && S.aim.y === cy) fire(cx, cy); else aimTo(cx, cy); }
        else { aimTo(cx, cy); fire(cx, cy); }
      }
      return;
    }
    const act = a.dataset.a;
    if (act === "rot") rotateSel();
    else if (act === "rnd") randomise();
    else if (act === "clr") { S.placed = []; S.sel = null; paintShips(); renderDock(); snd.click(); }
    else if (act === "hide") { S.hide = !S.hide; lsSet("bs-hide", S.hide ? "1" : "0"); snd.click(); applyHide(); }
    else if (act === "ready") ready();
    else if (act === "again") again();
    else if (act === "close") { S.overOpen = false; renderOver(); }
  };
  const onMoveHover = (e) => {
    if (e.pointerType === "touch") return;
    if (S.phase === "battle" && boardFoe && e.target.closest(".bs-svg") === boardFoe.svg) {
      if (S.turn !== "me" || S.busy) return;
      const [cx, cy] = boardFoe.toCell(e.clientX, e.clientY); aimTo(cx, cy);
    } else if (S.phase === "setup" && !drag && S.sel && boardMine && e.target.closest(".bs-svg") === boardMine.svg) {
      const [cx, cy] = boardMine.toCell(e.clientX, e.clientY);
      if (!inB(cx, cy)) return boardMine.ghost(null);
      const f = FLEET.find((q) => q.id === S.sel), base = clampShip({ ...f, h: S.selH, x: S.selH ? cx - ((f.len / 2) | 0) : cx, y: S.selH ? cy : cy - ((f.len / 2) | 0) });
      const n = nearestFit(S.placed, base, 1); boardMine.ghost(n ? { ...n, ok: true } : { ...base, ok: false });
    }
  };
  const onLeave = (e) => {
    const svg = e.target.closest && e.target.closest(".bs-svg");
    if (!svg || (e.relatedTarget && svg.contains(e.relatedTarget))) return;
    if (S.phase === "battle" && boardFoe && svg === boardFoe.svg && e.pointerType !== "touch") { boardFoe.reticle(null); S.aim = null; renderAim(); }
    if (S.phase === "setup" && boardMine && svg === boardMine.svg) boardMine.ghost(null);
  };
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest("input,textarea,select"))) return;
    const k = e.key;
    if ((k === "h" || k === "H") && S.phase !== "over") { S.hide = !S.hide; lsSet("bs-hide", S.hide ? "1" : "0"); applyHide(); return; }
    if (S.phase === "setup" && !S.myReady) {
      if (k === "r" || k === "R") { e.preventDefault(); rotateSel(); }
      else if (k === "Enter" && complete() && S.live && e.target === document.body) { e.preventDefault(); ready(); }
      else if ((k === "Enter" || k === " ") && e.target.classList && e.target.classList.contains("bs-sc") && !e.target.classList.contains("placed")) { e.preventDefault(); S.sel = S.sel === e.target.dataset.id ? null : e.target.dataset.id; S.selH = true; renderDock(); }
    } else if (S.phase === "battle" && boardFoe) {
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (mv && S.turn === "me" && !S.busy) { e.preventDefault(); const a = S.aim || { x: 4, y: 4 }; aimTo(Math.max(0, Math.min(N - 1, a.x + (S.aim ? mv[0] : 0))), Math.max(0, Math.min(N - 1, a.y + (S.aim ? mv[1] : 0)))); }
      else if ((k === "Enter" || k === " ") && S.aim && S.turn === "me" && !S.busy && !(e.target.tagName === "BUTTON")) { e.preventDefault(); fire(S.aim.x, S.aim.y); }
    }
  };
  const onWheel = (e) => { if (drag && drag.moved) { e.preventDefault(); rotateSel(); } };
  const onCtx = (e) => { if (drag && drag.moved) { e.preventDefault(); rotateSel(); } else if (S.phase === "setup" && boardMine && e.target.closest(".bs-svg") === boardMine.svg) { const [cx, cy] = boardMine.toCell(e.clientX, e.clientY), s = inB(cx, cy) && shipAt(cx, cy); if (s && !S.myReady) { e.preventDefault(); rotatePlaced(s); } } };
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("click", onClick);
  root.addEventListener("pointermove", onMoveHover);
  root.addEventListener("pointerout", onLeave);
  root.addEventListener("contextmenu", onCtx);
  document.addEventListener("keydown", onKey);
  window.addEventListener("wheel", onWheel, { passive: false });

  // ================= Start / Neustart / Netz =================

  function ready() {
    if (!complete() || S.myReady || !S.live) return;
    snd.click();
    if (!HUB) { enterBattle("me"); return; }
    S.myReady = true; renderDock(); net("ready");
    maybeStart();
  }
  function again() {
    if (HUB) { if (S.foeGone) return; const r = S.round; S.round++; net("rematch", { r }); }
    else S.round++;
    enterSetup();
  }
  const net = (t, d) => { try { NET.send("bs", { t, r: S.round, ...d }); } catch {} };
  function maybeStart() {
    if (!HUB || S.phase !== "setup" || !S.myReady || !S.foeReady || !NET.isHost) return;
    const first = Math.random() < 0.5 ? "me" : "foe";
    net("start", { first: first === "me" ? NET.me.id : (foeObj() || {}).id });
    enterBattle(first);
  }
  async function onNet({ from, data }) {
    const f = foeObj();
    if (!data || !f || from !== f.id) return;
    if (data.t === "rematch") { if (data.r === S.round) { S.round++; enterSetup(); } return; }
    if (data.r !== S.round) return;
    if (data.t === "ready") { S.foeReady = true; if (S.phase === "setup") { renderDock(); maybeStart(); } }
    else if (data.t === "start" && from === NET.hostId && S.phase === "setup" && S.myReady) enterBattle(data.first === NET.me.id ? "me" : "foe");
    else if (data.t === "reveal" && Array.isArray(data.fleet)) {
      S.reveal = data.fleet.filter((q) => FLEET.some((f) => f.id === q.id) && Number.isInteger(q.x) && Number.isInteger(q.y)).map(pub);
      if (S.phase === "over" && boardFoe) revealFoe(S.reveal);
    }
    else if (data.t === "shot") await onShot(data);
    else if (data.t === "res") await onRes(data);
  }
  async function onShot(d) {
    const { x, y } = d;
    if (S.phase !== "battle" || !Number.isInteger(x) || !Number.isInteger(y) || !inB(x, y) || S.myGrid[y][x]) return;
    if (S.turn !== "foe" || S.busy) { S.inbox.push(d); return; }    // der Gegner war schneller als meine Animation → gleich dran
    const rd = S.round; S.busy = true;
    const res = applyShot(S.mine, S.myGrid, x, y), over = S.mine.every((s) => s.sunk);
    net("res", { x, y, k: res.r, ship: res.ship, over, fleet: over ? S.mine.map(pub) : undefined });
    const ok = await playShot("foe", x, y, res, boardMine.lock(x, y), rd);
    if (!ok) return;
    S.busy = false;
    if (over) { finish(false, `${foeName()} hat deine Flotte versenkt.`); return; }
    if (res.r !== "miss") { S.chain = true; renderTurn(); drainInbox(); return; }       // Gegner trifft → er schießt nochmal
    S.chain = false; S.turn = "me"; renderTurn(); renderAim();
  }
  const drainInbox = () => { const d = S.inbox.shift(); if (d) onShot(d); };
  async function onRes({ x, y, k: r, ship, over, fleet }) {
    const p = S.pending;
    if (S.phase !== "battle" || !p || p.x !== x || p.y !== y || !["miss", "hit", "sunk"].includes(r)) return;
    S.pending = null;
    const res = { r, ship: r === "sunk" && ship && FLEET.some((q) => q.id === ship.id) ? pub(ship) : undefined, over: !!over };
    if (r === "sunk" && !res.ship) res.r = "hit";
    S.reveal = Array.isArray(fleet) ? fleet.filter((s) => FLEET.some((q) => q.id === s.id) && Number.isInteger(s.x) && Number.isInteger(s.y)).map(pub) : [];
    S.foeGrid[y][x] = 0;
    if (!await playShot("me", x, y, res, p.lockP, S.round)) return;
    afterMyShot(res);
  }
  function foeLeft() {
    S.foeGone = true;
    if (S.phase === "setup") { S.foeReady = false; renderDock(); }
    else if (S.phase === "battle") { finish(true, `${foeName()} hat das Spiel verlassen.`); S.over.again = false; renderTurn(); }
    else if (S.phase === "over") { if (S.over) S.over.again = false; renderTurn(); renderOver(); }
  }
  if (HUB) {
    NET.onMessage("bs", onNet);
    NET.onEvent("leave", (p) => { const f = foeObj(); if (!f || (p && p.id === f.id)) foeLeft(); });
    NET.onEvent("players", () => { if (S.phase === "setup") renderDock(); });
  }

  enterSetup();

  return {
    go() { S.live = true; if (S.phase === "setup") renderDock(); },
    startSolo() { S.round++; enterSetup(); },
    confirmAbort() { return S.phase !== "battle" || confirm("Aktuelles Spiel abbrechen?"); },
    destroy() {
      dead = true; timers.forEach(clearTimeout); timers.clear();
      document.removeEventListener("keydown", onKey); window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
      if (drag && drag.el) drag.el.remove();
      cleanups.forEach((f) => f()); snd.close(); sndBtn.remove(); root.remove(); releaseDefs();
    },
  };
};

// ================= Styles =================

function CSS_TEXT() {
  return `
.bs{--bs-top:12px;position:relative;color:var(--ink);font-family:var(--font);line-height:1.35;-webkit-user-select:none;user-select:none;box-sizing:border-box}
.bs *,.bs *::before,.bs *::after{box-sizing:border-box}
.bs.solo{position:absolute;inset:0;overflow:auto;padding:var(--bs-top) 18px 28px;overscroll-behavior:contain}
.bs.hub{padding:0;min-height:60vh}
.bs-view{max-width:1240px;margin:0 auto}
.bs h2,.bs h3{margin:0;font-family:var(--font-display);letter-spacing:var(--title-tracking,0);text-transform:var(--title-transform,none)}
.bs h2{font-size:22px;font-weight:var(--title-weight,800)}.bs h3{font-size:15px;font-weight:700}
.bs-sub,.bs small{color:var(--muted);font-size:13px}
.bs-snd{display:grid;place-items:center;padding:0}
.bs-snd svg{width:18px;height:18px;fill:currentColor;stroke:currentColor}
.bs-card,.bs-pane{background:var(--card-bg,var(--panel));border:var(--border-w,1px) solid var(--hairline);border-radius:var(--r-xl,20px);box-shadow:var(--card-shadow);padding:16px}
.bs-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
.bs-head p{margin:4px 0 0}
.bs-count{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);padding:5px 10px;border-radius:99px;background:var(--panel-2,var(--panel));white-space:nowrap}
/* ---- Spielfeld ---- */
.bs-bw{width:min(100%,calc(100svh - var(--bs-top) - 150px));min-width:min(100%,300px);margin:0 auto}
.bs.hub .bs-bw{width:min(100%,calc(100svh - 280px))}
.bs-board{position:relative;border-radius:22px;transition:filter .35s,opacity .35s}
.bs-board.dim{filter:saturate(.55) brightness(.82)}
.bs-svg{display:block;width:100%;height:auto;aspect-ratio:1;touch-action:none;overflow:visible;border-radius:22px}
.bs-board.foe .bs-svg{touch-action:manipulation}
.bs-frame{fill:var(--panel-2,var(--panel));stroke:var(--hairline);stroke-width:1.5}
.bs-lab text{fill:var(--muted);font:700 15px var(--font);text-anchor:middle;dominant-baseline:middle}
.bs-grid{fill:none;stroke:#fff;stroke-opacity:.16;stroke-width:1}
.bs-edge{fill:none;stroke:#05182b;stroke-opacity:.55;stroke-width:3}
.bs-waves{animation:bs-drift 16s linear infinite}.bs-waves.w2{animation-duration:23s;animation-direction:reverse;opacity:.7;transform:translate(0,25px)}
@keyframes bs-drift{from{transform:translate(0,0)}to{transform:translate(-100px,0)}}
.bs-waves.w2{animation-name:bs-drift2}@keyframes bs-drift2{from{transform:translate(-100px,25px)}to{transform:translate(0,25px)}}
.bs-sweep{animation:bs-spin 7s linear infinite}
.bs-rings circle{fill:none;stroke:#8affc8;stroke-opacity:.12;stroke-width:1.2}
@keyframes bs-spin{to{transform:rotate(360deg)}}
.bs-pad{fill:transparent}.bs-board.foe .bs-pad{cursor:not-allowed}.bs-board.foe.armed .bs-pad{cursor:crosshair}
.bs-board.foe:not(.armed) .bs-ret{opacity:.35}
/* Schiffe */
.bs-ship .bs-bob{animation:bs-bob 4.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes bs-bob{0%,100%{transform:translate(0,0) rotate(0)}50%{transform:translate(0,1.4px) rotate(.5deg)}}
.bs-wake{animation:bs-wake 3.2s ease-in-out infinite}@keyframes bs-wake{0%,100%{opacity:.85}50%{opacity:.45}}
.bs-radar line{animation:bs-spin 2.6s linear infinite}
.bs-char{fill:#0a0c10;opacity:0;transition:opacity 1.2s}
.bs-ship.sunk .bs-char{opacity:.62}.bs-ship.sunk .bs-wake,.bs-ship.sunk .bs-radar line{animation:none;opacity:0}
.bs-ship.sunk .bs-bob{animation:bs-sink 1.6s ease-in forwards}
@keyframes bs-sink{0%{transform:translate(0,0) rotate(0) scale(1)}60%{transform:translate(0,3px) rotate(2.5deg) scale(.985)}100%{transform:translate(0,4px) rotate(2deg) scale(.97)}}
.bs-ship.survivor{opacity:.72}.bs-ship.survivor .bs-bob{animation:none}.bs-ship.survivor .bs-wake{display:none}
.bs-ship.reveal{animation:bs-reveal .9s ease-out both}@keyframes bs-reveal{from{opacity:0}to{opacity:1}}
.bs-ship.pop .bs-bob{animation:bs-pop .5s cubic-bezier(.3,1.5,.5,1) both,bs-bob 4.4s ease-in-out .5s infinite}
@keyframes bs-pop{0%{transform:scale(.84) translateY(-5px);opacity:.3}100%{transform:scale(1);opacity:1}}
.bs-ship.ghost .bs-bob,.bs-ship.ghost .bs-wake,.bs-ship.ghost .bs-radar line{animation:none}
.bs-board.dragging .bs-ship .bs-bob{animation:none}
/* Markierungen */
.bs-miss .r{fill:none;stroke:#e9f7ff;stroke-width:2;stroke-opacity:.8;transform-box:fill-box;transform-origin:center;animation:bs-ring 3.4s ease-out infinite}
.bs-miss .d{fill:#e9f7ff;fill-opacity:.9}
@keyframes bs-ring{0%{transform:scale(.45);opacity:.9}100%{transform:scale(1.5);opacity:0}}
.bs-safe{fill:#fff;fill-opacity:.32}
.bs-in{animation:bs-in .35s ease-out both}@keyframes bs-in{from{opacity:0}to{opacity:1}}
.bs-flame{transform-box:fill-box;transform-origin:50% 100%;animation:bs-flick .7s ease-in-out infinite}
.bs-flame.f2{animation-duration:.5s;animation-delay:-.2s}
@keyframes bs-flick{0%,100%{transform:scale(1,1) skewX(0)}30%{transform:scale(.9,1.14) skewX(4deg)}65%{transform:scale(1.06,.9) skewX(-4deg)}}
.bs-smoke{fill:#2c3037;opacity:0;transform-box:fill-box;transform-origin:center;animation:bs-smoke 2.8s ease-out infinite}
.bs-smoke.s2{animation-delay:.9s}.bs-smoke.s3{animation-delay:1.8s}
@keyframes bs-smoke{0%{transform:translate(0,-4px) scale(.5);opacity:0}15%{opacity:.5}100%{transform:translate(5px,-34px) scale(2.4);opacity:0}}
.bs-fire.out .bs-flame{animation:none;transform:scale(.55);opacity:.7}.bs-fire.out circle:first-child{opacity:.5}
.bs-fx .bs-o,.bs-o{transform-box:fill-box;transform-origin:center}
/* Fadenkreuz & Vorschau */
.bs-rl{fill:#fff;fill-opacity:.07;pointer-events:none}
.bs-rt{transition:transform .09s ease-out;pointer-events:none}
.bs-rt .ring{fill:rgba(255,84,112,.12);stroke:#ff5470;stroke-width:2;stroke-dasharray:6 5;transform-box:fill-box;transform-origin:center;animation:bs-spin 5s linear infinite}
.bs-rt .br{fill:none;stroke:#ff5470;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.bs-rt .cr{fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}
.bs-ret.bad .br,.bs-ret.bad .ring{stroke:#8a93a6}.bs-ret.bad .ring{fill:rgba(130,140,160,.2);animation:none}.bs-ret.bad .cr{stroke:#8a93a6}
.bs-ghost>rect{fill:rgba(116,226,178,.4);stroke:#74e2b2;stroke-width:2;pointer-events:none}
.bs-ghost.bad>rect{fill:rgba(255,110,140,.4);stroke:#ff6e8c}
.bs-ghost{pointer-events:none}
.bs-float{position:fixed;z-index:9999;pointer-events:none;filter:drop-shadow(0 10px 12px rgba(0,0,0,.45));transition:opacity .12s}
.bs-float svg{display:block;overflow:visible}
.bs-board.shake{animation:bs-shake .42s}
@keyframes bs-shake{0%,100%{transform:none}15%{transform:translate(-5px,2px) rotate(-.4deg)}35%{transform:translate(5px,-2px) rotate(.4deg)}55%{transform:translate(-3px,1px)}75%{transform:translate(2px,-1px)}}
.bs-banner{position:absolute;left:50%;top:44%;z-index:3;transform:translate(-50%,-50%);pointer-events:none;padding:10px 22px;border-radius:99px;font:800 clamp(16px,3.6vw,26px) var(--font-display);color:#fff;background:linear-gradient(135deg,#e0364f,#ff7a3c);box-shadow:0 10px 30px rgba(224,54,79,.5);white-space:nowrap;opacity:0}
.bs-banner.show{animation:bs-banner 1.25s ease-out both}
@keyframes bs-banner{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}28%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-70%) scale(1)}}
/* Aufstellen */
.bs-setup{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start}
.bs-dock{display:flex;flex-direction:column;gap:14px}
.bs-fl{display:flex;flex-direction:column;gap:8px}
.bs-sc{display:grid;grid-template-columns:auto 1fr 22px;align-items:center;gap:12px;padding:9px 12px;border-radius:var(--r-md,14px);background:var(--panel-2,var(--panel));border:1.5px solid transparent;cursor:grab;touch-action:none;transition:transform .15s,border-color .15s,background .15s,opacity .2s}
.bs-sc:hover{border-color:var(--lineHi,var(--edge-hover,var(--hairline)))}
.bs-sc:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bs-sc.sel{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--panel-2,var(--panel)))}
.bs-sc.placed{opacity:.5;cursor:default}
.bs-sc .ico{display:grid;place-items:center;min-width:92px}
.bs-sc .nm{font-weight:600;display:flex;flex-direction:column;line-height:1.2}
.bs-sc .st svg{width:20px;height:20px;fill:none;stroke:var(--mint);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.bs-mini{display:block;overflow:visible}
.bs-row{display:flex;flex-wrap:wrap;gap:8px}.bs-row.c{justify-content:center}
.bs-row button{flex:1 1 auto;padding:10px 12px}
.bs-hide{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:13px;border-radius:99px}
.bs-hide svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.bs-hide.on{background:var(--accent);color:var(--onAccent,#14122a)}
.bs-main .bs-hide{margin:-4px 0 12px}
.bs-board .L-ships{transition:opacity .35s}.bs-board.veil .L-ships{opacity:0}
.bs-board.veil .bs-svg{cursor:default}
.bs-board.veil::after{content:"Flotte versteckt";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:6px 14px;border-radius:99px;background:rgba(6,20,40,.62);color:#cfe6ff;font:700 13px var(--font);pointer-events:none;white-space:nowrap}
.bs-lv{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-size:14px}
.bs-seg{display:flex;padding:3px;border-radius:99px;background:var(--panel-2,var(--panel));gap:2px}
.bs-seg button{padding:6px 12px;border-radius:99px;border:0;background:transparent;font-size:13px;box-shadow:none}
.bs-seg button.on{background:var(--accent);color:var(--onAccent,#14122a)}
.bs-go{padding:14px;font-size:16px;font-weight:700}
.bs-rules{margin:0;padding:0 0 0 18px;color:var(--muted);font-size:13px;display:grid;gap:3px}
.bs-note{margin:0;min-height:1.3em;color:var(--muted);font-size:13px;text-align:center}
/* Kampf */
.bs-battle{display:flex;flex-direction:column;gap:14px}
.bs-turn{display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:var(--r-xl,20px);background:var(--card-bg,var(--panel));border:var(--border-w,1px) solid var(--hairline);box-shadow:var(--card-shadow);min-height:64px;transition:background .3s,border-color .3s}
.bs-turn b{display:block;font-size:17px}.bs-turn .sp{flex:1}
.bs-turn .ic{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;font-size:22px;background:var(--panel-2,var(--panel))}
.bs-turn .ic svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.bs-turn.me{border-color:var(--mint);background:color-mix(in srgb,var(--mint) 12%,var(--card-bg,var(--panel)))}.bs-turn.me .ic{color:var(--mint);animation:bs-pulse 1.4s ease-in-out infinite}
.bs-turn.foe .ic.wait svg{animation:bs-spin 2.4s linear infinite}.bs-turn.foe{color:var(--ink)}
.bs-turn.win{border-color:var(--mint);background:color-mix(in srgb,var(--mint) 16%,var(--card-bg,var(--panel)))}.bs-turn.lose{border-color:var(--rose);background:color-mix(in srgb,var(--rose) 14%,var(--card-bg,var(--panel)))}
@keyframes bs-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--mint) 55%,transparent)}50%{box-shadow:0 0 0 9px transparent}}
.dots i{font-style:normal;animation:bs-dot 1.2s infinite}.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes bs-dot{0%,60%,100%{opacity:.2}30%{opacity:1}}
.bs-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);grid-template-areas:"foe mine" "foe log";gap:14px;align-items:start}
.bs-pane.foe{grid-area:foe}.bs-pane.mine{grid-area:mine}.bs-logp{grid-area:log}
.bs-pane{transition:box-shadow .3s,border-color .3s}
.bs-pane.act{border-color:var(--mint);box-shadow:0 0 0 1px var(--mint),0 0 34px color-mix(in srgb,var(--mint) 28%,transparent)}
.bs-pane.mine.act{border-color:var(--rose);box-shadow:0 0 0 1px var(--rose),0 0 34px color-mix(in srgb,var(--rose) 26%,transparent)}
.bs-pane header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px 14px;flex-wrap:wrap;margin-bottom:12px}
.bs-chips{display:flex;flex-wrap:wrap;gap:6px}
.bs-chip{display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 7px;border-radius:9px;background:var(--panel-2,var(--panel));position:relative}
.bs-chip i{display:flex;gap:2px}.bs-chip b{width:6px;height:6px;border-radius:50%;background:var(--dim,#555);transition:background .3s}
.bs-chip b.h{background:var(--rose)}
.bs-chip.sunk{opacity:.55}.bs-chip.sunk::after{content:"";position:absolute;left:4px;right:4px;top:50%;height:2px;background:var(--rose);transform:rotate(-12deg);border-radius:2px}
.bs-pane .bs-bw.big{width:min(100%,calc(100svh - var(--bs-top) - 250px));min-width:min(100%,300px)}
.bs.hub .bs-pane .bs-bw.big{width:min(100%,calc(100svh - 360px))}
.bs-pane.mine .bs-bw{width:100%}
.bs-aimbar[hidden]{display:none!important}
.bs-aimbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding:8px 8px 8px 16px;border-radius:99px;background:var(--panel-2,var(--panel))}
.bs-aimbar b{color:var(--rose)}.bs-aimbar button{padding:10px 24px;font-weight:800;letter-spacing:.02em}
.bs-log{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:5px;max-height:230px;overflow:auto;font-size:14px}
.bs-log li{display:flex;align-items:center;gap:8px;padding:5px 9px;border-radius:9px;background:var(--panel-2,var(--panel));animation:bs-in .3s both}
.bs-log li.sys{color:var(--muted);background:none;padding-left:2px;font-size:13px}
.bs-log .who{color:var(--muted);font-size:12px;min-width:3.4em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:7em}
.bs-log b{font-variant-numeric:tabular-nums}.bs-log em{font-style:normal;margin-left:auto;font-size:12.5px;font-weight:700;padding:2px 8px;border-radius:99px}
.b-miss{background:color-mix(in srgb,var(--sky) 20%,transparent);color:var(--sky)}.b-hit{background:color-mix(in srgb,var(--sun) 24%,transparent);color:var(--sun)}.b-sunk{background:color-mix(in srgb,var(--rose) 24%,transparent);color:var(--rose)}
/* Ergebnis */
.bs-over{position:fixed;inset:0;z-index:250;display:grid;place-items:center;padding:20px;background:rgba(6,8,20,.62);backdrop-filter:blur(6px);animation:bs-in .4s both}
.bs.hub .bs-over{position:absolute;border-radius:var(--r-xl,20px);align-items:start;padding-top:8vh}
.bs-ov-card{width:min(440px,100%);text-align:center;padding:28px 24px;border-radius:var(--r-xl,22px);background:var(--card-bg,var(--panel));border:2px solid var(--mint);box-shadow:0 30px 80px rgba(0,0,0,.5);animation:bs-card .55s cubic-bezier(.3,1.4,.5,1) both}
.bs-ov-card.lose{border-color:var(--rose)}
@keyframes bs-card{from{transform:scale(.8) translateY(20px);opacity:0}to{transform:none;opacity:1}}
.bs-ov-card .big{font-size:56px;line-height:1}.bs-ov-card h2{font-size:30px;margin:8px 0 4px}.bs-ov-card p{margin:0 0 18px;color:var(--muted)}
.bs-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px}
.bs-stats div{padding:10px 4px;border-radius:12px;background:var(--panel-2,var(--panel))}.bs-stats b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.bs-stats span{font-size:12px;color:var(--muted)}
@media (max-width:980px){
  .bs-setup{grid-template-columns:1fr}
  .bs-grid{grid-template-columns:1fr;grid-template-areas:"foe" "mine" "log"}
  .bs-bw,.bs-pane .bs-bw.big,.bs.hub .bs-bw,.bs.hub .bs-pane .bs-bw.big{width:min(100%,640px)}
  .bs-pane.mine .bs-bw{width:min(100%,420px)}
  .bs-turn{position:sticky;top:calc(var(--bs-top) - 6px);z-index:20}
  .bs-turn{padding:8px 14px;min-height:0;gap:10px}.bs-turn small{display:none}.bs-turn .ic{width:32px;height:32px;font-size:18px}.bs-turn b{font-size:15px}
  .bs-aimbar{position:sticky;bottom:10px;z-index:15;box-shadow:0 8px 24px rgba(0,0,0,.35)}
}
@media (max-width:520px){.bs.solo{padding-left:10px;padding-right:10px}.bs-card,.bs-pane{padding:12px}.bs-stats{grid-template-columns:repeat(2,1fr)}}
@media (prefers-reduced-motion:reduce){.bs *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;
}

// ================= Solo-Einstieg =================

if (!window.__BATTLESHIP_HUB__ && typeof initGame === "function") {
  let game = null;
  initGame({
    title: "Schiffe versenken",
    tag: "Battleship",
    fullscreen: true,
    presets: [],
    buttons: [{ id: "btn-new", label: "Neues Spiel", primary: true, onClick: () => { if (game && game.confirmAbort()) game.startSolo(); } }],
    sliders: [],
    onPreset: () => {}, onSlider: () => {}, onClamp: () => {}, getSliderValues: () => ({}),
    info: {
      anim: infoAnim,
      title: "So funktioniert’s",
      text: [
        "Stelle deine fünf Schiffe per Drag &amp; Drop auf (Klick, <b>R</b> oder Rechtsklick dreht, Schiffe dürfen sich nicht berühren). Dann wird abwechselnd gefeuert – wer zuerst alle gegnerischen Schiffe versenkt, gewinnt.",
        "Zielen mit der Maus oder den Pfeiltasten, <b>Enter</b> feuert. Am Handy: erst antippen, dann „Feuer!“. Gegen den Computer gibt es drei Stufen; im Hub spielst du zu zweit.",
      ],
    },
  });
  game = window.createBattleship();
}

function infoAnim(p, w, h, f) {
  const T = f % 240, C = 22, ox = 60, oy = 30;
  p.background(14, 44, 78); p.noStroke();
  for (let i = 0; i < 7; i++) { p.fill(255, 255, 255, 10); p.rect(0, 20 + i * 38 + Math.sin((f + i * 20) / 18) * 4, w, 3); }
  p.stroke(255, 255, 255, 40); p.strokeWeight(1);
  for (let i = 0; i <= 10; i++) { p.line(ox + i * C, oy, ox + i * C, oy + 10 * C); p.line(ox, oy + i * C, ox + 10 * C, oy + i * C); }
  p.noStroke();
  const ship = (x, y, len, c) => { p.fill(0, 0, 0, 60); p.rect(ox + x * C + 3, oy + y * C + 7, len * C - 4, C - 8, 9); p.fill(c); p.rect(ox + x * C + 2, oy + y * C + 4, len * C - 4, C - 8, 9); p.fill(255, 255, 255, 80); p.rect(ox + x * C + 8, oy + y * C + 7, len * C - 16, 3, 2); };
  ship(1, 2, 5, [150, 162, 178]); ship(6, 5, 3, [120, 134, 150]); ship(2, 7, 4, [170, 178, 190]);
  const tx = ox + 3 * C + C / 2, ty = oy + 2 * C + C / 2;
  if (T > 40) { p.noFill(); p.stroke(255, 84, 112); p.strokeWeight(2); const k = Math.max(0, 1 - (T - 40) / 40); p.circle(tx, ty, 14 + k * 40); p.line(tx - 14, ty, tx + 14, ty); p.line(tx, ty - 14, tx, ty + 14); p.noStroke(); }
  if (T > 90 && T < 130) { const k = (T - 90) / 40; p.fill(255, 210, 90, 255 * (1 - k)); p.circle(tx, ty, 10 + k * 50); }
  if (T > 100) { p.fill(255, 120, 40); p.circle(tx, ty, 9); p.fill(255, 230, 120); p.circle(tx, ty - 1, 4); }
  const mx = ox + 8 * C + C / 2, my = oy + 1 * C + C / 2;
  if (T > 150) { p.noFill(); p.stroke(235, 247, 255, 200 * (1 - Math.min(1, (T - 150) / 60))); p.strokeWeight(2); p.circle(mx, my, (T - 150) * 0.5); p.noStroke(); }
  if (T > 160) { p.fill(235, 247, 255); p.circle(mx, my, 5); }
  p.fill(236, 240, 255); p.textAlign(p.LEFT, p.CENTER); p.textSize(13);
  p.text(T < 100 ? "Ziel erfassen …" : T < 150 ? "Treffer!" : "Wasser", ox + 10 * C + 18, oy + 2 * C);
}
