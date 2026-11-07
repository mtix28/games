// Panzerschlacht — Echtzeit-Panzerduell für den Multiplayer-Hub (2–6 Spieler, jeder gegen jeden).
//
// Seitenansicht wie Worms/Scorched Earth: ein Hügelgelände (Höhenkarte), Panzer, die links und rechts
// über das Gelände fahren, ein drehbares Rohr und Granaten, die ballistisch (Schwerkraft + Wind) fliegen.
// Jeder Einschlag reißt einen Krater ins Gelände – darunter fallen Panzer nach. Letzter Überlebender
// gewinnt die Runde, danach beginnt automatisch die nächste auf neuem Gelände.
//
// Steuerung: ←/→ (A/D) fahren · ↑/↓ (W/S) oder Maus Rohr · Leertaste/Mausklick halten = Kraft aufladen,
// loslassen = feuern · 1/2/3 oder Q/E Waffe wählen. Auf dem Handy gibt es Tasten unter dem Spielfeld.
//
// Netzwerk (host-autoritativ): Der Host simuliert Fahren, Schüsse, Treffer und Schaden. Gäste schicken
//   "in"   – Absicht (Fahrtrichtung, Rohrwinkel, Laden, Waffe), ~10×/s und bei Änderung,
//   "fire" – ein Schuss (Winkel, Kraft, Waffe),
// und bekommen
//   "tick"  – kleiner Schnappschuss der Panzer, 20×/s,
//   "state" – vollständiger Stand (Gelände-Seed, Krater, Panzer), 1×/s und bei jedem Phasenwechsel,
//   "shot"  – Granaten wurden abgefeuert; jeder Client fliegt sie selbst (gleiche Physik, gleiches Gelände),
//   "boom"  – eine Granate ist explodiert: Ort, Krater, Schaden, Abschüsse.
// Weil jeder Client Gelände, Panzer und Granaten kennt, kann nach einem Host-Wechsel der neue Host
// die Simulation direkt übernehmen.

import { shell } from "../hub-kit.js";

// ---- Welt ----
const W = 1200, H = 600;
const STEP = 3, NT = W / STEP + 1;
const G = 430;                          // Schwerkraft, px/s²
const WIND_MAX = 38;                    // Wind-Beschleunigung, px/s²
const SPEED = 82;                       // Fahrtempo, px/s
const CLIMB = 1.15;                     // maximale Steigung (dy/dx), die ein Panzer hochkommt
const HP = 100;
const BARREL = 27, PIVY = 17;           // Rohrlänge und Drehpunkt über dem Boden
const BODY_R = 17;                      // Trefferradius um (x, y - 10)
const VMIN = 170, VMAX = 780;           // Mündungsgeschwindigkeit bei Kraft 0 … 1
const CHARGE_TIME = 1.25;               // Sekunden bis volle Kraft
const POW_MIN = 0.14;
const COUNTDOWN = 3, OVER_TIME = 5.5;
const TICK_MS = 50, STATE_MS = 1000;

const WEAPONS = [
  { name: "Granate", short: "GRANATE", crater: 34, blast: 60, dmg: 42, cd: 0.7, ammo: -1, n: 1, col: "#ffd27a" },
  { name: "Wuchtbrumme", short: "WUCHT", crater: 66, blast: 116, dmg: 78, cd: 1.5, ammo: 3, n: 1, col: "#ff7a6e" },
  { name: "Streuschuss", short: "STREU", crater: 21, blast: 42, dmg: 24, cd: 1.1, ammo: 4, n: 5, col: "#8fe0ff" },
];
const COLORS = ["#6cb6ff", "#ff6e8c", "#74e2b2", "#ffcc70", "#b098ff", "#ff9c70"];

