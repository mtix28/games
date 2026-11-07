// KABOOM — Bomben-Labyrinth für den Multiplayer-Hub (2–4 Plätze, freie Plätze auf Wunsch mit Bots).
// „Yes Rico, KABOOM“
//
// Spielfeld 15 × 11: Rand und Schachbrett-Pfeiler sind fest, ~70 % der übrigen Felder sind Fässer, die
// Felder um jede Startecke bleiben frei. Bomben gehen nach 3 s hoch und brennen kreuzförmig (Start-
// Reichweite 2). Feste Blöcke stoppen die Flamme, das erste Fass in jeder Richtung wird zerstört und
// stoppt sie ebenfalls, andere Bomben im Feuer zünden sofort mit (Kettenreaktion). Wer in einer Flamme
// steht, scheidet aus. Aus 30 % der Fässer fällt ein Extra: Feuer (+1 Reichweite), Extra-Bombe (+1
// gleichzeitig) oder Schuhe (schneller); Flammen verbrennen herumliegende Extras. Die eigene Bombe kann man
// nach dem Legen noch verlassen, danach blockiert sie. Letzter Überlebender gewinnt die Runde, der Host
// legt fest, ob das Match bis 3 oder 5 Siege oder endlos geht. Freie Plätze kann der Host mit Bots füllen.
//
// Steuerung: Pfeiltasten / WASD laufen · Leertaste Bombe · M Ton aus/an.
//
// Netzwerk (host-autoritativ wie Panzerschlacht): Der Host simuliert alles mit festen 30 Ticks/s (auch
// die Bots). Gäste schicken nur Eingaben —
//   "in"  – Laufrichtung (bei Änderung und alle 250 ms), "bm" – Bombe legen, "rdy" – Bereit an/aus,
// und bekommen
//   "t"   – kompakter Schnappschuss der Figuren (Position, Richtung, lebt), jeden Tick,
//   "st"  – vollständiger Stand (Feld, Bomben, Flammen, Extras, Plätze, Punkte), bei jedem
//           Phasenwechsel und alle 1,5 s,
//   "b" / "x" / "p" / "d" – Ereignisse: Bombe gelegt, Explosion, Extra eingesammelt, Spieler raus.
// Fremde Figuren werden 100 ms verzögert zwischen zwei Schnappschüssen interpoliert; die eigene Figur läuft
// sofort (Vorhersage mit derselben Bewegungsfunktion) und wird sanft auf den Host-Stand gezogen. Weil
// jeder Client das ganze Feld kennt, rechnet nach einem Host-Wechsel der neue Host einfach weiter.

import { shell } from "../hub-kit.js";

// ---- Feld ----
const COLS = 15, ROWS = 11, N = COLS * ROWS;
const PX = 16;                                   // Pixel je Feld im Pixel-Art-Puffer (per CSS hochskaliert)
const BW = COLS * PX, BH = ROWS * PX;
const EMPTY = 0, WALL = 1, CRATE = 2;
const CRATE_RATE = 0.7, ITEM_RATE = 0.3;
const FIRE = 1, BOMB = 2, SHOE = 3;              // Extras
const SPAWNS = [[1, 1], [COLS - 2, ROWS - 2], [COLS - 2, 1], [1, ROWS - 2]];
const COLKEYS = ["mint", "sky", "rose", "lilac"];
const BOT_NAMES = ["Bot Rudi", "Bot Funki", "Bot Zisch", "Bot Knalli"];
const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // runter, hoch, links, rechts

// Flammen-Formen je Feld: 1 Mitte, 2 waagrecht, 3 senkrecht, 4–7 Enden (links, rechts, oben, unten)
const F_CENTER = 1, F_H = 2, F_V = 3;
const F_END = [7, 6, 4, 5];                      // Ende in Richtung DIRS[d]

// ---- Regeln ----
const TICK = 1 / 30;
const FUSE = 3, FLAME = 0.55;
const RANGE0 = 2, BOMBS0 = 1, MAX_RANGE = 8, MAX_BOMBS = 8, MAX_SHOES = 4;
const SPEED0 = 3.3, SPEED_STEP = 0.55;           // Felder pro Sekunde
const COUNTDOWN = 3, END_DELAY = 1.0, OVER_TIME = 4;
const STATE_MS = 1500, INTERP_MS = 100, INPUT_MS = 250;
const PHASES = ["ready", "count", "run", "end", "over", "match"];
const TARGETS = [3, 5, 0];                       // Siege bis zum Matchgewinn, 0 = endlos

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, d = 0) => { v = +v; return Number.isFinite(v) ? clamp(v, lo, hi) : d; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const idx = (x, y) => y * COLS + x;
const speedOf = (s) => SPEED0 + SPEED_STEP * s.shoes;

function rng(s) {
  s = s >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Feld aus einem Seed: Rand + Pfeiler fest, Fässer zufällig, Startecken frei
function genGrid(seed) {
  const r = rng(seed), g = new Uint8Array(N), safe = new Set();
  for (const [sx, sy] of SPAWNS) {
    const dx = sx === 1 ? 1 : -1, dy = sy === 1 ? 1 : -1;
    safe.add(idx(sx, sy)); safe.add(idx(sx + dx, sy)); safe.add(idx(sx, sy + dy));
  }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const i = idx(x, y);
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) g[i] = WALL;
    else if (!safe.has(i) && r() < CRATE_RATE) g[i] = CRATE;
  }
  return g;
}
const pickItem = () => { const r = Math.random(); return r < 0.4 ? FIRE : r < 0.8 ? BOMB : SHOE; };

// ---- Farben (immer aus der Theme-Palette PAL) ----
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dark = (a, f) => mix(a, [0, 0, 0], f);
const lite = (a, f) => mix(a, [255, 255, 255], f);
const rgb = (a, al) => (al == null ? `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})` : `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al})`);
const SHADOW = "rgba(0,0,0,.2)";

// ---- Pixel-Sprites (16 × 16, Buchstabe → Farbe) ----
const PLAYER = [
  "................",
  ".......ll.......",
  ".......o........",
  ".....oooooo.....",
  "....obbbbbbo....",
  "...obllbbbbbo...",
  "...oblbbbbbbo...",
  null,                     // Augen
  null,                     // Pupillen
  "...obbbbbbbbo...",
  "...odbbbbbbdo...",
  "....oddddddo....",
  ".....oooooo.....",
  null,                     // Füße
  "................",
  "....ssssssss....",
];
const EYES = [
  ["...obwwbbwwbo...", "...obppbbppbo..."],   // runter
  ["...obbbbbbbbo...", "...obbbbbbbbo..."],   // hoch (Rücken)
  ["...owwbwwbbbo...", "...opwbpwbbbo..."],   // links
  ["...obbbwwbwwo...", "...obbbwpbwpo..."],   // rechts
];
const FEET = ["....ff....ff....", ".....ff..ff....."];
const CRATE_MAP = [
  "................",
  "....oooooooo....",
  "...ollllllllo...",
  "..obhbbbvbbbbo..",
  "..oddddddddddo..",
  "..obhbbbvbbbbo..",
  "..obhbbbvbbbbo..",
  "..obhbbbvbbbbo..",
  "..obhbbbvbbbbo..",
  "..obhbbbvbbbbo..",
  "..oddddddddddo..",
  "..obhbbbvbbbbo..",
  "...obbbbbbbbo...",
  "....oooooooo....",
  "...ssssssssss...",
  "................",
];
const BOMB_MAP = [
  "................",
  "................",
  ".........f......",
  "........f.......",
  "......oooo......",
  "....oommmmoo....",
  "...ommhhmmmmo...",
  "...omhhmmmmmo...",
  "..ommhmmmmmmmo..",
  "..ommmmmmmmmmo..",
  "..ommmmmmmmmmo..",
  "...ommmmmmmmo...",
  "...ommmmmmmmo...",
  "....oommmmoo....",
  "......oooo......",
  "....ssssssss....",
];
const ICONS = {
  [FIRE]: [
    "....r.....",
    "...rr.....",
    "...rrr..r.",
    "..rrsrr.r.",
    "..rssrrrr.",
    ".rrssyrrr.",
    ".rsyyyysr.",
    ".rsyyyysr.",
    "..rsyyysr.",
    "...rrrrr..",
  ],
  [BOMB]: [
    "......f...",
    ".....f.y..",
    "...oooo...",
    "..ommmmo..",
    ".omhmmmmo.",
    ".ommmmmmo.",
    ".ommmmmmo.",
    ".ommmmmmo.",
    "..ommmmo..",
    "...oooo...",
  ],
  [SHOE]: [
    "..........",
    "...kkkk...",
    "...kssk...",
    "...kssk...",
    "w..ksskkk.",
    "ww.ksssssk",
    "w..ksssssk",
    "...kkkkkkk",
    "...hhhhhhh",
    "..........",
  ],
};