const PI = Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, d = 0) => { v = +v; return Number.isFinite(v) ? clamp(v, lo, hi) : d; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function rng(s) {
  s = s >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Gelände: Höhenkarte (y der Oberfläche je x), Krater schneiden Mulden hinein ----
const gy = new Float32Array(NT);
const groundY = (x) => {
  const f = clamp(x / STEP, 0, NT - 1.001), i = f | 0, r = f - i;
  return gy[i] + (gy[i + 1] - gy[i]) * r;
};

function buildTerrain(seed, slots) {
  const r = rng(seed);
  const bumps = [];
  const n = 6 + ((r() * 4) | 0);
  for (let i = 0; i < n; i++) bumps.push({ x: W * ((i + 0.15 + 0.7 * r()) / n), h: 70 + 150 * r(), w: 60 + 90 * r() });
  const base = H * 0.68, a1 = 18 + 14 * r(), a2 = 9 + 8 * r(), p1 = r() * 7, p2 = r() * 13;
  for (let i = 0; i < NT; i++) {
    const x = i * STEP;
    let y = base - a1 * Math.sin(x * 0.0055 + p1) - a2 * Math.sin(x * 0.019 + p2);
    for (const b of bumps) { const d = (x - b.x) / b.w; y -= b.h * Math.exp(-d * d); }
    gy[i] = clamp(y, H * 0.26, H - 44);
  }
  for (const cx of slots) {                              // ebene Startplätze, sanft ins Gelände übergeblendet
    const i0 = Math.max(0, ((cx - 80) / STEP) | 0), i1 = Math.min(NT - 1, ((cx + 80) / STEP) | 0);
    const pad = groundY(cx);
    for (let i = i0; i <= i1; i++) {
      const d = Math.abs(i * STEP - cx), w = d <= 30 ? 1 : 1 - (d - 30) / 50;
      gy[i] = gy[i] + (pad - gy[i]) * Math.max(0, w) * Math.max(0, w) * (3 - 2 * Math.max(0, w));
    }
  }
}
function carve(cx, cy, r) {
  const i0 = Math.max(0, ((cx - r) / STEP) | 0), i1 = Math.min(NT - 1, Math.ceil((cx + r) / STEP));
  for (let i = i0; i <= i1; i++) {
    const dx = i * STEP - cx, half = r * r - dx * dx;
    if (half <= 0) continue;
    gy[i] = Math.min(H - 8, Math.max(gy[i], cy + Math.sqrt(half)));
  }
}

export default {
  min: 2, max: 6,

  mount(ctx) {
    const kit = shell(ctx, { title: "Panzerschlacht" });
    const root = kit.body;
    const me0 = ctx.me.id;

    root.innerHTML = `<div class="pz">
      <canvas class="pz-cv" aria-label="Panzerschlacht"></canvas>
      <div class="pz-pad" aria-hidden="true">
        <div class="pz-grp"><button data-k="left">◀</button><button data-k="right">▶</button></div>
        <div class="pz-grp"><button data-k="up">▲</button><button data-k="down">▼</button><button data-k="wpn">⇄</button></div>
        <button class="pz-fire" data-k="fire">FEUER</button>
      </div></div>`;
    const cv = root.querySelector(".pz-cv"), g = cv.getContext("2d");
    let sc = 1;

    // ---- Spielzustand (auf jedem Client vorhanden) ----
    const tanks = ctx.players.map((p, i) => ({
      i, id: p.id, name: String(p.name || "Spieler").slice(0, 16), color: COLORS[i % COLORS.length],
      x: -100, y: 0, vy: 0, ang: PI / 4, face: 1, elev: PI / 4, tilt: 0, hp: 0, alive: false, gone: false,
      wpn: 0, ammo: [-1, 3, 4], cd: 0, chg: 0, wins: 0, kills: 0, tx: -100, flash: 0, recoil: 0,
      intent: { dr: 0, ang: PI / 4, chg: 0, wpn: 0 },
    }));
    const seatOf = (id) => tanks.findIndex((t) => t.id === id);
    let me = tanks[seatOf(me0)] || null;

    let phase = "wait";                  // wait | countdown | run | over
    let pl = 0;                          // verbleibende Sekunden der Phase
    let round = 0, seed = 1, slots = [], craters = [], wind = 0, winner = null;
    let shells = [], shellId = 1;
    let parts = [], feed = [], shake = 0;
    let gotState = false, wasHost = false, terrainDirty = true, bgDirty = true;
    let tickAcc = 0, stateAcc = 0, intentAcc = 0, lastIntent = "";
    let celebrated = -1;

    // eigene Eingabe
    const keys = new Set();
    const touch = { left: 0, right: 0, up: 0, down: 0, fire: 0 };
    let charging = false, power = POW_MIN, mouseAim = false, mx = W / 2, my = 0, pointerDown = false;

    const activeTanks = () => tanks.filter((t) => !t.gone);
    const aliveTanks = () => tanks.filter((t) => t.alive && !t.gone);
    const isHost = () => !!ctx.isHost;

    // ---- Terrain-Hilfen ----
    function rebuildWorld() {
      buildTerrain(seed, slots);
      for (const c of craters) carve(c[0], c[1], c[2]);
      terrainDirty = true; bgDirty = true;
    }
    function settle(t, dt) {                                   // auf dem Gelände stehen oder fallen
      if (t.x < -50) return;
      const gnd = groundY(t.x);
      if (t.y < gnd - 0.6) { t.vy += G * dt; t.y = Math.min(gnd, t.y + t.vy * dt); if (t.y >= gnd) t.vy = 0; }
      else { t.y = gnd; t.vy = 0; }
      const s = (groundY(t.x + 9) - groundY(t.x - 9)) / 18;
      t.tilt += (clamp(Math.atan(s), -0.7, 0.7) - t.tilt) * Math.min(1, dt * 12);
    }
    function drive(t, dr, dt) {
      if (!dr || !t.alive) return;
      const nx = clamp(t.x + dr * SPEED * dt, 20, W - 20);
      const dx = Math.abs(nx - t.x);
      if (groundY(nx) < groundY(t.x) - CLIMB * dx - 0.2 && t.y >= groundY(t.x) - 1) return;   // zu steil
      t.x = nx;
    }
    const setElev = (t, e) => { t.elev = clamp(e, 0.02, 1.72); t.ang = t.face > 0 ? t.elev : PI - t.elev; };
    const setAng = (t, a) => { a = clamp(a, 0, PI); t.face = a < PI / 2 ? 1 : -1; t.elev = t.face > 0 ? a : PI - a; t.ang = a; };
    const setFace = (t, f) => { if (t.face !== f) { t.face = f; t.ang = f > 0 ? t.elev : PI - t.elev; } };

    // ---- Schüsse ----
    function applyShot(d) {
      const t = tanks[d.o]; if (!t) return;
      for (const s of d.s) shells.push({ id: s[0], o: d.o, x: s[1], y: s[2], vx: s[3], vy: s[4], wp: d.wp, wd: d.wd, age: 0, held: 0, trail: [] });
      shellId = Math.max(shellId, ...d.s.map((s) => s[0] + 1));
      t.flash = 0.12; t.recoil = 1;
      const a = Math.atan2(-d.s[0][4], d.s[0][3]);
      for (let k = 0; k < 8; k++) parts.push({ x: d.s[0][1], y: d.s[0][2], vx: Math.cos(a) * (60 + 120 * Math.random()) + (Math.random() - .5) * 60, vy: -Math.sin(a) * (60 + 120 * Math.random()) + (Math.random() - .5) * 60, life: .35, max: .35, r: 3 + 3 * Math.random(), c: WEAPONS[d.wp].col, k: "spark" });
      shake = Math.max(shake, d.wp === 1 ? 5 : 2);
    }
    function doFire(seat, ang, pow, wpn) {                      // nur Host
      const t = tanks[seat];
      if (!t || !t.alive || phase !== "run" || t.cd > 0) return;
      wpn = clamp(wpn | 0, 0, WEAPONS.length - 1);
      if (t.ammo[wpn] === 0) return;
      const w = WEAPONS[wpn];
      if (t.ammo[wpn] > 0) t.ammo[wpn]--;
      if (t.ammo[wpn] === 0 && t.wpn === wpn) t.wpn = 0;
      t.cd = w.cd;
      ang = clamp(ang, 0, PI); pow = clamp(pow, POW_MIN, 1);
      const ox = t.x + Math.cos(ang) * BARREL, oy = t.y - PIVY - Math.sin(ang) * BARREL;
      const v = VMIN + (VMAX - VMIN) * pow, list = [];
      for (let k = 0; k < w.n; k++) {
        const a = ang + (w.n > 1 ? (k - (w.n - 1) / 2) * 0.1 : 0), vv = v * (w.n > 1 ? 1 + (((k * 37) % 5) - 2) * 0.025 : 1);
        list.push([shellId++, +ox.toFixed(1), +oy.toFixed(1), +(Math.cos(a) * vv).toFixed(1), +(-Math.sin(a) * vv).toFixed(1)]);
      }
      const d = { o: seat, wp: wpn, wd: +wind.toFixed(1), s: list };
      wind = clamp(wind + (Math.random() - 0.5) * 16, -WIND_MAX, WIND_MAX);
      ctx.send("shot", d); applyShot(d);
      if (me && seat === me.i) me.intent.wpn = me.wpn;
    }

    function stepShells(dt, host) {
      for (const s of shells) {
        if (s.held) { s.held += dt; continue; }
        let rem = dt;
        while (rem > 0 && !s.dead && !s.held) {
          const h = Math.min(rem, 1 / 100); rem -= h; s.age += h;
          s.vy += G * h; s.vx += s.wd * h; s.x += s.vx * h; s.y += s.vy * h;
          if (!s.trail.length || (s.age * 100 | 0) % 2 === 0) s.trail.push([s.x, s.y]);
          if (s.trail.length > 18) s.trail.shift();
          if (s.x < -80 || s.x > W + 80 || s.y > H + 100) { s.dead = true; break; }
          let hit = s.x >= 0 && s.x <= W && s.y >= groundY(s.x);
          if (!hit) for (const t of tanks) {
            if (!t.alive || (t.i === s.o && s.age < 0.18)) continue;
            if (Math.hypot(s.x - t.x, s.y - (t.y - 10)) < BODY_R) { hit = true; break; }
          }
          if (hit) { if (host) { s.dead = true; explode(s); } else s.held = 0.0001; }
        }
      }
      shells = shells.filter((s) => !s.dead && s.held < 2.5);
    }

    function explode(s) {                                      // nur Host
      const w = WEAPONS[s.wp], x = clamp(s.x, 0, W), y = Math.min(s.y, groundY(x) + 2);
      const dm = [], ko = [];
      for (const t of tanks) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - x, (t.y - 10) - y) - 10;
        if (d >= w.blast) continue;
        const dmg = Math.round(w.dmg * (1 - Math.max(0, d) / w.blast));
        if (dmg <= 0) continue;
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) { t.alive = false; ko.push(t.i); if (t.i !== s.o && tanks[s.o]) tanks[s.o].kills++; }
        dm.push([t.i, dmg, t.hp]);
      }
      const d = { ids: [s.id], x: +x.toFixed(1), y: +y.toFixed(1), wp: s.wp, o: s.o, dm, ko };
      ctx.send("boom", d); applyBoom(d);
    }
    function applyBoom(d) {
      const w = WEAPONS[d.wp];
      shells = shells.filter((s) => !d.ids.includes(s.id));
      carve(d.x, d.y, w.crater); craters.push([d.x, d.y, w.crater]); terrainDirty = true;
      const big = w.crater / 34;
      parts.push({ x: d.x, y: d.y, life: .45, max: .45, r: w.blast, k: "ring" });
      parts.push({ x: d.x, y: d.y, life: .18, max: .18, r: w.crater * 1.7, k: "flash" });
      for (let k = 0; k < 16 * big + 8; k++) {
        const a = Math.random() * PI * 2, v = 40 + 260 * Math.random() * Math.min(1.6, big);
        parts.push({ x: d.x, y: d.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: .5 + .5 * Math.random(), max: 1, r: 2 + 4 * Math.random(), c: k % 3 ? "#ffb347" : "#fff0a8", k: "spark" });
      }
      for (let k = 0; k < 10 * big + 4; k++) {
        const a = -PI * Math.random(), v = 80 + 200 * Math.random();
        parts.push({ x: d.x, y: d.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 + Math.random(), max: 2, r: 2 + 3 * Math.random(), c: k % 2 ? "#6b4a35" : "#4a3322", k: "dirt" });
      }
      for (let k = 0; k < 7 * big + 3; k++) parts.push({ x: d.x + (Math.random() - .5) * w.crater, y: d.y - 4, vx: (Math.random() - .5) * 40, vy: -20 - 50 * Math.random(), life: 1.1 + Math.random() * .8, max: 1.9, r: 10 + 14 * Math.random() * big, k: "smoke" });
      shake = Math.max(shake, 4 + 8 * big);
      for (const [i, dmg, hp] of d.dm) {
        const t = tanks[i]; if (!t) continue;
        t.hp = hp;
        parts.push({ x: t.x, y: t.y - 36, vy: -42, life: 1.1, max: 1.1, k: "txt", txt: "-" + dmg, c: dmg >= 40 ? "#ff6e6e" : "#ffe08a" });
      }
      for (const i of d.ko) {
        const t = tanks[i]; if (!t) continue;
        t.alive = false; t.hp = 0; t.chg = 0;
        shake = Math.max(shake, 12);
        for (let k = 0; k < 26; k++) { const a = Math.random() * PI * 2, v = 60 + 240 * Math.random(); parts.push({ x: t.x, y: t.y - 12, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: .8 + Math.random() * .8, max: 1.6, r: 2 + 4 * Math.random(), c: k % 2 ? t.color : "#ffb347", k: "spark" }); }
        const killer = tanks[d.o];
        feed.push({ t: 6, a: killer && killer.i !== i ? killer.name : "", b: t.name, self: !killer || killer.i === i, ca: killer ? killer.color : "#fff", cb: t.color });
      }
      if (feed.length > 5) feed.shift();
    }

    // ---- Runden ----
    function newRound() {                                      // nur Host
      const act = activeTanks();
      if (act.length < 2) { phase = "over"; pl = 1; return; }
      round++; seed = (Math.random() * 4294967295) >>> 0;
      const r = rng(seed ^ 0x9e3779b9), order = act.map((_, k) => k);
      for (let k = order.length - 1; k > 0; k--) { const j = (r() * (k + 1)) | 0; [order[k], order[j]] = [order[j], order[k]]; }
      slots = act.map((_, k) => Math.round(W * (0.5 + k) / act.length + (r() - 0.5) * (W / act.length) * 0.3));
      craters = []; shells = []; parts = []; feed = []; winner = null;
      buildTerrain(seed, slots); terrainDirty = bgDirty = true;
      act.forEach((t, k) => {
        t.x = t.tx = slots[order[k]]; t.y = groundY(t.x); t.vy = 0; t.hp = HP; t.alive = true; t.cd = 0.6; t.chg = 0;
        t.ammo = WEAPONS.map((w) => w.ammo); t.wpn = 0;
        const f = t.x < W / 2 ? 1 : -1; t.face = f; setElev(t, 0.75);
        if (t === me) { me.intent.wpn = 0; setElev(me, 0.75); }
        t.intent = { dr: 0, ang: t.ang, chg: 0, wpn: 0 };
      });
      wind = (Math.random() * 2 - 1) * WIND_MAX;
      phase = "countdown"; pl = COUNTDOWN;
      sendState();
    }
    function checkEnd() {                                      // nur Host
      if (phase !== "run") return;
      const alive = aliveTanks();
      if (alive.length > 1) return;
      phase = "over"; pl = OVER_TIME;
      winner = alive.length ? alive[0].i : -1;
      if (alive.length) alive[0].wins++;
      sendState();
    }

    // ---- Netzwerk ----
    const snapTank = (t) => [+t.x.toFixed(1), +t.ang.toFixed(3), t.hp, t.alive ? 1 : 0, t.wpn, +t.chg.toFixed(2), +t.cd.toFixed(2), t.kills, t.wins, t.ammo[1], t.ammo[2], t.gone ? 1 : 0];
    function readTank(t, a, full) {
      if (!Array.isArray(a)) return;
      const x = num(a[0], -50, W + 50, t.x);
      if (full || t.x < -50) { t.x = t.tx = x; t.y = groundY(x); t.vy = 0; } else t.tx = x;
      if (t !== me) { t.ang = num(a[1], 0, PI, t.ang); t.face = t.ang < PI / 2 ? 1 : -1; t.elev = t.face > 0 ? t.ang : PI - t.ang; t.chg = num(a[5], 0, 1, 0); t.wpn = num(a[4], 0, 2, 0) | 0; }
      t.hp = num(a[2], 0, HP, 0) | 0; t.alive = !!a[3]; t.kills = num(a[7], 0, 999, 0) | 0; t.wins = num(a[8], 0, 999, 0) | 0;
      t.ammo = [-1, num(a[9], 0, 99, 0) | 0, num(a[10], 0, 99, 0) | 0]; t.gone = !!a[11];
      if (t === me) { t.cd = Math.max(t.cd, num(a[6], 0, 5, 0)); if (t.ammo[t.wpn] === 0) { t.wpn = 0; t.intent.wpn = 0; } }
      else t.cd = num(a[6], 0, 5, 0);
    }
    const phases = ["wait", "countdown", "run", "over"];
    function sendState() {
      ctx.send("state", { ph: phases.indexOf(phase), pl: +pl.toFixed(2), rd: round, sd: seed, sl: slots, cr: craters.slice(-400), w: +wind.toFixed(1), wn: winner === null ? -2 : winner, k: tanks.map(snapTank) });
    }
    function sendTick() {
      ctx.send("tick", { ph: phases.indexOf(phase), pl: +pl.toFixed(2), w: +wind.toFixed(1), wn: winner === null ? -2 : winner, k: tanks.map(snapTank) });
    }
    function setPhase(p, left, wn) {
      const np = phases[num(p, 0, 3, 0) | 0];
      if (np !== phase) {
        phase = np;
        if (np === "over" && wn >= 0 && tanks[wn] === me && celebrated !== round) { celebrated = round; try { if (typeof celebrate === "function") celebrate(2); } catch (e) { /* Konfetti ist optional */ } }
      }
      pl = num(left, 0, 99, 0);
      winner = wn === -2 ? null : wn;
    }
    function fromHost(from) { return from === ctx.hostId; }

    ctx.onMessage("state", ({ from, data: d }) => {
      if (!fromHost(from) || !d || !Array.isArray(d.k)) return;
      gotState = true;
      const sd = num(d.sd, 0, 4294967295, 1) >>> 0, sl = Array.isArray(d.sl) ? d.sl.slice(0, 8).map((v) => num(v, 0, W, W / 2)) : [];
      const cr = Array.isArray(d.cr) ? d.cr.slice(-400).map((c) => [num(c[0], -200, W + 200), num(c[1], -200, H + 200), num(c[2], 5, 120, 20)]) : [];
      const fresh = sd !== seed || cr.length !== craters.length || sl.join() !== slots.join();
      const newRoundNow = num(d.rd, 0, 9999, 0) !== round;
      seed = sd; slots = sl; craters = cr; round = num(d.rd, 0, 9999, 0) | 0; wind = num(d.w, -WIND_MAX, WIND_MAX, 0);
      if (fresh) rebuildWorld();
      if (newRoundNow) { shells = []; parts = []; feed = []; }
      d.k.forEach((a, i) => tanks[i] && readTank(tanks[i], a, newRoundNow || !!fresh));
      setPhase(d.ph, d.pl, num(d.wn, -2, 9, -2) | 0);
      if (newRoundNow && me) { me.intent.wpn = 0; me.elev = 0.75; setFace(me, me.x < W / 2 ? 1 : -1); setElev(me, 0.75); }
    });
    ctx.onMessage("tick", ({ from, data: d }) => {
      if (!fromHost(from) || !gotState || !d || !Array.isArray(d.k)) return;
      d.k.forEach((a, i) => tanks[i] && readTank(tanks[i], a, false));
      wind = num(d.w, -WIND_MAX, WIND_MAX, wind);
      setPhase(d.ph, d.pl, num(d.wn, -2, 9, -2) | 0);
    });
    ctx.onMessage("shot", ({ from, data: d }) => {
      if (!fromHost(from) || !d || !Array.isArray(d.s) || !tanks[d.o] || !WEAPONS[d.wp]) return;
      const s = d.s.filter((a) => Array.isArray(a) && a.length >= 5).slice(0, 8).map((a) => [num(a[0], 0, 1e9) | 0, num(a[1], -500, W + 500), num(a[2], -500, H + 500), num(a[3], -2000, 2000), num(a[4], -2000, 2000)]);
      if (!s.length) return;
      applyShot({ o: d.o | 0, wp: d.wp | 0, wd: num(d.wd, -WIND_MAX, WIND_MAX, 0), s });
      if (tanks[d.o] === me) me.cd = Math.max(me.cd, WEAPONS[d.wp].cd);
    });
    ctx.onMessage("boom", ({ from, data: d }) => {
      if (!fromHost(from) || !d || !WEAPONS[d.wp]) return;
      applyBoom({
        ids: Array.isArray(d.ids) ? d.ids.map((v) => v | 0) : [], x: num(d.x, -200, W + 200), y: num(d.y, -200, H + 200), wp: d.wp | 0, o: num(d.o, 0, 9, 0) | 0,
        dm: Array.isArray(d.dm) ? d.dm.filter((a) => Array.isArray(a) && tanks[a[0]]).map((a) => [a[0] | 0, num(a[1], 0, 999) | 0, num(a[2], 0, HP) | 0]) : [],
        ko: Array.isArray(d.ko) ? d.ko.filter((i) => tanks[i]).map((i) => i | 0) : [],
      });
    });
    ctx.onMessage("in", ({ from, data: d }) => {
      if (!isHost() || !d) return;
      const t = tanks[seatOf(from)]; if (!t || t === me) return;
      t.intent.dr = clamp(Math.round(num(d.dr, -1, 1, 0)), -1, 1);
      t.intent.ang = num(d.ang, 0, PI, t.intent.ang); t.intent.chg = num(d.chg, 0, 1, 0);
      const w = num(d.wpn, 0, 2, 0) | 0; if (t.ammo[w] !== 0) t.wpn = t.intent.wpn = w;
    });
    ctx.onMessage("fire", ({ from, data: d }) => {
      if (!isHost() || !d) return;
      const seat = seatOf(from); if (seat < 0) return;
      doFire(seat, num(d.ang, 0, PI, PI / 4), num(d.pow, POW_MIN, 1, POW_MIN), num(d.wpn, 0, 2, 0) | 0);
    });
    ctx.onMessage("hello", ({ from }) => { if (isHost()) ctx.send("state", snapshotForSend(), from); });
    const snapshotForSend = () => ({ ph: phases.indexOf(phase), pl: +pl.toFixed(2), rd: round, sd: seed, sl: slots, cr: craters.slice(-400), w: +wind.toFixed(1), wn: winner === null ? -2 : winner, k: tanks.map(snapTank) });
    ctx.onEvent("leave", ({ id }) => {
      const t = tanks[seatOf(id)]; if (!t) return;
      t.gone = true; t.alive = false; t.chg = 0;
      parts.push({ x: t.x, y: t.y - 30, vy: -30, life: 1.6, max: 1.6, k: "txt", txt: t.name + " ist gegangen", c: "#cfd4ff" });
      if (isHost()) checkEnd();
    });

    // ---- Eingabe ----
    const visible = () => cv.offsetParent !== null;
    const typing = (e) => { const n = e.target && e.target.tagName; return n === "INPUT" || n === "TEXTAREA" || (e.target && e.target.isContentEditable); };
    const GAMEKEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "a", "d", "w", "s", "q", "e", "1", "2", "3"]);
    function selectWeapon(i) {
      if (!me || !me.alive) return;
      i = (i + WEAPONS.length) % WEAPONS.length;
      for (let k = 0; k < WEAPONS.length && me.ammo[i] === 0; k++) i = (i + 1) % WEAPONS.length;
      me.wpn = me.intent.wpn = i;
    }
    function onKeyDown(e) {
      if (typing(e) || !visible() || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!GAMEKEYS.has(k)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (k === " ") { startCharge(); return; }
      if (k === "1" || k === "2" || k === "3") selectWeapon(+k - 1);
      else if (k === "q") selectWeapon((me ? me.wpn : 0) - 1);
      else if (k === "e") selectWeapon((me ? me.wpn : 0) + 1);
      else { keys.add(k); mouseAim = false; }
    }
    function onKeyUp(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === " ") { releaseCharge(); return; }
      keys.delete(k);
    }
    function onBlur() { keys.clear(); if (charging) releaseCharge(true); for (const k in touch) touch[k] = 0; }
    function startCharge() { if (!me || !me.alive || phase !== "run" || charging) return; charging = true; power = POW_MIN; }
    function releaseCharge(cancel) {
      if (!charging) return;
      charging = false;
      if (cancel || !me || !me.alive || phase !== "run") return;
      if (me.cd > 0 || me.ammo[me.wpn] === 0) return;
      if (isHost()) doFire(me.i, me.ang, power, me.wpn);
      else { ctx.send("fire", { ang: +me.ang.toFixed(3), pow: +power.toFixed(3), wpn: me.wpn }); me.cd = WEAPONS[me.wpn].cd; me.recoil = 1; me.flash = 0.1; }
    }
    const toWorld = (e) => { const r = cv.getBoundingClientRect(); mx = (e.clientX - r.left) * W / r.width; my = (e.clientY - r.top) * H / r.height; };
    cv.addEventListener("pointermove", (e) => { toWorld(e); if (e.pointerType === "mouse" || pointerDown) mouseAim = true; });
    cv.addEventListener("pointerdown", (e) => { toWorld(e); mouseAim = e.pointerType === "mouse"; pointerDown = true; startCharge(); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } });
    const up = () => { if (pointerDown) { pointerDown = false; releaseCharge(); } };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", () => { pointerDown = false; releaseCharge(true); });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp); window.addEventListener("blur", onBlur);

    for (const b of root.querySelectorAll(".pz-pad button")) {
      const k = b.dataset.k;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } mouseAim = false; if (k === "wpn") selectWeapon((me ? me.wpn : 0) + 1); else if (k === "fire") startCharge(); else touch[k] = 1; });
      const end = () => { if (k === "fire") releaseCharge(); else if (k !== "wpn") touch[k] = 0; };
      b.addEventListener("pointerup", end); b.addEventListener("pointercancel", () => { if (k === "fire") releaseCharge(true); else touch[k] = 0; });
    }

    // ---- Update ----
    function update(dt) {
      const host = isHost();
      if (host && !wasHost) {                                  // Host-Wechsel (oder Start): Simulation übernehmen
        for (const t of tanks) if (t !== me) t.intent = { dr: 0, ang: t.ang, chg: 0, wpn: t.wpn };
        for (const s of shells) shellId = Math.max(shellId, s.id + 1);
        if (phase === "wait" && started) newRound();
      }
      wasHost = host;

      // eigene Eingabe
      if (me && me.alive && !me.gone) {
        const dr = (keys.has("ArrowRight") || keys.has("d") || touch.right ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") || touch.left ? 1 : 0);
        const el = (keys.has("ArrowUp") || keys.has("w") || touch.up ? 1 : 0) - (keys.has("ArrowDown") || keys.has("s") || touch.down ? 1 : 0);
        if (phase === "run" || phase === "countdown") {
          if (dr) setFace(me, dr);
          if (el) setElev(me, me.elev + el * 1.0 * dt);
          if (mouseAim) setAng(me, Math.atan2(-(my - (me.y - PIVY)), mx - me.x));
        }
        me.intent.dr = phase === "run" ? dr : 0;
        me.intent.ang = me.ang;
        if (charging) { if (phase !== "run") charging = false; else power = Math.min(1, power + dt / CHARGE_TIME * (1 - POW_MIN)); }
        me.chg = charging ? power : 0; me.intent.chg = me.chg;
        if (me.ammo[me.wpn] === 0) selectWeapon(0);
      } else if (me) { charging = false; me.chg = 0; me.intent.dr = 0; }

      // Fahren, Fallen, Abklingzeit – Host für alle, jeder Client für sich selbst (Vorhersage)
      for (const t of tanks) {
        if (t.gone) continue;
        t.cd = Math.max(0, t.cd - dt); t.flash = Math.max(0, t.flash - dt); t.recoil = Math.max(0, t.recoil - dt * 5);
        if (host) { if (phase === "run" && t.alive) { drive(t, t.intent.dr, dt); if (t !== me) { setAng(t, t.intent.ang); t.chg = t.intent.chg; } } }
        else if (t === me) { if (phase === "run" && t.alive) drive(t, t.intent.dr, dt); const e = t.tx - t.x; if (Math.abs(e) > 45) t.x += e * Math.min(1, dt * 8); else if (!t.intent.dr) t.x += e * Math.min(1, dt * 6); }
        else t.x += (t.tx - t.x) * Math.min(1, dt * 14);
        settle(t, dt);
      }

      // Phasen
      if (host) {
        if (phase === "countdown") { pl -= dt; if (pl <= 0) { phase = "run"; pl = 0; sendState(); } }
        else if (phase === "over") { pl -= dt; if (pl <= 0) { if (activeTanks().length >= 2) newRound(); else pl = 1; } }
        stepShells(dt, true);
        if (phase === "run") checkEnd();
        tickAcc += dt * 1000; stateAcc += dt * 1000;
        if (tickAcc >= TICK_MS) { tickAcc = 0; sendTick(); }
        if (stateAcc >= STATE_MS) { stateAcc = 0; sendState(); }
      } else {
        pl = Math.max(0, pl - dt);
        stepShells(dt, false);
        // Absicht an den Host
        if (me && me.alive) {
          intentAcc += dt * 1000;
          const cur = JSON.stringify([me.intent.dr, +me.ang.toFixed(2), Math.round(me.chg * 10), me.wpn]);
          if ((cur !== lastIntent && intentAcc >= 60) || intentAcc >= 400) { intentAcc = 0; lastIntent = cur; ctx.send("in", { dr: me.intent.dr, ang: +me.ang.toFixed(3), chg: +me.chg.toFixed(2), wpn: me.wpn }, ctx.hostId); }
        }
      }

      // Effekte
      for (const p of parts) {
        p.life -= dt;
        if (p.k === "spark" || p.k === "dirt") { p.vy += (p.k === "dirt" ? G : G * 0.5) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.k === "dirt" && p.y >= groundY(p.x)) p.life = 0; }
        else if (p.k === "smoke") { p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 14; }
        else if (p.k === "txt") p.y += p.vy * dt;
      }
      parts = parts.filter((p) => p.life > 0);
      if (parts.length > 500) parts.splice(0, parts.length - 500);
      for (const f of feed) f.t -= dt;
      feed = feed.filter((f) => f.t > 0);
      shake = Math.max(0, shake - dt * 30);
      for (const t of tanks) if (!t.alive && !t.gone && t.hp <= 0 && round > 0 && Math.random() < dt * 6 && t.x > -50) parts.push({ x: t.x + (Math.random() - .5) * 14, y: t.y - 12, vx: (Math.random() - .5) * 10, vy: -26 - 20 * Math.random(), life: 1.2, max: 1.2, r: 6 + 5 * Math.random(), k: "smoke" });
    }
    let started = false;

    // ================== Zeichnen ==================
    let bgC = null, terrainP = null, edgeP = null;
    const FONT = '"Space Grotesk","Inter",system-ui,-apple-system,sans-serif', MONO = '"Space Mono",ui-monospace,Menlo,monospace';
    function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    function fit() {
      const w = cv.clientWidth; if (!w) return;
      const d = Math.min(2, window.devicePixelRatio || 1), bw = Math.round(w * d);
      if (cv.width !== bw) { cv.width = bw; cv.height = Math.round(bw / 2); bgDirty = true; }
      sc = cv.width / W;
    }
    function paintBg() {
      bgC = bgC || document.createElement("canvas");
      bgC.width = cv.width; bgC.height = cv.height;
      const c = bgC.getContext("2d"); c.setTransform(sc, 0, 0, sc, 0, 0);
      const sky = c.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#10143a"); sky.addColorStop(0.45, "#3b2a6b"); sky.addColorStop(0.75, "#c8576f"); sky.addColorStop(1, "#ffa66a");
      c.fillStyle = sky; c.fillRect(0, 0, W, H);
      const r = rng(seed ^ 0xabcdef);
      c.fillStyle = "#fff";
      for (let i = 0; i < 70; i++) { c.globalAlpha = 0.25 + 0.6 * r(); c.fillRect(r() * W, r() * H * 0.45, 1.6, 1.6); }
      c.globalAlpha = 1;
      const sx = W * (0.2 + 0.6 * r()), sy = H * 0.5;
      const sun = c.createRadialGradient(sx, sy, 8, sx, sy, 150);
      sun.addColorStop(0, "rgba(255,240,200,1)"); sun.addColorStop(0.18, "rgba(255,206,140,.95)"); sun.addColorStop(1, "rgba(255,150,110,0)");
      c.fillStyle = sun; c.beginPath(); c.arc(sx, sy, 150, 0, PI * 2); c.fill();
      for (let L = 0; L < 3; L++) {
        const ph = r() * 9, a = 40 + L * 12, base = H * (0.5 + L * 0.09);
        c.fillStyle = ["#3a2a5e", "#2b2050", "#1d1740"][L]; c.beginPath(); c.moveTo(0, H);
        for (let x = 0; x <= W; x += 12) c.lineTo(x, base - a * (0.55 + 0.45 * Math.sin(x * (0.004 + L * 0.0017) + ph)) - 22 * Math.sin(x * 0.013 + ph * 2));
        c.lineTo(W, H); c.closePath(); c.fill();
      }
      bgDirty = false;
    }
    function buildPaths() {
      terrainP = new Path2D(); edgeP = new Path2D();
      terrainP.moveTo(0, H + 20); terrainP.lineTo(0, gy[0]); edgeP.moveTo(0, gy[0]);
      for (let i = 1; i < NT; i++) { terrainP.lineTo(i * STEP, gy[i]); edgeP.lineTo(i * STEP, gy[i]); }
      terrainP.lineTo(W, H + 20); terrainP.closePath();
      terrainDirty = false;
    }

    function drawTank(t) {
      const dead = !t.alive;
      g.save(); g.translate(t.x, t.y);
      const col = dead ? "#3b3b46" : t.color, dark = dead ? "#26262e" : shade(t.color, -0.38), light = dead ? "#4b4b58" : shade(t.color, 0.3);
      g.save(); g.rotate(t.tilt);
      g.fillStyle = "#23252f"; rr(g, -21, -10, 42, 11, 5.5); g.fill();                         // Ketten
      g.fillStyle = "#3a3d4c"; for (let k = -15; k <= 15; k += 10) { g.beginPath(); g.arc(k, -4.5, 4, 0, PI * 2); g.fill(); }
      g.fillStyle = col; rr(g, -17, -19, 34, 11, 4); g.fill();                                   // Wanne
      g.fillStyle = dark; g.fillRect(-17, -11, 34, 3);
      g.fillStyle = light; g.fillRect(-14, -18, 28, 2);
      g.restore();
      g.fillStyle = col; g.beginPath(); g.arc(0, -PIVY + 1, 9.5, PI, 0); g.lineTo(9.5, -PIVY + 4); g.lineTo(-9.5, -PIVY + 4); g.closePath(); g.fill();   // Turm
      g.fillStyle = light; g.beginPath(); g.arc(-2, -PIVY - 2, 3, 0, PI * 2); g.fill();
      if (!dead) {                                                                              // Rohr
        g.save(); g.translate(0, -PIVY); g.rotate(-t.ang);
        const rc = t.recoil * 4;
        g.fillStyle = dark; g.fillRect(-4 - rc, -3, BARREL - 3, 6);
        g.fillStyle = col; g.fillRect(-4 - rc, -2.2, BARREL - 3, 3.4);
        g.fillStyle = dark; g.fillRect(BARREL - 7 - rc, -4, 6, 8);
        if (t.flash > 0) { g.fillStyle = "rgba(255,230,150,.95)"; g.beginPath(); g.arc(BARREL + 2, 0, 9 * (t.flash / 0.12), 0, PI * 2); g.fill(); }
        g.restore();
      }
      g.restore();
    }
    function shade(hex, f) {
      const n = parseInt(hex.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
      return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
    }
    function label(c, txt, x, y, size, color, align, weight, font) {
      c.font = `${weight || 700} ${size}px ${font || FONT}`; c.textAlign = align || "center"; c.textBaseline = "middle"; c.fillStyle = color; c.fillText(txt, x, y);
    }

    function draw() {
      fit();
      if (bgDirty || !bgC) paintBg();
      if (terrainDirty || !terrainP) buildPaths();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(bgC, 0, 0);
      const sh = shake > 0.2 ? shake : 0;
      g.setTransform(sc, 0, 0, sc, (Math.random() - .5) * sh * sc, (Math.random() - .5) * sh * sc);

      // Gelände
      const dirt = g.createLinearGradient(0, 120, 0, H);
      dirt.addColorStop(0, "#7a5638"); dirt.addColorStop(0.5, "#5a3e29"); dirt.addColorStop(1, "#2e1f15");
      g.fillStyle = dirt; g.fill(terrainP);
      g.save(); g.clip(terrainP);
      g.lineJoin = "round"; g.strokeStyle = "rgba(0,0,0,.28)"; g.lineWidth = 16; g.stroke(edgeP);   // Schatten unter der Grasnarbe
      g.restore();
      g.lineJoin = "round"; g.strokeStyle = "#3f8f3a"; g.lineWidth = 7; g.stroke(edgeP);
      g.strokeStyle = "#7fd462"; g.lineWidth = 3; g.stroke(edgeP);

      // Spuren, Granaten
      for (const s of shells) {
        if (s.held) continue;
        const w = WEAPONS[s.wp];
        for (let k = 0; k < s.trail.length; k++) { const a = k / s.trail.length; g.fillStyle = `rgba(255,240,200,${a * 0.35})`; g.beginPath(); g.arc(s.trail[k][0], s.trail[k][1], 1 + a * (s.wp === 1 ? 3.5 : 2.2), 0, PI * 2); g.fill(); }
        g.fillStyle = w.col; g.beginPath(); g.arc(s.x, s.y, s.wp === 1 ? 5.5 : 3.6, 0, PI * 2); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(s.x - 1, s.y - 1, 1.6, 0, PI * 2); g.fill();
      }
      for (const p of parts) if (p.k === "smoke") { g.globalAlpha = 0.32 * (p.life / p.max); g.fillStyle = "#2c2a38"; g.beginPath(); g.arc(p.x, p.y, p.r, 0, PI * 2); g.fill(); }
      g.globalAlpha = 1;

      // Zielhilfe: kurzer Bogen, solange ich lade
      if (me && me.alive && phase === "run") {
        const ox = me.x + Math.cos(me.ang) * BARREL, oy = me.y - PIVY - Math.sin(me.ang) * BARREL;
        const v = VMIN + (VMAX - VMIN) * (charging ? power : 0.35);
        g.fillStyle = "rgba(255,255,255,.7)";
        for (let k = 1; k <= 9; k++) {
          const tt = k * (charging ? 0.07 : 0.045), px = ox + Math.cos(me.ang) * v * tt, py = oy - Math.sin(me.ang) * v * tt + 0.5 * G * tt * tt;
          g.globalAlpha = 0.85 - k * 0.08; g.beginPath(); g.arc(px, py, 2.6 - k * 0.12, 0, PI * 2); g.fill();
        }
        g.globalAlpha = 1;
      }

      // Panzer
      for (const t of tanks) {
        if (t.gone || t.x < -40) continue;
        drawTank(t);
        if (t.alive && phase !== "wait") {
          const nx = t.x, ny = t.y - 42;
          label(g, t.name, nx, ny - 9, 11, "rgba(255,255,255,.92)");
          g.fillStyle = "rgba(0,0,0,.55)"; rr(g, nx - 20, ny, 40, 5, 2.5); g.fill();
          g.fillStyle = t.hp > 50 ? "#74e2b2" : t.hp > 25 ? "#ffd27a" : "#ff6e6e"; if (t.hp > 0) { rr(g, nx - 20, ny, 40 * t.hp / HP, 5, 2.5); g.fill(); }
          if (t === me) { const by = ny - 26 + Math.sin(performance.now() / 220) * 3; g.fillStyle = "#ffe08a"; g.beginPath(); g.moveTo(nx - 6, by - 6); g.lineTo(nx + 6, by - 6); g.lineTo(nx, by + 3); g.closePath(); g.fill(); }
          if (t.chg > 0 && t !== me) { g.fillStyle = "rgba(0,0,0,.5)"; rr(g, nx - 18, ny + 9, 36, 4, 2); g.fill(); g.fillStyle = "#ffd27a"; rr(g, nx - 18, ny + 9, 36 * t.chg, 4, 2); g.fill(); }
        }
      }

      // Funken, Staub, Ringe, Zahlen
      for (const p of parts) {
        const a = clamp(p.life / p.max, 0, 1);
        if (p.k === "spark" || p.k === "dirt") { g.globalAlpha = Math.min(1, a * 1.6); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r * (p.k === "dirt" ? 1 : 0.4 + a * 0.6), 0, PI * 2); g.fill(); }
        else if (p.k === "ring") { g.globalAlpha = a * 0.7; g.strokeStyle = "#ffe9b0"; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, p.r * (1 - a) + 6, 0, PI * 2); g.stroke(); }
        else if (p.k === "flash") { g.globalAlpha = a; const rg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); rg.addColorStop(0, "#fff"); rg.addColorStop(0.4, "#ffd27a"); rg.addColorStop(1, "rgba(255,120,60,0)"); g.fillStyle = rg; g.beginPath(); g.arc(p.x, p.y, p.r, 0, PI * 2); g.fill(); }
        else if (p.k === "txt") { g.globalAlpha = Math.min(1, a * 2); g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,.6)"; g.font = `800 ${p.txt.length > 6 ? 13 : 17}px ${FONT}`; g.textAlign = "center"; g.strokeText(p.txt, p.x, p.y); g.fillStyle = p.c; g.fillText(p.txt, p.x, p.y); }
      }
      g.globalAlpha = 1;

      g.setTransform(sc, 0, 0, sc, 0, 0);
      drawHud();
    }

    // ---- HUD ----
    function panel(x, y, w, h, r, edge, a) { rr(g, x, y, w, h, r); g.fillStyle = `rgba(10,10,26,${a == null ? 0.72 : a})`; g.fill(); if (edge) { g.strokeStyle = edge; g.lineWidth = 1.6; g.stroke(); } }
    function drawHud() {
      const act = activeTanks(), n = Math.max(1, act.length);
      // Spielerkarten oben in der Mitte
      const gap = 8, cw = Math.min(196, (W - 440 - gap * (n - 1)) / n), total = cw * n + gap * (n - 1);
      let x = (W - total) / 2;
      for (const t of act) {
        const isMe = t === me;
        g.save(); g.globalAlpha = t.alive || phase === "wait" ? 1 : 0.55;
        panel(x, 12, cw, 52, 10, isMe ? "#ffe08a" : t.color + "aa", 0.78);
        g.fillStyle = t.color; rr(g, x, 12, 6, 52, 3); g.fill();
        label(g, (t.name.toUpperCase()) + (isMe ? " · DU" : ""), x + 14, 27, 12.5, "#fff", "left");
        g.fillStyle = "rgba(0,0,0,.55)"; rr(g, x + 14, 40, cw - 26, 9, 4.5); g.fill();
        if (t.hp > 0) { const f = t.hp / HP; g.fillStyle = f > 0.5 ? t.color : f > 0.25 ? "#ffd27a" : "#ff6e6e"; rr(g, x + 14, 40, Math.max(6, (cw - 26) * f), 9, 4.5); g.fill(); }
        label(g, t.alive ? String(t.hp) : "K.O.", x + cw - 12, 27, 11, t.alive ? "#cfd4ff" : "#ff8c8c", "right", 700, MONO);
        label(g, `★ ${t.wins}   ✦ ${t.kills}`, x + 14, 57, 9.5, "rgba(207,212,255,.7)", "left", 600, MONO);
        g.restore();
        x += cw + gap;
      }

      // Wind links
      panel(16, 14, 168, 64, 10, null, 0.62);
      label(g, "WIND", 28, 28, 10.5, "rgba(207,212,255,.7)", "left", 700);
      const wf = wind / WIND_MAX, wx = 100, wy = 52, half = 66;
      g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = 2; g.beginPath(); g.moveTo(wx - half, wy); g.lineTo(wx + half, wy); g.stroke();
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(wx + i * half / 2, wy - 4); g.lineTo(wx + i * half / 2, wy + 4); g.stroke(); }
      if (Math.abs(wf) > 0.02) {
        g.strokeStyle = "#9ad4ff"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + wf * half, wy); g.stroke(); g.lineCap = "butt";
        const d = Math.sign(wf); g.fillStyle = "#cfeaff"; g.beginPath(); g.moveTo(wx + wf * half + d * 9, wy); g.lineTo(wx + wf * half, wy - 7); g.lineTo(wx + wf * half, wy + 7); g.closePath(); g.fill();
      }
      label(g, Math.abs(wind).toFixed(0), 28, 66, 10.5, "#cfd4ff", "left", 700, MONO);
      label(g, wind < -1 ? "◀" : wind > 1 ? "▶" : "–", 158, 28, 11, "#9ad4ff", "right");

      // Runde + Abschussliste rechts
      label(g, round ? `RUNDE ${round}` : "", W - 20, 24, 12, "rgba(255,255,255,.85)", "right", 800);
      let fy = 46;
      for (const f of feed) {
        const txt = f.self ? `${f.b} hat sich selbst gesprengt` : `${f.a}  💥  ${f.b}`;
        g.font = `700 12px ${FONT}`; const tw = g.measureText(txt).width + 22;
        g.globalAlpha = Math.min(1, f.t); panel(W - 16 - tw, fy, tw, 24, 8, null, 0.7);
        label(g, txt, W - 27, fy + 12.5, 12, "#fff", "right"); g.globalAlpha = 1; fy += 29;
      }

      // Unten: Waffen, Kraft, Winkel
      if (me && !me.gone) {
        const alive = me.alive && phase !== "wait";
        const sw = 118, sg = 8, bw = sw * WEAPONS.length + sg * (WEAPONS.length - 1), bx = (W - bw) / 2, by = H - 74;
        g.save(); g.globalAlpha = me.alive ? 1 : 0.45;
        WEAPONS.forEach((w, i) => {
          const sx = bx + i * (sw + sg), sel = me.wpn === i, am = me.ammo[i], empty = am === 0;
          panel(sx, by, sw, 58, 11, sel ? w.col : "rgba(255,255,255,.14)", sel ? 0.88 : 0.66);
          if (sel) { g.fillStyle = w.col + "26"; rr(g, sx, by, sw, 58, 11); g.fill(); }
          g.save(); g.globalAlpha *= empty ? 0.35 : 1;
          g.fillStyle = w.col;
          const cx = sx + 24, cy = by + 29;
          if (i === 0) { g.beginPath(); g.arc(cx, cy, 6, 0, PI * 2); g.fill(); }
          else if (i === 1) { g.beginPath(); g.arc(cx, cy, 10, 0, PI * 2); g.fill(); g.fillStyle = "#2a1a1a"; g.beginPath(); g.arc(cx + 2, cy - 2, 3, 0, PI * 2); g.fill(); }
          else for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(cx + k * 8, cy + (k ? -3 : 3), 3.6, 0, PI * 2); g.fill(); }
          label(g, w.short, sx + 82, by + 21, 11.5, "#fff", "center");
          label(g, am < 0 ? "∞" : "× " + am, sx + 82, by + 40, 13, sel ? w.col : "#cfd4ff", "center", 800, MONO);
          g.restore();
          label(g, String(i + 1), sx + 9, by + 11, 9.5, "rgba(255,255,255,.55)", "left", 700, MONO);
          if (sel && me.cd > 0) { g.save(); rr(g, sx, by, sw, 58, 11); g.clip(); g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(sx, by, sw * Math.min(1, me.cd / WEAPONS[i].cd), 58); g.restore(); }
        });
        g.restore();

        // Kraftanzeige
        const pw = 360, px = (W - pw) / 2, py = by - 30;
        panel(px, py, pw, 20, 10, null, 0.7);
        const pf = charging ? power : 0;
        if (pf > 0) { const gr = g.createLinearGradient(px, 0, px + pw, 0); gr.addColorStop(0, "#74e2b2"); gr.addColorStop(0.6, "#ffd27a"); gr.addColorStop(1, "#ff6e6e"); g.fillStyle = gr; rr(g, px + 3, py + 3, Math.max(8, (pw - 6) * pf), 14, 7); g.fill(); }
        else label(g, alive ? (me.cd > 0 ? "lädt nach …" : "Leertaste halten = Kraft aufladen") : "", px + pw / 2, py + 10.5, 10.5, "rgba(207,212,255,.6)", "center", 600);
        g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(px + pw * k / 4, py + 4); g.lineTo(px + pw * k / 4, py + 16); g.stroke(); }
        if (pf > 0) label(g, Math.round(pf * 100) + "%", px + pw + 12, py + 11, 12, "#fff", "left", 800, MONO);
        // Winkel
        const deg = Math.round(me.face > 0 ? me.elev * 180 / PI : me.elev * 180 / PI);
        panel(bx - 112, by + 6, 98, 46, 10, null, 0.66);
        label(g, "WINKEL", bx - 63, by + 20, 9.5, "rgba(207,212,255,.65)", "center", 700);
        label(g, deg + "°", bx - 63, by + 38, 17, "#fff", "center", 800, MONO);
        label(g, me.face > 0 ? "▶" : "◀", bx - 20, by + 38, 11, "#9ad4ff", "center");
        // Hilfe rechts
        g.save(); g.globalAlpha = 0.6;
        const hl = ["← → fahren", "↑ ↓ Rohr", "Leertaste feuern", "1 2 3 Waffe"];
        hl.forEach((s, i) => label(g, s, bx + bw + 22, by + 8 + i * 14, 10.5, "#cfd4ff", "left", 600));
        g.restore();
      }

      // Mitte: Banner
      if (phase === "wait") banner("Warte auf den Host …", "Das Gelände wird gebaut");
      else if (phase === "countdown") {
        const n3 = Math.ceil(pl);
        g.save(); g.globalAlpha = 0.9; label(g, n3 > 0 ? String(n3) : "LOS!", W / 2, H * 0.34, 110 + (pl % 1) * 26, "#fff", "center", 900); g.restore();
        label(g, `Runde ${round} – mach dich bereit`, W / 2, H * 0.34 + 74, 16, "rgba(255,255,255,.85)", "center", 700);
      } else if (phase === "run" && me && !me.alive && !me.gone) {
        panel(W / 2 - 150, H - 36 - 100, 300, 28, 10, null, 0.7); label(g, "Ausgeschieden – du schaust zu", W / 2, H - 122, 12.5, "#ffb0b0", "center", 700);
      } else if (phase === "over") {
        const wt = winner !== null && winner >= 0 ? tanks[winner] : null;
        const bw2 = 430, bh = 70 + Math.min(6, act.length) * 25, bx2 = (W - bw2) / 2, by2 = H * 0.16;
        panel(bx2, by2, bw2, bh, 16, wt ? wt.color : "#cfd4ff", 0.84);
        label(g, wt ? `${wt.name} gewinnt die Runde!` : "Unentschieden!", W / 2, by2 + 30, 24, wt ? wt.color : "#fff", "center", 900);
        const rows = act.slice().sort((a, b) => b.wins - a.wins || b.kills - a.kills);
        rows.slice(0, 6).forEach((t, i) => {
          const ry = by2 + 62 + i * 25;
          g.fillStyle = t.color; g.beginPath(); g.arc(bx2 + 36, ry, 6, 0, PI * 2); g.fill();
          label(g, t.name + (t === me ? " (du)" : ""), bx2 + 52, ry, 14, "#fff", "left", 700);
          label(g, `★ ${t.wins}   ✦ ${t.kills}`, bx2 + bw2 - 30, ry, 13, "#cfd4ff", "right", 700, MONO);
        });
        label(g, activeTanks().length < 2 ? "Warte auf Mitspieler …" : `Nächste Runde in ${Math.ceil(pl)} …`, W / 2, by2 + bh + 20, 13, "rgba(255,255,255,.8)", "center", 700);
      }
    }
    function banner(a, b) {
      panel(W / 2 - 190, H * 0.36, 380, 74, 16, null, 0.78);
      label(g, a, W / 2, H * 0.36 + 28, 22, "#fff", "center", 800); label(g, b, W / 2, H * 0.36 + 54, 13, "rgba(207,212,255,.7)", "center", 600);
    }

    // ---- Hauptschleife ----
    let raf = 0, last = performance.now(), dead = false;
    function frame(now) {
      if (dead) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      try { update(dt); draw(); } catch (e) { console.error(e); }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    let hello = 0;
    return {
      go() {
        started = true;
        if (isHost()) { if (phase === "wait") newRound(); }
        else {
          const ask = () => { if (!gotState) ctx.send("hello", null, ctx.hostId); };
          ask(); hello = setInterval(() => { if (gotState) { clearInterval(hello); hello = 0; } else ask(); }, 1200);
        }
      },
      destroy() {
        dead = true; cancelAnimationFrame(raf); clearInterval(hello);
        window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onBlur);
      },
    };
  },
};