function canvasOf(w, h, fn) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  fn(x);
  return c;
}
function paintMap(c, rows, colors, ox = 0, oy = 0) {
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const col = colors[r[x]];
      if (!col) continue;
      c.fillStyle = col; c.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

// ---- Töne (Web Audio, erst nach der ersten Taste) ----
const SOUND_KEY = "kaboom_state";
function loadMute() { try { const d = JSON.parse(localStorage.getItem(SOUND_KEY) || "{}"); return d.mute === true; } catch (e) { return false; } }
function saveMute(m) { try { localStorage.setItem(SOUND_KEY, JSON.stringify({ mute: !!m })); } catch (e) { /* privat-Modus */ } }

export default {
  min: 1, max: 4,

  mount(ctx) {
    const kit = shell(ctx, { title: "KABOOM" });
    const root = kit.body;
    root.innerHTML = `<div class="kb">
      <div class="kb-bar"></div>
      <div class="kb-stage">
        <canvas class="kb-cv" width="${BW}" height="${BH}" aria-label="KABOOM Spielfeld"></canvas>
        <div class="kb-ov"></div>
      </div>
      <p class="kb-help">Pfeiltasten / WASD laufen · Leertaste Bombe · M Ton an/aus</p>
    </div>`;
    const wrap = root.querySelector(".kb"), bar = root.querySelector(".kb-bar"), ov = root.querySelector(".kb-ov");
    const cv = root.querySelector(".kb-cv"), g = cv.getContext("2d");

    // ================== Zustand (auf jedem Client) ==================
    let phase = "ready", pl = 0, round = 0, seed = 1, target = 3, roundWinner = -2, matchWinner = -1;
    let grid = new Uint8Array(N);
    const items = new Uint8Array(N), hidden = new Uint8Array(N);       // hidden: Extra unter einer brennenden Fass-Stelle
    const flameT = new Float32Array(N), flameK = new Uint8Array(N);
    let bombs = [], bombId = 1;
    let seats = [];
    let gotState = false, wasHost = false, started = false, tickNo = 0;
    let snaps = [];                                                      // Gast: letzte Schnappschüsse für die Interpolation
    let fx = [], feed = [], shake = 0, staticDirty = true;

    function mkSeat(id, name, bot) {
      return {
        id: String(id), name: String(name || "Spieler").slice(0, 16), bot: !!bot, c: 0,
        x: 1, y: 1, px: 1, py: 1, dir: 0, mov: false, alive: false, gone: false,
        wins: 0, range: RANGE0, bombs: BOMBS0, shoes: 0, ready: !!bot,
        in: -1, want: 0, ai: null, dieT: 0, walk: 0,
      };
    }
    seats = ctx.players.slice(0, 4).map((p) => mkSeat(p.id, p.name, false));
    const recolor = () => seats.forEach((s, k) => { s.c = k; });
    recolor();

    const isHost = () => !!ctx.isHost;
    const seatOf = (id) => seats.findIndex((s) => s.id === id);
    const meIdx = () => seatOf(ctx.me.id);
    const meSeat = () => seats[meIdx()] || null;
    const active = () => seats.filter((s) => !s.gone);
    const alive = () => seats.filter((s) => s.alive && !s.gone);
    const playing = () => phase === "run" || phase === "end";

    // ================== Bewegung ==================
    const bombAt = (x, y) => bombs.find((b) => b.x === x && b.y === y) || null;
    const overlaps = (s, x, y) => Math.abs(s.x - x) < 0.99 && Math.abs(s.y - y) < 0.99;
    function blocked(x, y, si) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
      if (grid[idx(x, y)] !== EMPTY) return true;
      const b = bombAt(x, y);
      return !!b && !b.pass.has(si);
    }

    // Rasterbewegung mit weichem Gleiten und Ecken-Korrektur: Wer quer zur Laufrichtung knapp neben einem
    // Gang steht, rutscht automatisch in die Spur, statt an der Kante hängen zu bleiben.
    function moveSeat(s, si, dir, dist, limit = Infinity) {
      if (dir < 0 || dist <= 0) { s.mov = false; return; }
      s.dir = dir;
      const [dx, dy] = DIRS[dir], h = dx !== 0, d = h ? dx : dy;
      let a = h ? s.x : s.y, c = h ? s.y : s.x;
      const free = (ma, mc) => !blocked(h ? ma : mc, h ? mc : ma, si);
      const ra = Math.round(a), rc = Math.round(c), off = c - rc;
      let moved = false;
      if (Math.abs(off) > 0.001) {
        let lane = null;
        if (free(ra + d, rc)) lane = rc;
        else {
          const o = rc + Math.sign(off);
          if (Math.abs(off) > 0.15 && free(ra + d, o) && free(ra, o)) lane = o;
        }
        if (lane === null) { s.mov = false; return; }
        const step = Math.min(Math.abs(lane - c), dist);
        c += Math.sign(lane - c) * step; dist -= step; moved = step > 0;
        if (Math.abs(lane - c) > 1e-4) {
          if (h) s.y = c; else s.x = c;
          s.mov = moved; return;
        }
        c = lane;
      } else c = rc;
      let na = a + d * Math.min(dist, limit);
      const cur = Math.round(a);
      if (!free(cur + d, c)) na = d > 0 ? Math.min(na, Math.max(a, cur)) : Math.max(na, Math.min(a, cur));
      if (Math.abs(na - a) > 1e-5) moved = true;
      if (h) { s.x = na; s.y = c; } else { s.y = na; s.x = c; }
      s.mov = moved;
    }
    function updatePass() {
      for (const b of bombs) for (const k of b.pass) { const s = seats[k]; if (!s || !s.alive || !overlaps(s, b.x, b.y)) b.pass.delete(k); }
    }

    // ================== Bomben & Explosionen ==================
    function applyBomb(d) {                                  // [id, x, y, owner, range]
      const [id, x, y, o, r] = d;
      if (bombs.some((b) => b.id === id) || bombAt(x, y)) return;
      const pass = new Set();
      seats.forEach((s, k) => { if (s.alive && overlaps(s, x, y)) pass.add(k); });
      bombs.push({ id, x, y, o, r, t: FUSE, pass });
      bombId = Math.max(bombId, id + 1);
      sfx.place(seats[o] === meSeat());
    }
    function placeBomb(si) {                                 // nur Host
      const s = seats[si];
      if (!s || !s.alive || !playing()) return;
      const x = Math.round(s.x), y = Math.round(s.y);
      if (grid[idx(x, y)] !== EMPTY || bombAt(x, y)) return;
      if (bombs.filter((b) => b.o === si).length >= s.bombs) return;
      const d = [bombId++, x, y, si, s.range];
      ctx.send("b", d); applyBomb(d);
    }

    // Welche Bomben gehen hoch, welche Felder brennen (nur Host; Gäste bekommen das Ergebnis)
    function computeBlast(first) {
      const done = new Set(), queue = [first], cells = new Map(), crates = [], burnt = [];
      const add = (i, k) => { const o = cells.get(i); cells.set(i, o && o !== k ? F_CENTER : (o || k)); };
      while (queue.length) {
        const b = queue.shift();
        if (done.has(b.id)) continue;
        done.add(b.id);
        add(idx(b.x, b.y), F_CENTER);
        DIRS.forEach(([dx, dy], dd) => {
          const line = dx ? F_H : F_V, end = F_END[dd];
          let prev = -1;
          for (let k = 1; k <= b.r; k++) {
            const x = b.x + dx * k, y = b.y + dy * k, i = idx(x, y);
            if (grid[i] === WALL) { if (prev >= 0 && cells.get(prev) === line) cells.set(prev, end); break; }
            if (grid[i] === CRATE) { add(i, end); if (!crates.includes(i)) crates.push(i); break; }
            const ob = bombAt(x, y);
            if (ob) { add(i, F_CENTER); if (!done.has(ob.id)) queue.push(ob); break; }
            if (items[i]) { add(i, end); if (!burnt.includes(i)) burnt.push(i); break; }
            add(i, k === b.r ? end : line);
            prev = i;
          }
        });
      }
      const f = [];
      for (const [i, k] of cells) f.push(i, k);
      const c = [];
      for (const i of crates) c.push(i, Math.random() < ITEM_RATE ? pickItem() : 0);
      return { ids: [...done], f, c, it: burnt };
    }
    function applyBlast(d) {
      const gone = bombs.filter((b) => d.ids.includes(b.id));
      bombs = bombs.filter((b) => !d.ids.includes(b.id));
      for (let k = 0; k + 1 < d.f.length; k += 2) { const i = d.f[k]; flameT[i] = FLAME; flameK[i] = d.f[k + 1]; }
      for (let k = 0; k + 1 < d.c.length; k += 2) {
        const i = d.c[k];
        grid[i] = EMPTY; hidden[i] = d.c[k + 1]; items[i] = 0;
        burst((i % COLS) * PX + 8, ((i / COLS) | 0) * PX + 8, 10, PAL.peach, 70, 0.6);
      }
      for (const i of d.it) { items[i] = 0; burst((i % COLS) * PX + 8, ((i / COLS) | 0) * PX + 8, 6, PAL.sun, 50, 0.4); }
      for (const b of gone) burst(b.x * PX + 8, b.y * PX + 8, 8, PAL.sunHi, 90, 0.35);
      staticDirty = true;
      shake = Math.max(shake, Math.min(5, 2 + gone.length));
      sfx.boom(gone.length);
    }
    function tickFlames(dt) {
      for (let i = 0; i < N; i++) {
        if (flameT[i] <= 0) continue;
        flameT[i] -= dt;
        if (flameT[i] <= 0) {
          flameT[i] = 0; flameK[i] = 0;
          if (hidden[i]) { items[i] = hidden[i]; hidden[i] = 0; }
        }
      }
    }

    // ================== Extras & Ausscheiden ==================
    function applyPick(d) {                                  // [seat, cell, type]
      const [si, i, t] = d, s = seats[si];
      items[i] = 0;
      if (!s) return;
      if (t === FIRE) s.range = Math.min(MAX_RANGE, s.range + 1);
      else if (t === BOMB) s.bombs = Math.min(MAX_BOMBS, s.bombs + 1);
      else if (t === SHOE) s.shoes = Math.min(MAX_SHOES, s.shoes + 1);
      burst((i % COLS) * PX + 8, ((i / COLS) | 0) * PX + 8, 8, PAL.sunHi, 40, 0.5);
      if (s === meSeat()) sfx.pick();
    }
    function applyDeath(si) {
      const s = seats[si];
      if (!s || !s.alive) return;
      s.alive = false; s.dieT = 1; s.mov = false;
      burst(s.x * PX + 8, s.y * PX + 6, 16, PAL[COLKEYS[s.c]], 80, 0.8);
      feed.push({ t: 4, txt: s === meSeat() ? "Du bist raus!" : `${s.name} ist raus`, c: s.c });
      if (feed.length > 4) feed.shift();
      sfx.die(s === meSeat());
    }
    function hostChecks() {
      seats.forEach((s, si) => {
        if (!s.alive) return;
        const i = idx(Math.round(s.x), Math.round(s.y));
        if (flameT[i] > 0) { ctx.send("d", [si]); applyDeath(si); return; }
        if (items[i]) { const d = [si, i, items[i]]; ctx.send("p", d); applyPick(d); }
      });
    }

    // ================== Runden (nur Host) ==================
    function newMatch() {
      seats.forEach((s) => { s.wins = 0; });
      round = 0; matchWinner = -1;
      newRound();
    }
    function newRound() {
      const act = active();
      if (act.length < 2) { toReady(); return; }
      round++;
      seed = (Math.random() * 4294967295) >>> 0;
      grid = genGrid(seed);
      items.fill(0); hidden.fill(0); flameT.fill(0); flameK.fill(0);
      bombs = []; fx = []; feed = [];
      act.forEach((s, k) => {
        const [x, y] = SPAWNS[k];
        Object.assign(s, { x, y, px: x, py: y, dir: 0, mov: false, alive: true, range: RANGE0, bombs: BOMBS0, shoes: 0, in: -1, want: 0, ai: null, dieT: 0 });
      });
      staticDirty = true;
      setPhase("count", COUNTDOWN, -2);
      sendState();
    }
    function finishRound() {
      const al = alive();
      const wn = al.length === 1 ? seats.indexOf(al[0]) : -1;
      if (wn >= 0) seats[wn].wins++;
      if (wn >= 0 && target > 0 && seats[wn].wins >= target) setPhase("match", 0, wn, wn);
      else setPhase("over", OVER_TIME, wn);
      sendState();
    }
    function toReady() {
      setPhase("ready", 0, -2, -1); round = 0;
      seats = seats.filter((s) => !s.gone);
      seats.forEach((s) => { s.ready = s.bot; s.alive = false; s.wins = 0; });
      bombs = []; flameT.fill(0); flameK.fill(0);
      recolor();
      sendState();
    }
    const canStart = () => seats.length >= 2 && seats.every((s) => s.bot || s.id === ctx.me.id || s.ready);

    function hostStep(dt) {
      if (phase === "count") {
        pl -= dt;
        if (pl <= 0) { setPhase("run", 0); sendState(); }
      } else if (playing()) {
        const me = meSeat();
        if (me) me.in = me.alive ? localDir() : -1;
        seats.forEach((s, si) => {
          s.px = s.x; s.py = s.y;
          if (!s.alive || s.gone) { s.mov = false; return; }
          if (s.bot) botTick(s, si, dt);
          moveSeat(s, si, s.in, speedOf(s) * dt, s.bot ? botLimit(s) : Infinity);
        });
        seats.forEach((s, si) => { if (s.want) { s.want = 0; placeBomb(si); } });
        updatePass();
        for (const b of bombs) b.t -= dt;
        for (let b = bombs.find((q) => q.t <= 0); b; b = bombs.find((q) => q.t <= 0)) {
          const d = computeBlast(b);
          ctx.send("x", d); applyBlast(d);
        }
        tickFlames(dt);
        hostChecks();
        if (phase === "run" && alive().length <= 1) setPhase("end", END_DELAY);
        else if (phase === "end") { pl -= dt; if (pl <= 0) finishRound(); }
      } else if (phase === "over") {
        tickFlames(dt);
        pl -= dt;
        if (pl <= 0) newRound();
      }
      if (phase !== "ready" && phase !== "match") sendTick();
      stateAcc += dt * 1000;
      if (stateAcc >= STATE_MS) { stateAcc = 0; sendState(); }
    }
    let stateAcc = 0;

    // ================== Bots (laufen beim Host) ==================
    function blastCells(x, y, r) {
      const out = [idx(x, y)];
      for (const [dx, dy] of DIRS) for (let k = 1; k <= r; k++) {
        const cx = x + dx * k, cy = y + dy * k, i = idx(cx, cy);
        if (grid[i] === WALL) break;
        out.push(i);
        if (grid[i] === CRATE || bombAt(cx, cy) || items[i]) break;
      }
      return out;
    }
    // Für jedes Feld: in wie vielen Sekunden brennt es (1e9 = sicher); Kettenreaktionen eingerechnet
    function dangerMap(extra) {
      const T = new Float32Array(N).fill(1e9);
      for (let i = 0; i < N; i++) if (flameT[i] > 0) T[i] = 0;
      const list = bombs.map((b) => ({ x: b.x, y: b.y, r: b.r, t: b.t }));
      if (extra) list.push(extra);
      const cells = list.map((b) => blastCells(b.x, b.y, b.r));
      for (let pass = 0; pass < 3; pass++) {
        list.forEach((a, k) => {
          for (const i of cells[k]) for (const b of list) if (b !== a && idx(b.x, b.y) === i && b.t > a.t) b.t = a.t;
        });
      }
      list.forEach((b, k) => { for (const i of cells[k]) T[i] = Math.min(T[i], b.t); });
      return T;
    }
    function bfs(sx, sy, T, stepT, avoid) {
      const dist = new Int16Array(N).fill(-1), prev = new Int16Array(N).fill(-1), order = [];
      const s0 = idx(sx, sy);
      dist[s0] = 0;
      const q = [s0];
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        order.push(i);
        const x = i % COLS, y = (i / COLS) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, j = idx(nx, ny);
          if (dist[j] >= 0 || grid[j] !== EMPTY || bombAt(nx, ny)) continue;
          const arrive = (dist[i] + 1) * stepT;
          if (T[j] < 1e8 && (avoid || T[j] <= arrive + stepT + 0.25) && !(arrive > T[j] + FLAME + 0.15)) continue;
          dist[j] = dist[i] + 1; prev[j] = i; q.push(j);
        }
      }
      return { dist, prev, order };
    }
    function pathTo(r, target) {
      const p = [];
      for (let i = target; i >= 0 && r.dist[i] > 0; i = r.prev[i]) p.unshift(i);
      return p;
    }
    function bombValue(x, y, range, si) {
      let v = 0;
      for (const i of blastCells(x, y, range)) {
        if (grid[i] === CRATE) v += 1;
        seats.forEach((o, k) => { if (k !== si && o.alive && idx(Math.round(o.x), Math.round(o.y)) === i) v += 2; });
      }
      return v;
    }
    function canEscape(x, y, s, stepT) {
      const T = dangerMap({ x, y, r: s.range, t: FUSE });
      const r = bfs(x, y, T, stepT, false);
      return r.order.some((i) => T[i] >= 1e8 && r.dist[i] * stepT < FUSE - 0.6);
    }
    function botThink(s, si) {
      const ai = s.ai;
      const x = Math.round(s.x), y = Math.round(s.y), here = idx(x, y), stepT = 1 / speedOf(s);
      const T = dangerMap();
      if (T[here] < 1e8) {                                   // in Gefahr: zum nächsten sicheren Feld
        const r = bfs(x, y, T, stepT, false);
        let best = r.order.find((i) => T[i] >= 1e8);
        if (best == null) best = r.order.reduce((m, i) => (T[i] > T[m] ? i : m), here);
        ai.path = pathTo(r, best);
        return;
      }
      const r = bfs(x, y, T, stepT, true);
      for (const i of r.order) {                             // Extra in der Nähe einsammeln
        if (r.dist[i] > 7) break;
        if (items[i]) { ai.path = pathTo(r, i); return; }
      }
      const mine = bombs.filter((b) => b.o === si).length;
      if (mine < s.bombs && Math.random() > 0.08 && bombValue(x, y, s.range, si) > 0 && canEscape(x, y, s, stepT)) {
        s.want = 1; ai.path = []; ai.think = 0.12;
        return;
      }
      let best = -1, bestScore = -1e9;                       // guter Platz für die nächste Bombe
      for (const i of r.order) {
        const d = r.dist[i];
        if (d > 12) break;
        const v = bombValue(i % COLS, (i / COLS) | 0, s.range, si);
        if (!v) continue;
        const score = v * 3 - d + Math.random();
        if (score > bestScore) { best = i; bestScore = score; }
      }
      if (best >= 0 && best !== here) { ai.path = pathTo(r, best); return; }
      const foes = seats.filter((o, k) => k !== si && o.alive);     // sonst: Richtung Gegner
      if (foes.length && r.order.length > 1) {
        const f = foes[(Math.random() * foes.length) | 0];
        const tgt = r.order.reduce((m, i) => {
          const dm = Math.abs((m % COLS) - f.x) + Math.abs(((m / COLS) | 0) - f.y), di = Math.abs((i % COLS) - f.x) + Math.abs(((i / COLS) | 0) - f.y);
          return di < dm ? i : m;
        }, here);
        if (tgt !== here) { ai.path = pathTo(r, tgt); return; }
      }
      const opts = r.order.filter((i) => r.dist[i] > 0 && r.dist[i] < 5);
      ai.path = opts.length ? pathTo(r, opts[(Math.random() * opts.length) | 0]) : [];
    }
    function botTick(s, si, dt) {
      const ai = s.ai || (s.ai = { path: [], think: Math.random() * 0.3, stuck: 0 });
      ai.think -= dt;
      const cx = Math.round(s.x), cy = Math.round(s.y);
      const centred = Math.abs(s.x - cx) < 0.12 && Math.abs(s.y - cy) < 0.12;
      if (ai.think <= 0 && (centred || !ai.path.length || ai.stuck > 0.4)) {
        botThink(s, si);
        ai.think = 0.18 + Math.random() * 0.14;              // Reaktionszeit (mittlere Stärke)
        ai.stuck = 0;
      }
      while (ai.path.length) {
        const n = ai.path[0];
        if (Math.abs(s.x - (n % COLS)) < 0.02 && Math.abs(s.y - ((n / COLS) | 0)) < 0.02) ai.path.shift();
        else break;
      }
      let tx = cx, ty = cy;
      if (ai.path.length) {
        const n = ai.path[0];
        tx = n % COLS; ty = (n / COLS) | 0;
        if (blocked(tx, ty, si) && !(tx === cx && ty === cy)) { ai.path = []; ai.think = 0; tx = cx; ty = cy; }
      }
      const dx = tx - s.x, dy = ty - s.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) { s.in = -1; s.target = null; return; }
      s.in = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : (dy > 0 ? 0 : 1);
      s.target = [tx, ty];
      if (!s.mov && ai.path.length) ai.stuck += dt; else ai.stuck = 0;
    }
    const botLimit = (s) => (s.target ? Math.max(Math.abs(s.target[0] - s.x), Math.abs(s.target[1] - s.y)) : Infinity);

    // ================== Netzwerk ==================
    function snapshot() {
      const fl = [];
      for (let i = 0; i < N; i++) if (flameT[i] > 0) fl.push(i, flameK[i], Math.round(flameT[i] * 100));
      return {
        ph: PHASES.indexOf(phase), pl: Math.round(pl * 100), rd: round, sd: seed, tg: target, wn: roundWinner, mw: matchWinner,
        g: grid.join(""), it: items.join(""), hd: hidden.join(""), fl,
        bm: bombs.map((b) => { let m = 0; for (const k of b.pass) m |= 1 << k; return [b.id, b.x, b.y, b.o, b.r, Math.round(b.t * 100), m]; }),
        s: seats.map((s) => [s.id, s.name, s.bot ? 1 : 0, Math.round(s.x * 100), Math.round(s.y * 100), s.dir, s.alive ? 1 : 0, s.gone ? 1 : 0, s.wins, s.range, s.bombs, s.shoes, s.ready ? 1 : 0]),
      };
    }
    const sendState = (to) => ctx.send("st", snapshot(), to);
    function sendTick() {
      const p = [];
      for (const s of seats) p.push(Math.round(s.x * 100), Math.round(s.y * 100), s.dir, s.mov ? 1 : 0, s.alive ? 1 : 0);
      ctx.send("t", { n: ++tickNo, ph: PHASES.indexOf(phase), pl: Math.round(pl * 100), p });
    }
    const fromHost = (from) => from === ctx.hostId && !isHost();
    const digits = (str, max) => {
      const a = new Uint8Array(N);
      if (typeof str !== "string" || str.length !== N) return null;
      for (let i = 0; i < N; i++) a[i] = clamp(str.charCodeAt(i) - 48, 0, max);
      return a;
    };

    function setPhase(np, left, wn, mw) {
      if (np !== phase) {
        if (np === "count") { snaps = []; fx = []; feed = []; lastBeep = -1; }
        if (np === "run") { sfx.go(); runStart = performance.now(); }
        const me = meSeat();
        if (np === "over" && me && seats[wn] === me) { sfx.win(); try { if (typeof celebrate === "function") celebrate(1); } catch (e) { /* optional */ } }
        if (np === "match" && me && seats[mw] === me) { sfx.win(); try { if (typeof celebrate === "function") celebrate(3); } catch (e) { /* optional */ } }
        phase = np;
      }
      pl = left;
      if (wn !== undefined) roundWinner = wn;
      if (mw !== undefined) matchWinner = mw;
    }

    ctx.onMessage("st", ({ from, data: d }) => {
      if (!fromHost(from) || !d || !Array.isArray(d.s)) return;
      const list = d.s.filter(Array.isArray).slice(0, 4);
      const newRoundNow = (num(d.rd, 0, 9999, 0) | 0) !== round || !gotState;
      if (list.map((a) => String(a[0])).join("|") !== seats.map((s) => s.id).join("|")) { seats = list.map((a) => mkSeat(a[0], a[1], a[2])); snaps = []; }
      const meK = meIdx();
      list.forEach((a, k) => {
        const s = seats[k];
        s.name = String(a[1] || "Spieler").slice(0, 16); s.bot = !!a[2]; s.c = k;
        const x = num(a[3], 0, COLS * 100, 100) / 100, y = num(a[4], 0, ROWS * 100, 100) / 100;
        const al = !!a[6];
        if (k !== meK || newRoundNow || !s.alive || Math.hypot(x - s.x, y - s.y) > 1.2) { s.x = s.px = x; s.y = s.py = y; }
        if (k !== meK) s.dir = num(a[5], 0, 3, 0) | 0;
        if (s.alive && !al && playing()) applyDeath(k);
        s.alive = al; s.gone = !!a[7];
        s.wins = num(a[8], 0, 999, 0) | 0; s.range = num(a[9], 1, MAX_RANGE, RANGE0) | 0;
        s.bombs = num(a[10], 1, MAX_BOMBS, BOMBS0) | 0; s.shoes = num(a[11], 0, MAX_SHOES, 0) | 0; s.ready = !!a[12];
      });
      const gr = digits(d.g, 2), it = digits(d.it, 3), hd = digits(d.hd, 3);
      if (gr) { grid = gr; staticDirty = true; }
      if (it) items.set(it);
      if (hd) hidden.set(hd);
      flameT.fill(0); flameK.fill(0);
      if (Array.isArray(d.fl)) for (let k = 0; k + 2 < d.fl.length; k += 3) {
        const i = num(d.fl[k], 0, N - 1, 0) | 0;
        flameK[i] = num(d.fl[k + 1], 1, 7, 1) | 0; flameT[i] = num(d.fl[k + 2], 0, 100, 0) / 100;
      }
      if (Array.isArray(d.bm)) {
        bombs = d.bm.filter(Array.isArray).slice(0, 64).map((a) => {
          const pass = new Set(), m = num(a[6], 0, 15, 0) | 0;
          for (let k = 0; k < 4; k++) if (m & (1 << k)) pass.add(k);
          return { id: num(a[0], 0, 1e9, 0) | 0, x: num(a[1], 0, COLS - 1, 1) | 0, y: num(a[2], 0, ROWS - 1, 1) | 0, o: num(a[3], 0, 3, 0) | 0, r: num(a[4], 1, MAX_RANGE, 2) | 0, t: num(a[5], 0, 400, 300) / 100, pass };
        });
        for (const b of bombs) bombId = Math.max(bombId, b.id + 1);
      }
      round = num(d.rd, 0, 9999, 0) | 0; seed = num(d.sd, 0, 4294967295, 1) >>> 0;
      target = TARGETS.includes(+d.tg) ? +d.tg : 3;
      const wn = num(d.wn, -2, 3, -2) | 0, mw = num(d.mw, -1, 3, -1) | 0;
      setPhase(PHASES[num(d.ph, 0, 5, 0) | 0], num(d.pl, 0, 10000, 0) / 100, wn, mw);
      if (newRoundNow) snaps = [];
      gotState = true;
    });
    ctx.onMessage("t", ({ from, data: d }) => {
      if (!fromHost(from) || !gotState || !d || !Array.isArray(d.p)) return;
      const n = seats.length;
      if (d.p.length < n * 5) return;
      const snap = { t: performance.now(), x: new Float32Array(n), y: new Float32Array(n) };
      const meK = meIdx();
      for (let k = 0; k < n; k++) {
        const s = seats[k], o = k * 5;
        snap.x[k] = num(d.p[o], 0, COLS * 100, 100) / 100; snap.y[k] = num(d.p[o + 1], 0, ROWS * 100, 100) / 100;
        if (k !== meK) { s.dir = num(d.p[o + 2], 0, 3, 0) | 0; s.mov = !!d.p[o + 3]; }
        if (s.alive && !d.p[o + 4] && playing()) applyDeath(k);
      }
      snaps.push(snap);
      if (snaps.length > 12) snaps.shift();
      setPhase(PHASES[num(d.ph, 0, 5, 0) | 0], num(d.pl, 0, 10000, 0) / 100);
      const me = seats[meK];                                 // eigene Figur: sanft auf den Host-Stand ziehen
      if (me && me.alive && playing()) {
        const ex = snap.x[meK] - me.x, ey = snap.y[meK] - me.y, e = Math.hypot(ex, ey);
        if (e > 1.2) { me.x = me.px = snap.x[meK]; me.y = me.py = snap.y[meK]; }
        else if (idleT > 0.25 && e > 0.01) { me.x += ex * 0.25; me.y += ey * 0.25; }
      }
    });
    ctx.onMessage("b", ({ from, data: d }) => {
      if (!fromHost(from) || !Array.isArray(d) || d.length < 5) return;
      applyBomb([num(d[0], 0, 1e9, 0) | 0, num(d[1], 0, COLS - 1, 1) | 0, num(d[2], 0, ROWS - 1, 1) | 0, num(d[3], 0, 3, 0) | 0, num(d[4], 1, MAX_RANGE, 2) | 0]);
    });
    ctx.onMessage("x", ({ from, data: d }) => {
      if (!fromHost(from) || !d) return;
      const ints = (a, lo, hi) => (Array.isArray(a) ? a.slice(0, 2 * N).map((v) => num(v, lo, hi, lo) | 0) : []);
      applyBlast({ ids: ints(d.ids, 0, 1e9), f: ints(d.f, 0, N - 1), c: ints(d.c, 0, N - 1), it: ints(d.it, 0, N - 1) });
    });
    ctx.onMessage("p", ({ from, data: d }) => {
      if (!fromHost(from) || !Array.isArray(d)) return;
      applyPick([num(d[0], 0, 3, 0) | 0, num(d[1], 0, N - 1, 0) | 0, num(d[2], 1, 3, 1) | 0]);
    });
    ctx.onMessage("d", ({ from, data: d }) => {
      if (!fromHost(from) || !Array.isArray(d)) return;
      applyDeath(num(d[0], 0, 3, 0) | 0);
    });

    // Host: Eingaben der Gäste
    ctx.onMessage("in", ({ from, data: d }) => {
      if (!isHost() || !d) return;
      const s = seats[seatOf(from)];
      if (s && !s.bot) s.in = num(d.d, -1, 3, -1) | 0;
    });
    ctx.onMessage("bm", ({ from }) => {
      if (!isHost()) return;
      const s = seats[seatOf(from)];
      if (s && !s.bot && s.alive) s.want = 1;
    });
    ctx.onMessage("rdy", ({ from, data: d }) => {
      if (!isHost() || phase !== "ready" || !d) return;
      const s = seats[seatOf(from)];
      if (s && !s.bot) { s.ready = !!d.r; sendState(); }
    });
    ctx.onMessage("hello", ({ from }) => { if (isHost()) sendState(from); });
    ctx.onEvent("leave", ({ id }) => {
      const k = seatOf(id);
      if (k < 0) return;
      const s = seats[k];
      if (s.alive && playing()) applyDeath(k);
      s.gone = true; s.alive = false; s.ready = false;
      feed.push({ t: 4, txt: `${s.name} hat den Raum verlassen`, c: s.c });
      if (isHost()) {
        if (phase === "ready") { seats.splice(k, 1); recolor(); }
        sendState();
      }
    });

    // Host-Aktionen auf dem Bereit-Bildschirm
    function addBot() {
      if (!isHost() || phase !== "ready" || seats.length >= 4) return;
      const used = new Set(seats.map((s) => s.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) || "Bot";
      let k = 1;
      while (seats.some((s) => s.id === "bot:" + k)) k++;
      seats.push(mkSeat("bot:" + k, name, true));
      recolor(); sendState();
    }
    function removeBot(k) {
      if (!isHost() || phase !== "ready" || !seats[k] || !seats[k].bot) return;
      seats.splice(k, 1); recolor(); sendState();
    }

    // ================== Eingabe ==================
    const held = [];                                          // gedrückte Richtungen, die letzte gewinnt
    const KEYDIR = { ArrowDown: 0, s: 0, ArrowUp: 1, w: 1, ArrowLeft: 2, a: 2, ArrowRight: 3, d: 3 };
    const localDir = () => (held.length ? held[held.length - 1] : -1);
    const visible = () => cv.offsetParent !== null;
    const typing = (e) => { const n = e.target && e.target.tagName; return n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || (e.target && e.target.isContentEditable); };
    function dropBomb() {
      const me = meSeat();
      if (!me || !me.alive || !playing()) return;
      if (isHost()) me.want = 1; else ctx.send("bm", null, ctx.hostId);
    }
    function onKeyDown(e) {
      if (typing(e) || !visible() || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      sfx.unlock();
      if (k in KEYDIR) {
        e.preventDefault();
        const d = KEYDIR[k], at = held.indexOf(d);
        if (at >= 0) held.splice(at, 1);
        held.push(d);
      } else if (k === " ") { e.preventDefault(); if (!e.repeat) dropBomb(); }
      else if (k === "m" && !e.repeat) toggleMute();
    }
    function onKeyUp(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k in KEYDIR) {
        const d = KEYDIR[k];
        // nur loslassen, wenn keine zweite Taste derselben Richtung mehr gedrückt ist (Pfeil + WASD)
        const other = Object.keys(KEYDIR).some((q) => q !== k && KEYDIR[q] === d && downKeys.has(q));
        if (!other) { const at = held.indexOf(d); if (at >= 0) held.splice(at, 1); }
      }
    }
    const downKeys = new Set();
    const trackDown = (e) => downKeys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    const trackUp = (e) => downKeys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    function onBlur() { held.length = 0; downKeys.clear(); }
    window.addEventListener("keydown", trackDown, true);
    window.addEventListener("keyup", trackUp, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    let lastSent = -2, inputAcc = 0, idleT = 0;
    function guestStep(dt) {
      const me = meSeat(), meK = meIdx();
      if (playing() && me && me.alive) {
        me.px = me.x; me.py = me.y;
        const d = localDir();
        moveSeat(me, meK, d, speedOf(me) * dt);
        idleT = d < 0 ? idleT + dt : 0;
        inputAcc += dt * 1000;
        if (d !== lastSent || inputAcc >= INPUT_MS) { inputAcc = 0; lastSent = d; ctx.send("in", { d }, ctx.hostId); }
      } else if (me) { me.px = me.x; me.py = me.y; idleT = 1; }
      if (playing()) { updatePass(); for (const b of bombs) b.t = Math.max(0, b.t - dt); }
      tickFlames(dt);
      pl = Math.max(0, pl - dt);
    }

    // ================== Töne ==================
    let mute = loadMute(), actx = null;
    const sfx = {
      unlock() {
        if (mute) return;
        try {
          if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
          if (actx.state === "suspended") actx.resume();
        } catch (e) { actx = null; }
      },
      ok() { return !mute && actx && actx.state === "running"; },
      tone(f0, f1, dur, type, vol, delay = 0) {
        if (!this.ok()) return;
        const t = actx.currentTime + delay, o = actx.createOscillator(), gn = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        o.connect(gn).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
      },
      noise(dur, vol, f0, f1) {
        if (!this.ok()) return;
        const t = actx.currentTime, len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = actx.createBufferSource(), lp = actx.createBiquadFilter(), gn = actx.createGain();
        src.buffer = buf; lp.type = "lowpass"; lp.frequency.setValueAtTime(f0, t); lp.frequency.exponentialRampToValueAtTime(f1, t + dur);
        gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(lp).connect(gn).connect(actx.destination); src.start(t);
      },
      boom(n) { const v = Math.min(0.55, 0.32 + n * 0.06); this.noise(0.7, v, 2200, 90); this.tone(120, 38, 0.4, "sine", v); },
      place(mine) { this.tone(mine ? 300 : 260, 180, 0.08, "square", mine ? 0.07 : 0.035); },
      pick() { [523, 659, 784, 1047].forEach((f, k) => this.tone(f, f, 0.08, "square", 0.06, k * 0.055)); },
      die(mine) { this.tone(mine ? 620 : 520, 70, 0.55, "sawtooth", mine ? 0.12 : 0.06); },
      beep(hi) { this.tone(hi ? 880 : 520, hi ? 880 : 520, hi ? 0.22 : 0.1, "square", 0.06); },
      go() { this.beep(true); },
      win() { [523, 659, 784, 659, 1047].forEach((f, k) => this.tone(f, f, 0.14, "triangle", 0.09, k * 0.11)); },
    };
    function toggleMute() {
      mute = !mute; saveMute(mute);
      if (!mute) sfx.unlock();
      uiKey = "";
    }
    let lastBeep = -1, runStart = 0;

    // ================== Pixel-Grafik ==================
    let spr = null, icons = {}, avatars = [];
    function buildSprites() {
      if (typeof PAL === "undefined") return;
      const S = {};
      const wallFace = PAL.panelHi, wallTop = lite(PAL.panelHi, 0.16), wallSide = PAL.line, wallDeep = dark(PAL.line, 0.3);
      S.wall = canvasOf(PX, PX, (c) => {
        c.fillStyle = rgb(wallFace); c.fillRect(0, 0, 16, 16);
        c.fillStyle = rgb(wallTop); c.fillRect(0, 0, 16, 2); c.fillRect(0, 0, 1, 13);
        c.fillStyle = rgb(wallSide); c.fillRect(0, 12, 16, 4); c.fillRect(15, 0, 1, 16);
        c.fillStyle = rgb(wallDeep); c.fillRect(0, 15, 16, 1);
        c.fillStyle = rgb(mix(wallFace, wallSide, 0.6)); c.fillRect(3, 4, 1, 1); c.fillRect(12, 4, 1, 1); c.fillRect(3, 9, 1, 1); c.fillRect(12, 9, 1, 1);
        c.fillStyle = rgb(mix(wallFace, wallTop, 0.6)); c.fillRect(4, 3, 1, 1); c.fillRect(13, 3, 1, 1);
      });
      S.floor = [PAL.board, mix(PAL.board, PAL.well, 0.85)].map((base) => canvasOf(PX, PX, (c) => {
        c.fillStyle = rgb(base); c.fillRect(0, 0, 16, 16);
        c.fillStyle = rgb(mix(base, PAL.line, 0.35)); c.fillRect(3, 5, 1, 1); c.fillRect(11, 12, 1, 1); c.fillRect(8, 2, 1, 1);
      }));
      const body = PAL.peach;
      S.crate = canvasOf(PX, PX, (c) => paintMap(c, CRATE_MAP, {
        o: rgb(dark(body, 0.55)), l: rgb(lite(body, 0.22)), b: rgb(body), h: rgb(lite(body, 0.38)),
        d: rgb(dark(body, 0.38)), v: rgb(dark(body, 0.16)), s: SHADOW,
      }));
      const bombCols = (m, hi) => ({ o: rgb(dark(m, 0.5)), m: rgb(m), h: rgb(hi), f: rgb(PAL.muted), s: SHADOW });
      S.bomb = canvasOf(PX, PX, (c) => paintMap(c, BOMB_MAP, bombCols(PAL.mine, PAL.mineHi)));
      S.bombHot = canvasOf(PX, PX, (c) => paintMap(c, BOMB_MAP, bombCols(PAL.rose, lite(PAL.rose, 0.5))));
      const iconCols = {
        r: rgb(PAL.rose), s: rgb(PAL.sun), y: rgb(PAL.sunHi),
        o: rgb(dark(PAL.mine, 0.5)), m: rgb(PAL.mine), h: rgb(PAL.mineHi), f: rgb(PAL.muted),
        k: rgb(dark(PAL.sky, 0.45)), w: rgb(PAL.skyHi),
      };
      const shoeCols = { ...iconCols, s: rgb(PAL.sky), h: rgb(PAL.skyHi) };
      const bombIconCols = { ...iconCols, y: rgb(PAL.sun) };
      const colsFor = (t) => (t === SHOE ? shoeCols : t === BOMB ? bombIconCols : iconCols);
      S.icon = {}; S.item = {};
      for (const t of [FIRE, BOMB, SHOE]) {
        S.icon[t] = canvasOf(10, 10, (c) => paintMap(c, ICONS[t], colsFor(t)));
        S.item[t] = canvasOf(PX, PX, (c) => {
          c.fillStyle = SHADOW; c.fillRect(2, 14, 13, 2);
          c.fillStyle = rgb(dark(PAL.lineHi, 0.15)); c.fillRect(1, 1, 14, 14);
          c.fillStyle = rgb(PAL.panel); c.fillRect(2, 2, 12, 12);
          c.fillStyle = rgb(lite(PAL.panel, 0.08)); c.fillRect(2, 2, 12, 1);
          paintMap(c, ICONS[t], colsFor(t), 3, 3);
        });
      }
      S.pl = COLKEYS.map((key) => {
        const b = PAL[key];
        const cols = { o: rgb(dark(b, 0.55)), b: rgb(b), l: rgb(lite(b, 0.45)), d: rgb(dark(b, 0.2)), w: rgb(lite(b, 0.92)), p: rgb(dark(b, 0.82)), f: rgb(dark(b, 0.6)), s: SHADOW };
        return EYES.map((eyes) => FEET.map((feet) => canvasOf(PX, PX, (c) => {
          const rows = PLAYER.map((r, y) => (y === 7 ? eyes[0] : y === 8 ? eyes[1] : y === 13 ? feet : r));
          paintMap(c, rows, cols);
        })));
      });
      spr = S;
      // kleine Bilder fürs HTML (Spielerleiste, Bereit-Bildschirm)
      icons = {};
      for (const t of [FIRE, BOMB, SHOE]) icons[t] = S.icon[t].toDataURL();
      avatars = S.pl.map((dirs) => canvasOf(14, 14, (c) => c.drawImage(dirs[0][0], -1, -1)).toDataURL());
      wrap.style.setProperty("--kb-c0", rgb(PAL.mint)); wrap.style.setProperty("--kb-c1", rgb(PAL.sky));
      wrap.style.setProperty("--kb-c2", rgb(PAL.rose)); wrap.style.setProperty("--kb-c3", rgb(PAL.lilac));
      staticDirty = true; uiKey = "";
    }
    const onTheme = () => buildSprites();
    window.addEventListener("themechange", onTheme);

    // Feld (Boden, Blöcke, Fässer) wird nur neu gemalt, wenn sich etwas ändert
    const stat = document.createElement("canvas");
    stat.width = BW; stat.height = BH;
    function paintStatic() {
      const c = stat.getContext("2d");
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const t = grid[idx(x, y)], X = x * PX, Y = y * PX;
        c.drawImage(spr.floor[(x + y) & 1], X, Y);
        if (t === EMPTY && y > 0 && grid[idx(x, y - 1)] !== EMPTY) { c.fillStyle = SHADOW; c.fillRect(X, Y, PX, 3); }
        if (t === WALL) c.drawImage(spr.wall, X, Y);
        else if (t === CRATE) c.drawImage(spr.crate, X, Y);
      }
      staticDirty = false;
    }

    function burst(x, y, n, col, speed, life) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.3 + 0.7 * Math.random());
        fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: life * (0.6 + 0.4 * Math.random()), max: life, col });
      }
      if (fx.length > 400) fx.splice(0, fx.length - 400);
    }
    function stepFx(dt) {
      for (const p of fx) { p.life -= dt; p.vy += 140 * dt; p.vx *= 0.96; p.x += p.vx * dt; p.y += p.vy * dt; }
      fx = fx.filter((p) => p.life > 0);
      for (const f of feed) f.t -= dt;
      feed = feed.filter((f) => f.t > 0);
      for (const s of seats) {
        if (s.dieT > 0) s.dieT = Math.max(0, s.dieT - dt / 0.8);
        if (s.mov) s.walk += dt;
      }
      shake = Math.max(0, shake - dt * 18);
    }

    function drawFlame(i, now) {
      const x = (i % COLS) * PX, y = ((i / COLS) | 0) * PX, k = flameK[i], t = flameT[i] / FLAME;
      const grow = t > 0.82 ? (1 - t) / 0.18 : Math.min(1, t / 0.45 + 0.25);
      const bands = [[PAL.rose, 7], [PAL.sun, 5], [PAL.sunHi, 2.5]];
      const flick = ((now / 60 + i) | 0) % 2;
      const horiz = k === F_CENTER || k === F_H || k === 4 || k === 5;
      const vert = k === F_CENTER || k === F_V || k === 6 || k === 7;
      for (const [col, half] of bands) {
        const hw = Math.max(1, Math.round(half * grow) - (flick && half < 6 ? 1 : 0));
        g.fillStyle = rgb(col);
        if (horiz) {
          let x0 = x, x1 = x + PX;
          if (k === 4) x0 = x + 8 - hw; else if (k === 5) x1 = x + 8 + hw;
          g.fillRect(x0, y + 8 - hw, x1 - x0, hw * 2);
        }
        if (vert) {
          let y0 = y, y1 = y + PX;
          if (k === 6) y0 = y + 8 - hw; else if (k === 7) y1 = y + 8 + hw;
          g.fillRect(x + 8 - hw, y0, hw * 2, y1 - y0);
        }
      }
    }

    function seatPos(s, k, alpha, now) {
      if (isHost() || k === meIdx()) return [s.px + (s.x - s.px) * alpha, s.py + (s.y - s.py) * alpha];
      if (!snaps.length || !playing()) return [s.x, s.y];
      const rt = now - INTERP_MS;
      for (let j = snaps.length - 1; j > 0; j--) {
        const a = snaps[j - 1], b = snaps[j];
        if (k >= a.x.length || k >= b.x.length) break;
        if (a.t <= rt) {
          const f = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
          return [a.x[k] + (b.x[k] - a.x[k]) * f, a.y[k] + (b.y[k] - a.y[k]) * f];
        }
      }
      const f0 = snaps[0];
      return k < f0.x.length ? [f0.x[k], f0.y[k]] : [s.x, s.y];
    }

    function draw(alpha) {
      if (!spr) { buildSprites(); if (!spr) return; }
      if (staticDirty) paintStatic();
      const now = performance.now();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = false;
      g.fillStyle = rgb(PAL.board); g.fillRect(0, 0, BW, BH);
      const sh = shake > 0.3 ? Math.round((Math.random() - 0.5) * shake) : 0, sv = shake > 0.3 ? Math.round((Math.random() - 0.5) * shake) : 0;
      g.setTransform(1, 0, 0, 1, sh, sv);
      g.drawImage(stat, 0, 0);

      // Extras
      for (let i = 0; i < N; i++) {
        const t = items[i];
        if (!t) continue;
        const bob = Math.round(Math.sin(now / 260 + i) * 0.8);
        g.drawImage(spr.item[t], (i % COLS) * PX, ((i / COLS) | 0) * PX + bob);
      }
      // Bomben: pulsieren schneller, je näher die Explosion
      for (const b of bombs) {
        const hot = b.t < 0.7 && ((now / 70) | 0) % 2 === 0;
        const rate = 3 + (FUSE - b.t) * 3, big = Math.sin(now / 1000 * rate * Math.PI) > 0;
        const sz = big ? 18 : 16, o = (sz - 16) / 2;
        g.drawImage(hot ? spr.bombHot : spr.bomb, b.x * PX - o, b.y * PX - o, sz, sz);
        g.fillStyle = rgb(((now / 90) | 0) % 2 ? PAL.sun : PAL.sunHi);
        g.fillRect(b.x * PX + 10 - o, b.y * PX + 1 - o, 1, 1);
        if (((now / 90) | 0) % 3 === 0) g.fillRect(b.x * PX + 11 - o, b.y * PX - o, 1, 1);
      }
      // Flammen
      for (let i = 0; i < N; i++) if (flameT[i] > 0 && flameK[i]) drawFlame(i, now);

      // Figuren (nach y sortiert, damit untere vorne stehen)
      const me = meSeat();
      const list = seats.map((s, k) => ({ s, k, p: seatPos(s, k, alpha, now) })).filter((o) => !o.s.gone && (o.s.alive || o.s.dieT > 0) && phase !== "ready");
      list.sort((a, b) => a.p[1] - b.p[1]);
      for (const { s, p } of list) {
        const X = Math.round(p[0] * PX), Y = Math.round(p[1] * PX) - 3;
        const frame = s.mov ? ((s.walk * 8) | 0) % 2 : 0;
        const img = spr.pl[s.c % 4][s.dir][frame];
        if (s.alive) {
          g.drawImage(img, X, Y - (s.mov && frame ? 1 : 0));
          if (s === me) {                                      // Pfeil über der eigenen Figur
            const by = Y - 6 + Math.round(Math.sin(now / 180) * 1.2);
            g.fillStyle = rgb(PAL.sun);
            g.fillRect(X + 5, by, 6, 1); g.fillRect(X + 6, by + 1, 4, 1); g.fillRect(X + 7, by + 2, 2, 1);
          }
        } else if (s.dieT > 0 && ((now / 60) | 0) % 2 === 0) {
          g.globalAlpha = s.dieT;
          g.drawImage(img, X, Y - Math.round((1 - s.dieT) * 8));
          g.globalAlpha = 1;
        }
      }
      // Funken & Splitter
      for (const p of fx) {
        g.globalAlpha = clamp(p.life / p.max * 1.4, 0, 1);
        g.fillStyle = rgb(p.col);
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      g.globalAlpha = 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
    }

    // ================== HTML: Spielerleiste & Einblendungen ==================
    let uiKey = "", ovKey = "";
    const name = (s) => esc(s.name);
    function chip(s, k) {
      const me = s === meSeat();
      const out = !s.alive && (playing() || phase === "over");
      const st = phase === "ready" ? "" : `<span class="kb-st"><img src="${icons[FIRE]}" alt="Feuer">${s.range}<img src="${icons[BOMB]}" alt="Bomben">${s.bombs}<img src="${icons[SHOE]}" alt="Schuhe">${s.shoes}</span>`;
      return `<div class="kb-chip${me ? " me" : ""}${out ? " out" : ""}${s.gone ? " gone" : ""}" style="--c:var(--kb-c${k})">
        <img class="kb-ava" src="${avatars[k] || ""}" alt="">
        <span class="kb-name">${name(s)}${s.bot ? " <i>Bot</i>" : ""}${me ? " <i>du</i>" : ""}</span>
        ${phase === "ready" ? "" : `<span class="kb-wins" title="Rundensiege">★ ${s.wins}</span>`}${st}
      </div>`;
    }
    function renderBar() {
      const info = phase === "ready" ? "" : `<span>Runde ${round}</span><span>${target ? `bis ${target} Siege` : "endlos"}</span>`;
      const html = `<div class="kb-chips">${seats.map(chip).join("")}</div>
        <div class="kb-info">${info}<button type="button" data-act="mute" aria-pressed="${mute}">${mute ? "Ton aus" : "Ton an"}</button></div>`;
      if (html !== uiKey) { uiKey = html; bar.innerHTML = html; }
    }
    function readyCard() {
      const host = isHost(), me = meSeat();
      const rows = seats.map((s, k) => {
        const tag = s.bot ? (host ? `<button type="button" class="kb-x" data-act="rmbot" data-i="${k}" title="Bot entfernen">✕</button>` : `<span class="kb-tag ok">Bot</span>`)
          : s.id === ctx.hostId ? `<span class="kb-tag ok">Host</span>`
          : `<span class="kb-tag${s.ready ? " ok" : ""}">${s.ready ? "bereit ✓" : "noch nicht bereit"}</span>`;
        return `<li style="--c:var(--kb-c${k})"><img class="kb-ava" src="${avatars[k] || ""}" alt=""><span class="kb-name">${name(s)}${s === me ? " <i>du</i>" : ""}</span>${tag}</li>`;
      }).join("");
      const seg = TARGETS.map((v) => `<button type="button" data-act="tgt" data-v="${v}" class="${v === target ? "on" : ""}"${host ? "" : " disabled"}>${v ? v + " Siege" : "Endlos"}</button>`).join("");
      let foot;
      if (host) {
        const why = seats.length < 2 ? "Mindestens 2 Spieler – füge einen Bot hinzu." : !canStart() ? "Warte, bis alle bereit sind." : "";
        foot = `<div class="kb-row">${seats.length < 4 ? `<button type="button" data-act="addbot">+ Bot</button>` : ""}<button type="button" class="primary" data-act="start"${why ? " disabled" : ""}>Runde starten</button></div>${why ? `<p class="kb-note">${why}</p>` : ""}`;
      } else {
        foot = `<div class="kb-row"><button type="button" class="${me && me.ready ? "" : "primary"}" data-act="ready">${me && me.ready ? "Doch nicht bereit" : "Bereit!"}</button></div><p class="kb-note">Der Host startet die Runde.</p>`;
      }
      return `<div class="kb-card"><h3 class="kb-title">KABOOM</h3><p class="kb-sub">Yes Rico, KABOOM</p>
        <ul class="kb-list">${rows}</ul>
        <div class="kb-row kb-seg"><span class="kb-note">Match:</span>${seg}</div>
        ${foot}
        <p class="kb-note">Pfeiltasten / WASD laufen · Leertaste Bombe · M Ton</p></div>`;
    }
    function standings() {
      return `<ul class="kb-list">${seats.filter((s) => !s.gone).map((s) => ({ s, k: seats.indexOf(s) })).sort((a, b) => b.s.wins - a.s.wins)
        .map(({ s, k }) => `<li style="--c:var(--kb-c${k})"><img class="kb-ava" src="${avatars[k] || ""}" alt=""><span class="kb-name">${name(s)}</span><span class="kb-tag ok">★ ${s.wins}</span></li>`).join("")}</ul>`;
    }
    function renderOverlay() {
      let html = "";
      const me = meSeat();
      if (!isHost() && !gotState) html = `<div class="kb-card"><p class="kb-note">Verbinde mit dem Host …</p></div>`;
      else if (phase === "ready") html = readyCard();
      else if (phase === "count") {
        const n = Math.max(1, Math.ceil(pl));
        if (n !== lastBeep) { lastBeep = n; sfx.beep(false); }
        html = `<div class="kb-big">${n}</div>`;
      } else if (phase === "over") {
        const w = seats[roundWinner];
        html = `<div class="kb-card"><h3 class="kb-title kb-small" style="--c:var(--kb-c${roundWinner})">${w ? (w === me ? "Du gewinnst die Runde!" : `${name(w)} gewinnt die Runde!`) : "Unentschieden!"}</h3>
          ${standings()}<p class="kb-note">Nächste Runde in ${Math.ceil(pl)} …</p></div>`;
      } else if (phase === "match") {
        const w = seats[matchWinner];
        const btns = isHost() ? `<div class="kb-row"><button type="button" class="primary" data-act="again">Nochmal</button><button type="button" data-act="toready">Bereit-Bildschirm</button></div>` : `<p class="kb-note">Warte auf den Host …</p>`;
        html = `<div class="kb-card"><h3 class="kb-title">${w ? (w === me ? "Du gewinnst das Match!" : `${name(w)} gewinnt das Match!`) : "Match vorbei"}</h3><p class="kb-sub">KABOOM!</p>${standings()}${btns}</div>`;
      } else if (playing()) {
        const msg = me && !me.alive && !me.gone ? "Du bist raus – schau zu, wer gewinnt." : "";
        const fd = feed.map((f) => `<div class="kb-feed" style="--c:var(--kb-c${f.c})">${esc(f.txt)}</div>`).join("");
        const los = phase === "run" && performance.now() - runStart < 700 ? `<div class="kb-big">LOS!</div>` : "";
        html = `<div class="kb-feeds">${fd}</div>${los}${msg ? `<div class="kb-banner">${msg}</div>` : ""}`;
      }
      if (html !== ovKey) { ovKey = html; ov.innerHTML = html; }
    }
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || !root.contains(b)) return;
      sfx.unlock();
      const act = b.dataset.act;
      if (act === "mute") toggleMute();
      else if (act === "ready") { const me = meSeat(); if (me) ctx.send("rdy", { r: !me.ready }, ctx.hostId); }
      else if (!isHost()) return;
      else if (act === "addbot") addBot();
      else if (act === "rmbot") removeBot(+b.dataset.i);
      else if (act === "tgt" && phase === "ready") { const v = +b.dataset.v; if (TARGETS.includes(v)) { target = v; sendState(); } }
      else if (act === "start" && phase === "ready" && canStart()) newMatch();
      else if (act === "again" && phase === "match") newMatch();
      else if (act === "toready" && phase === "match") toReady();
    });

    // ================== Hauptschleife ==================
    // Simulation und Zeichnen sind getrennt: die Simulation läuft auch über einen Timer weiter, damit ein
    // Host im Hintergrund-Tab (dort pausiert requestAnimationFrame) das Spiel nicht für alle anhält.
    let raf = 0, last = performance.now(), acc = 0, dead = false;
    function simulate() {
      const now = performance.now();
      const dt = Math.min(1.5, (now - last) / 1000);
      last = now; acc += dt;
      const host = isHost();
      if (host && !wasHost) {                               // Start oder Host-Wechsel: Simulation übernehmen
        seats.forEach((s) => { if (s !== meSeat()) { s.in = -1; s.want = 0; } s.ai = null; s.px = s.x; s.py = s.y; });
        if (started) sendState();
      }
      wasHost = host;
      let steps = 0;
      while (acc >= TICK && steps < 45) {
        acc -= TICK; steps++;
        if (host) { if (started) hostStep(TICK); } else guestStep(TICK);
        stepFx(TICK);
      }
      if (steps >= 45) acc = 0;
    }
    let lastFrame = 0;
    function frame() {
      if (dead) return;
      lastFrame = performance.now();
      try {
        simulate();
        draw(clamp(acc / TICK, 0, 1));
        renderBar(); renderOverlay();
      } catch (e) { console.error(e); }
      raf = requestAnimationFrame(frame);
    }
    const timer = setInterval(() => {
      if (dead) return;
      try { simulate(); if (performance.now() - lastFrame > 200) { renderBar(); renderOverlay(); } } catch (e) { console.error(e); }
    }, 1000 / 60);
    buildSprites();
    raf = requestAnimationFrame(frame);
    let hello = 0;
    return {
      go() {
        started = true;
        if (isHost()) sendState();
        else {
          const ask = () => { if (!gotState) ctx.send("hello", null, ctx.hostId); };
          ask();
          hello = setInterval(() => { if (gotState) { clearInterval(hello); hello = 0; } else ask(); }, 1200);
        }
      },
      destroy() {
        dead = true; cancelAnimationFrame(raf); clearInterval(hello); clearInterval(timer);
        window.removeEventListener("keydown", trackDown, true); window.removeEventListener("keyup", trackUp, true);
        window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur); window.removeEventListener("themechange", onTheme);
        try { if (actx) actx.close(); } catch (e) { /* egal */ }
      },
    };
  },
};
