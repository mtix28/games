// Kart-Rennen — Spiel-Engine für Solo (Zeitfahren) und Mehrspieler (Rennen mit Items).
//
//   createKart({ root, net, players, me, solo, topInset }) → { go(), destroy(), menu() }
//
// Mehrspieler: Jeder Client rechnet sein eigenes Kart (Fahrphysik, Items, Runden) und schickt ~20× pro Sekunde
// seine Lage ("k"). Die anderen Karts werden weich nachgeführt. Bananen / Panzer / Item-Boxen sind kleine
// Nachrichten; ob ein Treffer zählt, entscheidet immer der Client, der getroffen wird. Der Host wählt Strecke und
// Rundenzahl ("sel") und startet ("begin"); jeder zählt dann lokal herunter. Die Zielzeit schickt jeder selbst ("fin").
// Ohne `net` (Solo-Seite) läuft dasselbe Rennen allein gegen die Uhr, ohne Gegner.

import { TRACKS, THEMES, buildTrack, locate, pointAt, gridSlot, hashStr, rng, HALF } from "./track.js";
import { loadThree, createWorld } from "./world.js";
import { newKart, step, hit, boost, respawn, DT, KMH, MAXV } from "./physics.js";
import { CSS, TEMPLATE, ICONS, ITEM_NAME, esc, fmtTime, KART_COLORS, makeMinimap, trackSvg } from "./ui.js";

const COUNTDOWN = 3.4;           // Sekunden bis GO
const SEND_EVERY = 3;            // Physikschritte zwischen zwei Lage-Nachrichten
const ROLL_TIME = 1.3;           // Item-Auslosung
const BOX_RESPAWN = 5;
const FINISH_GRACE = 22;         // Sekunden, die die anderen nach dem ersten Ziel noch Zeit haben
const LAPS = [1, 3, 5];
const THEME_KEYS = ["wiese", "wueste", "schnee", "nacht"];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export function trackSpec(sel) {
  if (sel.track < TRACKS.length) return TRACKS[sel.track];
  const seed = (sel.rseed >>> 0) || 777;
  return { id: "zufall", name: "Zufallsstrecke", theme: THEME_KEYS[seed % 4], seed, blurb: "Jedes Mal anders" };
}

// ---------- Ton (WebAudio, klein) ----------
function makeSfx() {
  let ac = null, eng = null, mute = !!store.get("kart_mute", false);
  const ensure = () => {
    if (ac) return ac;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
      o.type = "sawtooth"; o2.type = "square"; f.type = "lowpass"; f.frequency.value = 700; g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination); o.start(); o2.start();
      eng = { o, o2, f, g };
    } catch { ac = null; }
    return ac;
  };
  const tone = (freq, dur, type = "square", vol = 0.08, slide = 0) => {
    if (mute || !ensure()) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  const noise = (dur, vol = 0.1, freq = 900) => {
    if (mute || !ensure()) return;
    const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = buf; f.type = "bandpass"; f.frequency.value = freq; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
  };
  return {
    unlock() { ensure(); if (ac && ac.state === "suspended") ac.resume(); },
    get mute() { return mute; },
    toggle() { mute = !mute; store.set("kart_mute", mute); if (eng) eng.g.gain.value = 0; return mute; },
    engine(frac, gas, on) {
      if (!eng || !ac) return;
      const t = ac.currentTime, f = 48 + frac * 150;
      eng.o.frequency.setTargetAtTime(f, t, 0.05); eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      eng.f.frequency.setTargetAtTime(500 + frac * 900 + gas * 300, t, 0.08);
      eng.g.gain.setTargetAtTime(mute || !on ? 0 : 0.016 + 0.03 * frac + 0.012 * gas, t, 0.08);
    },
    beep(go) { tone(go ? 880 : 440, go ? 0.55 : 0.18, "square", 0.09); },
    box() { tone(520, 0.08, "triangle", 0.1); setTimeout(() => tone(780, 0.1, "triangle", 0.1), 70); },
    item() { tone(660, 0.07, "square", 0.07); setTimeout(() => tone(990, 0.12, "square", 0.07), 80); },
    boost() { noise(0.5, 0.12, 1800); tone(200, 0.4, "sawtooth", 0.07, 500); },
    mini() { tone(300, 0.3, "sawtooth", 0.07, 700); noise(0.3, 0.08, 2500); },
    drift() { tone(1200, 0.05, "square", 0.03); },
    bump() { noise(0.14, 0.14, 300); },
    hit() { noise(0.5, 0.18, 500); tone(300, 0.5, "sawtooth", 0.08, -220); },
    lap() { tone(700, 0.1, "triangle", 0.09); setTimeout(() => tone(1050, 0.18, "triangle", 0.09), 100); },
    fin() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, "triangle", 0.1), i * 110)); },
    close() { try { eng && eng.o.stop(); eng && eng.o2.stop(); ac && ac.close(); } catch {} ac = null; eng = null; },
  };
}

// ---------- Gamepad ----------
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p || !p.connected) continue;
    const ax = p.axes[0] || 0;
    const b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
    return { steer: Math.abs(ax) > 0.12 ? ax : 0, gas: Math.max(b(7), b(0)), brake: Math.max(b(6), b(1)), drift: Math.max(b(5), b(2)) > 0.4, item: b(3) > 0.5 || b(4) > 0.5 };
  }
  return null;
}

export async function createKart(env) {
  const T = await loadThree();
  const net = env.net || null;
  const solo = !net || !!env.solo;
  const players = (env.players && env.players.length ? env.players : [{ id: "me", name: "Du" }]).slice(0, 6);
  const meId = env.me ? env.me.id : players[0].id;
  const myIdx = Math.max(0, players.findIndex((p) => p.id === meId));
  const colorOf = (i) => KART_COLORS[i % KART_COLORS.length];
  const isHost = () => (net ? !!net.isHost : true);

  // Shadow DOM: die Design-Themes der Seite stylen sonst jeden <button> und jede Schrift mit
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style"); st.textContent = CSS + ":host{display:block}"; sr.appendChild(st);
  const el = document.createElement("div");
  el.className = "kt";
  el.innerHTML = TEMPLATE;
  sr.appendChild(el);
  env.root.appendChild(host);
  el.style.setProperty("--kt-top", (env.topInset || 0) + "px");
  const $ = (s) => el.querySelector(s);
  const view = $(".kt-view"), hud = $(".kt-hud"), menuEl = $(".kt-menu"), resEl = $(".kt-result"), center = $(".kt-center"), touchEl = $(".kt-touch");
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  if (isTouch) { el.classList.add("touch"); touchEl.hidden = false; }
  const sfx = makeSfx();
  const offs = [];                          // Aufräumen
  const on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); offs.push(() => target.removeEventListener(ev, fn, opt)); };

  // ---------- Zustand ----------
  let sel = { track: 0, laps: 3, rseed: (Math.random() * 1e9) >>> 0 };
  let spec = trackSpec(sel), track = null, world = null, mini = null;
  let phase = "menu";                       // menu | countdown | race | done
  let raceT = 0, cd = 0, rid = "";
  let me = null, models = [], rem = new Map();
  let meModel = null;
  let camYaw = 0, camFov = 66, shake = 0;
  let item = null, itemCount = 0, rolling = 0;
  let laps = 3, lapsDone = 0, lapStart = 0, bestLap = Infinity, finished = false, finT = 0, firstFinAt = 0, wrongT = 0, gasEarly = -1, resultShown = false, sendN = 0;
  let items = new Map(), itemSeq = 0, bananas = [];
  let msgTimer = 0, destroyed = false, raf = 0, last = 0, acc = 0, time = 0, resultsAt = 0, soloRecordNew = false;
  const results = new Map();                // Spieler-ID → Zeit (Infinity = nicht angekommen)
  let hudCache = {};
  let rescue = null, lkOut = null, lkMe = null, lkRem = new Map();

  // ---------- Welt ----------
  function loadWorld() {
    spec = trackSpec(sel);
    const key = spec.id + ":" + spec.seed;
    if (world && world.key === key) return;
    if (world) { world.dispose(); world = null; }
    track = buildTrack(spec.seed);
    world = createWorld(T, view, track, spec.theme);
    world.key = key;
    mini = makeMinimap($(".kt-map"), track);
    models = players.map((p, i) => world.makeKart(colorOf(i), p.name || "Spieler", { local: i === myIdx }));
    models.forEach((m) => world.scene.add(m.root));
    meModel = models[myIdx];
    lkMe = world.makeLakitu(); lkRem = new Map(); players.forEach((p, i) => { if (i !== myIdx) lkRem.set(p.id, world.makeLakitu()); }); rescue = null; lkOut = null;
    rem = new Map();
    players.forEach((p, i) => { if (i !== myIdx) rem.set(p.id, mkRemote(p, i)); });
    parkOnGrid();
  }
  const mkRemote = (p, i) => ({ id: p.id, idx: i, name: p.name, color: colorOf(i), x: 0, z: 0, yaw: 0, vx: 0, vz: 0, tx: 0, tz: 0, ty: 0, tvx: 0, tvz: 0, tAt: 0, prog: -10, flags: 0, steer: 0, wheel: 0, hop: 0, hopV: 0, spinT: 0, spinDir: 1, finT: Infinity, left: false, seen: false });

  function parkOnGrid() {
    // alle Karts stehen auf ihrem Startplatz (Menü + Countdown)
    players.forEach((p, i) => {
      const g = gridSlot(track, i);
      if (i === myIdx) {
        me = newKart(g.x, g.z, g.yaw);
        initProg(me);
      } else {
        const r = rem.get(p.id);
        Object.assign(r, { x: g.x, z: g.z, yaw: g.yaw, tx: g.x, tz: g.z, ty: g.yaw, vx: 0, vz: 0, tvx: 0, tvz: 0, flags: 0, prog: -(7 + Math.floor(i / 2) * 6.5), finT: Infinity, seen: false, spinT: 0, hop: 0 });
      }
    });
    camYaw = me.yaw;
  }
  function initProg(k) {
    const loc = locate(track, k.x, k.z, -1, {});
    k.idx = loc.i; k.lastS = loc.s; k.s = loc.s; k.prog = loc.s > track.L / 2 ? loc.s - track.L : loc.s;
  }

  // ---------- Eingabe ----------
  const keys = new Set();
  const tch = { steer: 0, gas: false, brake: false, drift: false, auto: store.get("kart_auto", true) };
  let itemPress = false;
  const KEYMAP = { ArrowUp: "gas", KeyW: "gas", ArrowDown: "brake", KeyS: "brake", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Space: "drift", ShiftLeft: "drift", ShiftRight: "drift" };
  const ITEMKEYS = new Set(["KeyE", "Enter", "ControlLeft", "ControlRight", "KeyX"]);
  on(window, "keydown", (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!el.isConnected) return;
    const k = KEYMAP[e.code];
    if (k) { keys.add(k); if (phase !== "menu" || document.body.contains(el)) e.preventDefault(); sfx.unlock(); if (k === "gas" && phase === "countdown" && gasEarly < 0) gasEarly = cd; }
    else if (ITEMKEYS.has(e.code)) { if (phase === "race") { itemPress = true; e.preventDefault(); } }
    else if (e.code === "KeyR") { if (phase === "race") doReset(); }
    else if (e.code === "KeyM") toggleSound();
    else if (e.code === "KeyF") toggleFull();
  });
  on(window, "keyup", (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); if (k === "gas") gasEarly = phase === "countdown" ? -1 : gasEarly; });
  on(window, "blur", () => keys.clear());

  // Touch: links ziehen = lenken (relativ zum Fingerdruck), rechts Tasten
  const pad = $(".kt-pad");
  let padId = null, padX = 0;
  const knob = pad.querySelector(".knob"), ring = pad.querySelector(".ring");
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault(); sfx.unlock(); padId = e.pointerId; padX = e.clientX; pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect();
    ring.style.left = knob.style.left = e.clientX - r.left + "px"; ring.style.top = knob.style.top = e.clientY - r.top + "px"; pad.classList.add("on");
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId !== padId) return;
    const dx = e.clientX - padX, v = clamp(dx / 55, -1, 1);
    tch.steer = Math.abs(v) < 0.08 ? 0 : v;
    const r = pad.getBoundingClientRect();
    knob.style.left = parseFloat(ring.style.left) + clamp(dx, -55, 55) + "px";
  });
  const padEnd = (e) => { if (e.pointerId !== padId) return; padId = null; tch.steer = 0; pad.classList.remove("on"); };
  pad.addEventListener("pointerup", padEnd); pad.addEventListener("pointercancel", padEnd);
  el.querySelectorAll(".kt-b").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault(); sfx.unlock(); b.setPointerCapture(e.pointerId); b.classList.add("on");
      if (k === "item") itemPress = true; else { tch[k] = true; if (k === "gas" && phase === "countdown" && gasEarly < 0) gasEarly = cd; }
    });
    const up = () => { b.classList.remove("on"); if (k !== "item") tch[k] = false; };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  });
  const autoBtn = $(".kt-chip");
  const paintAuto = () => { autoBtn.textContent = "Auto-Gas: " + (tch.auto ? "an" : "aus"); el.classList.toggle("autogas", tch.auto); };
  autoBtn.addEventListener("click", () => { tch.auto = !tch.auto; store.set("kart_auto", tch.auto); paintAuto(); });
  paintAuto();
  on(el, "contextmenu", (e) => e.preventDefault());

  function readInput() {
    const pd = readPad();
    const steer = clamp((keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0) + tch.steer + (pd ? pd.steer : 0), -1, 1);
    const gas = Math.max(keys.has("gas") ? 1 : 0, isTouch && tch.auto ? 1 : tch.gas ? 1 : 0, pd ? pd.gas : 0);
    const brake = Math.max(keys.has("brake") ? 1 : 0, tch.brake ? 1 : 0, pd ? pd.brake : 0);
    const drift = keys.has("drift") || tch.drift || !!(pd && pd.drift);
    if (pd && pd.item && !pd._i) itemPress = true;
    return { steer, gas: brake > 0.5 ? 0 : gas, brake, drift };
  }

  // ---------- Hilfen: Meldungen, Vollbild, Ton ----------
  const msgEl = $(".kt-msg");
  function say(text, cls = "", ms = 1400) {
    msgEl.textContent = text; msgEl.className = "kt-msg on " + cls;
    clearTimeout(msgTimer); if (ms) msgTimer = setTimeout(() => msgEl.classList.remove("on"), ms);
  }
  function paintSound() { const m = sfx.mute, b = $('[data-a="sound"]'); b.textContent = m ? "✕" : "♪"; b.title = m ? "Ton ist aus (M)" : "Ton (M)"; }
  function toggleSound() { sfx.toggle(); paintSound(); }
  function setFull(v) {
    el.classList.toggle("kt-full", v);
    host.style.cssText = v ? "position:fixed;inset:0;z-index:99999;" : "position:absolute;inset:0;";
    el.style.setProperty("--kt-top", (v ? 0 : env.topInset || 0) + "px");
    if (env.onFull) env.onFull(v);
    try { if (v && el.requestFullscreen && !isTouch) el.requestFullscreen().catch(() => {}); else if (!v && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
    setTimeout(() => world && world.size(), 60);
  }
  const toggleFull = () => setFull(!el.classList.contains("kt-full"));
  on(document, "fullscreenchange", () => { if (!document.fullscreenElement && el.classList.contains("kt-full") && !isTouch) { el.classList.remove("kt-full"); host.style.cssText = "position:absolute;inset:0;"; el.style.setProperty("--kt-top", (env.topInset || 0) + "px"); if (env.onFull) env.onFull(false); world && world.size(); } });
  el.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", (e) => {
    const a = b.dataset.a;
    if (a === "sound") toggleSound(); else if (a === "full") toggleFull(); else if (a === "reset") { if (phase === "race") doReset(); }
  }));
  paintSound();
  const ro = new ResizeObserver(() => world && world.size());
  ro.observe(el);

  // ---------- Menü ----------
  const bestKey = (id, l) => "kart_best_" + id + "_" + l;
  function renderMenu() {
    if (phase !== "menu") return;
    const host = isHost(), can = host;
    const rows = players.map((p, i) => `<span><i style="background:${colorOf(i)}"></i>${esc(p.name || "Spieler")}${i === myIdx ? " (du)" : ""}</span>`).join("");
    const cards = [...TRACKS, { id: "zufall", name: "Zufallsstrecke", theme: "?", seed: sel.rseed, blurb: "Jedes Mal anders" }].map((tr, i) => {
      const sp = i < TRACKS.length ? tr : trackSpec({ track: i, rseed: sel.rseed });
      const bt = store.get(bestKey(sp.id === "zufall" ? "zufall" + sp.seed : sp.id, sel.laps), 0);
      const svg = trackSvg(buildTrackCached(sp.seed), "#" + (THEMES[sp.theme] || THEMES.wiese).curbA.toString(16).padStart(6, "0"));
      return `<button class="kt-tr${sel.track === i ? " sel" : ""}" data-t="${i}" ${can ? "" : "disabled"}>${svg}<b>${esc(sp.name)}</b><small>${esc(tr.blurb)}</small>${bt ? `<span class="rec">★ ${fmtTime(bt)}</span>` : ""}</button>`;
    }).join("");
    menuEl.innerHTML = `<div class="kt-card">
      <h2><em>Kart</em>-Rennen</h2>
      <p class="sub">${solo ? "Zeitfahren: allein auf der Strecke – gejagt wird nur die Bestzeit." : "Rennen mit Items – der Host wählt die Strecke."}</p>
      <div class="kt-sec">Strecke</div><div class="kt-tracks">${cards}</div>
      <div class="kt-row2"><div><div class="kt-sec">Runden</div><div class="kt-seg">${LAPS.map((l) => `<button data-l="${l}" class="${sel.laps === l ? "sel" : ""}" ${can ? "" : "disabled"}>${l}</button>`).join("")}</div></div>
      ${solo ? "" : `<div style="flex:1 1 220px"><div class="kt-sec">Fahrer</div><div class="kt-plist">${rows}</div></div>`}</div>
      <button class="kt-go" data-go ${can ? "" : "disabled"}>${can ? (solo ? "Los geht’s!" : "Rennen starten") : "Der Host startet das Rennen …"}</button>
      <div class="kt-help">${isTouch
        ? `<span>Links ziehen: <b>lenken</b></span><span><b>DRIFT</b> halten + lenken, loslassen = Turbo</span><span><b>ITEM</b> einsetzen</span><span>⛶ Vollbild</span>`
        : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / Pfeile fahren</span><span><kbd>Leertaste</kbd> driften (loslassen = Turbo)</span><span><kbd>E</kbd> Item</span><span><kbd>R</kbd> zurück auf die Strecke</span><span><kbd>F</kbd> Vollbild · <kbd>M</kbd> Ton</span>`}</div>
    </div>`;
    menuEl.hidden = false;
  }
  const trackCache = new Map();
  function buildTrackCached(seed) { let t = trackCache.get(seed); if (!t) { t = buildTrack(seed); trackCache.set(seed, t); if (trackCache.size > 12) trackCache.delete(trackCache.keys().next().value); } return t; }

  menuEl.addEventListener("click", (e) => {
    sfx.unlock();
    const t = e.target.closest("[data-t]"), l = e.target.closest("[data-l]"), g = e.target.closest("[data-go]");
    if (!isHost() && (t || l || g)) return;
    if (t) {
      const i = +t.dataset.t;
      if (i >= TRACKS.length && sel.track === i) sel.rseed = (Math.random() * 1e9) >>> 0;
      else if (i >= TRACKS.length) sel.rseed = (Math.random() * 1e9) >>> 0;
      sel.track = i; pushSel(); loadWorld(); renderMenu();
    } else if (l) { sel.laps = +l.dataset.l; pushSel(); renderMenu(); }
    else if (g) startRace();
  });
  const pushSel = () => net && isHost() && net.send("sel", { t: sel.track, l: sel.laps, r: sel.rseed });

  function showMenu() {
    phase = "menu"; resultShown = false; resEl.hidden = true; hud.hidden = true; center.hidden = true; items.clear(); world && world.clearItems();
    sfx.engine(0, 0, false);
    loadWorld(); parkOnGrid(); renderMenu();
  }

  // ---------- Rennen starten ----------
  function startRace() {
    if (!isHost()) return;
    rid = Math.random().toString(36).slice(2, 8);
    const msg = { t: sel.track, l: sel.laps, r: sel.rseed, id: rid };
    if (net) { net.send("begin", msg); setTimeout(() => beginRace(msg), 140); } else beginRace(msg);
  }
  function beginRace(m) {
    if (destroyed) return;
    sel = { track: clamp(m.t | 0, 0, TRACKS.length), laps: LAPS.includes(m.l) ? m.l : 3, rseed: m.r >>> 0 };
    rid = m.id;
    loadWorld();
    parkOnGrid();
    world.clearItems(); items.clear(); bananas = [];
    for (const b of world.boxes) { b.active = true; b.pop = 1; b.back = 0; }
    laps = sel.laps; lapsDone = 0; lapStart = 0; bestLap = Infinity; finished = false; finT = 0; firstFinAt = 0; wrongT = 0; resultShown = false; soloRecordNew = false;
    item = null; itemCount = 0; rolling = 0; itemPress = false; gasEarly = -1; time = 0;
    rescue = null; lkOut = null; lkMe && lkMe.hide();
    results.clear(); raceT = 0; cd = COUNTDOWN; phase = "countdown";
    menuEl.hidden = true; resEl.hidden = true; hud.hidden = false; center.hidden = false; hudCache = {};
    if (isTouch) setFull(true);
    $(".kt-best").textContent = solo ? "Bestzeit " + (store.get(bestKey(spec.id === "zufall" ? "zufall" + spec.seed : spec.id, laps), 0) ? fmtTime(store.get(bestKey(spec.id === "zufall" ? "zufall" + spec.seed : spec.id, laps), 0)) : "—") : spec.name;
    $(".kt-board").style.display = solo ? "none" : "";
    msgEl.classList.remove("on");
    sfx.unlock();
    cdShown = 4;
  }
  let cdShown = 4;
  function countdownTick() {
    const n = Math.ceil(cd - 0.4);           // 3,2,1 bis zum GO bei cd = 0.4 … dann 0
    if (cd > 0.4) {
      if (n !== cdShown && n >= 1 && n <= 3) {
        cdShown = n; sfx.beep(false);
        center.innerHTML = `<div class="kt-lights">${[3, 2, 1].map((k) => `<i class="${k >= n ? "r" : ""}"></i>`).join("")}</div><div class="kt-count" style="animation-duration:1s">${n}</div>`;
      }
    }
  }
  function goRace() {
    phase = "race"; raceT = 0; lapStart = 0; sfx.beep(true);
    center.innerHTML = `<div class="kt-lights"><i class="g"></i><i class="g"></i><i class="g"></i></div><div class="kt-count go">LOS!</div>`;
    setTimeout(() => { if (phase === "race") center.innerHTML = ""; }, 900);
    // Raketenstart: Gas kurz vor „Los“
    if (gasEarly >= 0 && gasEarly < 0.75) { boost(me, 0.9); say("Raketenstart!", "gold", 1000); }
  }

  // ---------- Items ----------
  function rank() {
    // 0 = vorne; zählt Karts, die weiter / früher im Ziel sind
    const myScore = finished ? 1e9 - finT : me.prog;
    let r = 0;
    for (const k of rem.values()) { if (k.left) continue; const s = k.finT < Infinity ? 1e9 - k.finT : k.prog; if (s > myScore) r++; }
    return r;
  }
  const racers = () => 1 + [...rem.values()].filter((k) => !k.left).length;
  function drawItem() {
    const r = racers() > 1 ? rank() / (racers() - 1) : 0;
    const pool = solo ? [["mush", 60], ["mush3", 30], ["star", 10]]
      : [["mush", 30], ["mush3", 8 + 24 * r], ["banana", 30 - 18 * r], ["shell", 6 + 26 * r], ["star", 2 + 22 * r * r]];
    const tot = pool.reduce((a, p) => a + p[1], 0);
    let x = Math.random() * tot;
    for (const [k, w] of pool) { x -= w; if (x <= 0) return k; }
    return "mush";
  }
  function pickBox(b) {
    world.takeBox(b.id, BOX_RESPAWN);
    net && net.send("box", [b.id]);
    burst(b.x, 1.5, b.z, 0xffffff, 14, 6);
    sfx.box();
    if (!item && !rolling) { rolling = ROLL_TIME; }
  }
  function useItem() {
    if (!item) return;
    const kind = item;
    store.set("kart_item_uses", store.get("kart_item_uses", 0) + 1); paintKeyHint();
    if (kind === "mush" || kind === "mush3") { boost(me, 1.5); itemCount--; if (kind === "mush3" && itemCount > 0) { /* bleibt */ } else item = null; }
    else if (kind === "star") { me.starT = 7; me.events.push("boost"); item = null; }
    else if (kind === "banana") {
      const x = me.x - Math.sin(me.yaw) * 2.8, z = me.z - Math.cos(me.yaw) * 2.8;
      const id = myIdx + "-" + itemSeq++;
      addBanana(id, x, z, meId);
      net && net.send("ban", [id, +x.toFixed(2), +z.toFixed(2)]);
      item = null;
    } else if (kind === "shell") {
      const id = myIdx + "-" + itemSeq++;
      const myScore = me.prog;
      let tgt = null, bd = Infinity;
      for (const k of rem.values()) { if (k.left) continue; const d = k.prog - myScore; if (d > 0 && d < bd && k.finT === Infinity) { bd = d; tgt = k; } }
      const lat = me.d;
      const sh = { id, kind: "shell", sp: me.prog + 5, lat, tgt: tgt ? tgt.id : 0, owner: meId, age: 0 };
      addShell(sh);
      net && net.send("shl", { id, o: meId, p: +sh.sp.toFixed(1), l: +lat.toFixed(2), t: sh.tgt });
      item = null;
    }
    if (item === null) itemCount = 0;
    sfx.item();
  }
  function addBanana(id, x, z, owner) {
    items.set(id, { id, kind: "banana", x, z, owner, age: 0 });
    world.addItem(id, "banana", x, z);
    bananas.push(id);
    while (bananas.length > 16) { const o = bananas.shift(); items.delete(o); world.removeItem(o); }
  }
  function addShell(sh) { items.set(sh.id, sh); world.addItem(sh.id, "shell", 0, 0); }
  function removeItem(id, fx) {
    const it = items.get(id);
    if (it && fx) burst(it.x, 1, it.z, it.kind === "shell" ? 0xff7a3a : 0xffe45e, 16, 8);
    items.delete(id); world && world.removeItem(id);
  }

  function updateItems(dt) {
    for (const it of [...items.values()]) {
      it.age += dt;
      if (it.kind === "shell") {
        it.sp += 54 * dt;
        let lat = it.lat;
        const tg = it.tgt && (it.tgt === meId ? { prog: me.prog, x: me.x, z: me.z } : rem.get(it.tgt));
        if (tg) {
          let diff = (tg.prog - it.sp) % track.L; if (diff > track.L / 2) diff -= track.L; if (diff < -track.L / 2) diff += track.L;
          if (diff > -4 && diff < 90) {
            const loc = locate(track, tg.x, tg.z, -1, {});
            it.lat += clamp(loc.d - it.lat, -16 * dt, 16 * dt);
          }
        }
        const p = pointAt(track, it.sp, clamp(it.lat, -HALF + 1, HALF - 1));
        it.x = p.x; it.z = p.z;
        const o = world.dyn.get(it.id); if (o) { o.mesh.position.set(p.x, 0.9, p.z); o.mesh.rotation.y += dt * 8; }
        if (it.age > 7.5) removeItem(it.id, true);
      }
    }
    // Treffer prüft nur der Getroffene
    if (phase !== "race" && phase !== "done") return;
    for (const it of [...items.values()]) {
      if (it.owner === meId && it.age < 0.7) continue;
      const dx = it.x - me.x, dz = it.z - me.z;
      if (dx * dx + dz * dz < (it.kind === "shell" ? 2.4 : 1.9) ** 2) {
        const got = hit(me, it.kind);
        if (got || me.starT > 0) {
          net && net.send("hit", [it.id]);
          removeItem(it.id, true);
          if (got) { shake = 1; sfx.hit(); say(it.kind === "banana" ? "Ausgerutscht!" : "Getroffen!", "bad", 900); }
        } else if (me.spinT > 0 || me.inv > 0) { /* schon am Drehen: Item bleibt */ }
      }
    }
  }

  // ---------- Partikel ----------
  const burst = (x, y, z, hex, n, sp) => { if (!world) return; for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (0.4 + Math.random()); world.particles.emit(x, y, z, Math.cos(a) * v, 2 + Math.random() * sp * 0.6, Math.sin(a) * v, 0.5 + Math.random() * 0.4, hex, -14); } };
  const LVLCOL = [0xdddddd, 0x4db8ff, 0xff9a2b, 0xff4de0];
  function kartFx(k, dt, flags) {
    // k: { x, z, yaw, vx, vz, drift, driftLvl, boost, offroad }
    const sin = Math.sin(k.yaw), cos = Math.cos(k.yaw), rx = -cos, rz = sin, P = world.particles;
    const sp = Math.hypot(k.vx, k.vz);
    if (k.drift && sp > 6) for (const s of [-1, 1]) {
      if (Math.random() < 0.7) P.emit(k.x - sin * 1.2 + rx * s * 1.0, 0.25, k.z - cos * 1.2 + rz * s * 1.0, rx * s * (2 + Math.random() * 3) - sin * 2, 1.5 + Math.random() * 2.5, rz * s * (2 + Math.random() * 3) - cos * 2, 0.28 + Math.random() * 0.2, LVLCOL[k.driftLvl || 0], -12);
    }
    if (k.boost) for (const s of [-0.45, 0.45]) P.emit(k.x - sin * 2.3 + rx * s, 0.65, k.z - cos * 2.3 + rz * s, -sin * 7 + (Math.random() - 0.5), (Math.random() - 0.3), -cos * 7 + (Math.random() - 0.5), 0.3, Math.random() < 0.5 ? 0xff9d1a : 0xffe45e, 0);
    if (k.offroad && sp > 6 && Math.random() < 0.8) P.emit(k.x - sin * 1.2 + (Math.random() - 0.5) * 1.8, 0.2, k.z - cos * 1.2 + (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 2, 1.4 + Math.random(), (Math.random() - 0.5) * 2, 0.55, spec.theme === "schnee" ? 0xdfeaff : spec.theme === "wueste" ? 0xcfa862 : spec.theme === "nacht" ? 0x3b4a7a : 0x6aa456, -2);
  }

  // ---------- Netzwerk ----------
  if (net) {
    offs.push(net.onMessage("sel", ({ data }) => { if (phase !== "menu" || isHost() || !data) return; sel = { track: clamp(data.t | 0, 0, TRACKS.length), laps: LAPS.includes(data.l) ? data.l : 3, rseed: data.r >>> 0 }; loadWorld(); renderMenu(); }));
    offs.push(net.onMessage("begin", ({ data }) => { if (!data || data.id === rid) return; beginRace(data); }));
    offs.push(net.onMessage("menu", () => { if (phase !== "menu") showMenu(); }));
    offs.push(net.onMessage("k", ({ data, from }) => {
      const r = rem.get(from); if (!r || !Array.isArray(data)) return;
      const [x, z, yaw, vx, vz, prog, flags, steer] = data;
      const now = performance.now();
      if (!r.seen || Math.hypot(x - r.x, z - r.z) > 30) { r.x = x; r.z = z; r.yaw = yaw; }
      r.seen = true;
      r.tx = x; r.tz = z; r.ty = yaw; r.tvx = vx; r.tvz = vz; r.prog = prog; r.steer = steer / 100; r.tAt = now;
      if ((flags & 8) && !(r.flags & 8)) { r.spinT = 1.35; r.hopV = 6.5; r.spinDir = Math.random() < 0.5 ? -1 : 1; }
      r.flags = flags;
    }));
    offs.push(net.onMessage("box", ({ data }) => { if (world && data) world.takeBox(data[0], BOX_RESPAWN); }));
    offs.push(net.onMessage("ban", ({ data, from }) => { if (!world || !data || phase === "menu") return; addBanana(String(data[0]), +data[1], +data[2], from); }));
    offs.push(net.onMessage("shl", ({ data }) => { if (!world || !data || phase === "menu") return; addShell({ id: String(data.id), kind: "shell", sp: +data.p, lat: +data.l, tgt: data.t || 0, owner: data.o, age: 0 }); }));
    offs.push(net.onMessage("hit", ({ data }) => { if (data) removeItem(String(data[0]), true); }));
    offs.push(net.onMessage("fin", ({ data, from }) => {
      const r = rem.get(from); if (!r || !data) return;
      r.finT = +data.t || 0; results.set(from, r.finT); if (!firstFinAt) firstFinAt = performance.now();
    }));
    offs.push(net.onEvent("leave", (p) => { const r = p && rem.get(p.id); if (r) { r.left = true; models[r.idx] && (models[r.idx].root.visible = false); } }));
    offs.push(net.onEvent("host", () => { if (phase === "menu") renderMenu(); else if (phase === "done") renderResults(); }));
  }

  // ---------- Runde / Ziel ----------
  function lapLogic() {
    const done = Math.floor(me.prog / track.L);
    if (done > lapsDone && !finished) {
      const lapT = raceT - lapStart; lapStart = raceT;
      if (lapT < bestLap) bestLap = lapT;
      lapsDone = done;
      if (lapsDone >= laps) {
        finished = true; finT = raceT; results.set(meId, finT); if (!firstFinAt) firstFinAt = performance.now();
        net && net.send("fin", { t: +finT.toFixed(3) });
        sfx.fin();
        const key = bestKey(spec.id === "zufall" ? "zufall" + spec.seed : spec.id, laps);
        const prev = store.get(key, 0);
        if (!prev || finT < prev) { store.set(key, +finT.toFixed(3)); soloRecordNew = !!prev || true; }
        const lk = "kart_lap_" + (spec.id === "zufall" ? "zufall" + spec.seed : spec.id);
        const pl = store.get(lk, 0); if (!pl || bestLap < pl) store.set(lk, +bestLap.toFixed(3));
        const r = rank() + 1;
        say(solo ? "Ziel!" : r === 1 ? "Platz 1!" : "Platz " + r, "gold", 2200);
        resultsAt = performance.now() + (solo ? 1800 : 1600);
      } else {
        sfx.lap();
        say(lapsDone + 1 === laps ? "Letzte Runde!" : "Runde " + (lapsDone + 1), "good", 1300);
      }
    } else if (done < lapsDone) { /* rückwärts über die Linie: zählt wieder ab */ }
  }

  function checkDone(now) {
    if (phase !== "race" || resultShown || !finished) return;
    if (now < resultsAt) return;
    const alive = [...rem.values()].filter((k) => !k.left);
    const all = alive.every((k) => k.finT < Infinity);
    const grace = firstFinAt && now - firstFinAt > FINISH_GRACE * 1000;
    if (solo || all || grace) showResults();
  }

  function standings() {
    const rows = [{ id: meId, name: players[myIdx].name || "Du", color: colorOf(myIdx), me: true, t: finished ? finT : Infinity, prog: me.prog }];
    for (const k of rem.values()) if (!k.left) rows.push({ id: k.id, name: k.name, color: k.color, me: false, t: k.finT, prog: k.prog });
    rows.sort((a, b) => (a.t < Infinity || b.t < Infinity ? a.t - b.t || 0 : b.prog - a.prog));
    return rows;
  }

  function showResults() {
    resultShown = true; phase = "done"; sfx.engine(0, 0, false);
    renderResults();
  }
  function renderResults() {
    const rows = standings();
    const host = isHost();
    const pk = "kart_best_" + (spec.id === "zufall" ? "zufall" + spec.seed : spec.id) + "_" + laps;
    const best = store.get(pk, 0);
    const mine = rows.findIndex((r) => r.me) + 1;
    const title = solo ? "Geschafft!" : mine === 1 ? "Du hast gewonnen!" : "Platz " + mine;
    resEl.innerHTML = `<div class="kt-card"><h2>${esc(title)}${soloRecordNew && finT && finT <= best + 0.0005 ? '<span class="kt-new">NEUER REKORD</span>' : ""}</h2>
      <p class="sub">${esc(spec.name)} · ${laps} ${laps === 1 ? "Runde" : "Runden"}${bestLap < Infinity ? " · schnellste Runde " + fmtTime(bestLap) : ""}</p>
      <table class="kt-res"><tr><th>#</th><th>Fahrer</th><th>Zeit</th></tr>
      ${rows.map((r, i) => `<tr class="${r.me ? "me" : ""}"><td>${i + 1}</td><td><i style="background:${r.color}"></i>${esc(r.name)}</td><td>${r.t < Infinity ? fmtTime(r.t) : "nicht im Ziel"}</td></tr>`).join("")}</table>
      ${solo && best ? `<p class="sub" style="margin-top:10px">Deine Bestzeit auf dieser Strecke: <b>${fmtTime(best)}</b></p>` : ""}
      <div class="kt-btnrow">${host ? `<button class="kt-go" data-again>Nochmal</button><button class="kt-sec2" data-menu>${solo ? "Strecke wählen" : "Andere Strecke"}</button>` : `<button class="kt-go" disabled>Warte auf den Host …</button>`}</div></div>`;
    resEl.hidden = false;
  }
  resEl.addEventListener("click", (e) => {
    if (!isHost()) return;
    if (e.target.closest("[data-again]")) startRace();
    else if (e.target.closest("[data-menu]")) { net && net.send("menu", {}); showMenu(); }
  });

  // Lakitu holt das Kart ab, trägt es langsam zur Strecke und setzt es ab
  const RESCUE = { up: 0.8, carry: 1.5, down: 0.8, lift: 5 };
  function doReset() {
    if (rescue || me.spinT > 0) return;
    const loc = locate(track, me.x, me.z, -1, {});
    const s2 = (loc.s + 4) % track.L, tgt = pointAt(track, s2, clamp(loc.d, -5, 5));
    let ds = s2 - me.lastS; if (ds < -track.L / 2) ds += track.L; else if (ds > track.L / 2) ds -= track.L;
    rescue = { t: 0, fx: me.x, fz: me.z, fy: me.yaw, tx: tgt.x, tz: tgt.z, ty: tgt.yaw, ds, s2 };
    me.vx = me.vz = 0; me.drift = 0; me.driftT = 0; me.driftLvl = 0; me.boostT = 0; me.steer = 0;
    say("Lakitu kommt!", "", 1200);
  }
  const ease = (u) => u * u * (3 - 2 * u);
  function rescueStep(dt) {
    const r = rescue, R = RESCUE;
    r.t += dt;
    let h;
    if (r.t < R.up) { h = ease(r.t / R.up) * R.lift; me.x = r.fx; me.z = r.fz; }
    else if (r.t < R.up + R.carry) {
      const u = ease((r.t - R.up) / R.carry); h = R.lift + Math.sin(u * Math.PI) * 0.8;
      me.x = lerp(r.fx, r.tx, u); me.z = lerp(r.fz, r.tz, u); me.yaw = r.fy + angDiff(r.ty, r.fy) * u;
    } else { h = (1 - ease(clamp((r.t - R.up - R.carry) / R.down, 0, 1))) * R.lift; me.x = r.tx; me.z = r.tz; me.yaw = r.ty; }
    me.hop = h; me.hopV = 0; me.vx = me.vz = 0; me.along = 0; me.steer = 0; me.spinVis = 0;
    if (r.t >= R.up + R.carry + R.down) {
      me.hop = 0; me.prog += r.ds; me.lastS = r.s2; me.s = r.s2; me.idx = locate(track, me.x, me.z, -1, {}).i; me.inv = 1.5; me.offroad = false; me.grip = 1;
      lkOut = { t: 0, x: me.x, z: me.z, h: R.lift + 3.6 };
      rescue = null; camYaw = me.yaw;
    }
  }
  function lakituPose(t) {
    const cam = world.camera.position;
    if (rescue) {
      const R = RESCUE, a = clamp(1 - rescue.t / 0.9, 0, 1);       // anfliegen
      lkMe.set(me.x + ease(a) * 16, me.hop + 3.4 + ease(a) * 9, me.z + ease(a) * 4, cam.x, cam.z, t);
    } else if (lkOut) {
      lkOut.t += 1 / 60;
      const u = clamp(lkOut.t / 1.0, 0, 1);
      if (u >= 1) { lkOut = null; lkMe.hide(); } else lkMe.set(lkOut.x + ease(u) * 14, 3.4 + ease(u) * 12, lkOut.z - ease(u) * 6, cam.x, cam.z, t);
    } else lkMe.hide();
  }

  // ---------- Simulation (fester Schritt) ----------
  function simStep() {
    const inp = readInput();
    if (phase === "race" || phase === "done") {
      if (rescue) rescueStep(DT); else step(me, inp, DT, track, null);      // keine Kart-Kollisionen: Latenz würde sie unfair machen
      if (itemPress) { itemPress = false; if (!rolling && !rescue) useItem(); }
      // Boxen
      if (!rescue) for (const b of world.boxes) if (b.active) { const dx = b.x - me.x, dz = b.z - me.z; if (dx * dx + dz * dz < 3.6 * 3.6) pickBox(b); }
      // Boost-Pads
      if (!rescue) for (const p of track.pads) {
        const pp = pointAt(track, p.i * track.sp, p.lat), dx = me.x - pp.x, dz = me.z - pp.z;
        if (dx * dx + dz * dz < 5.5 * 5.5 && me.boostT < 0.5) { boost(me, 1.0); say("Turbo!", "gold", 600); }
      }
      if (!rescue) lapLogic();
      // falsche Richtung
      const f = Math.sin(me.yaw) * track.fx[me.idx] + Math.cos(me.yaw) * track.fz[me.idx];
      if (me.along > 5 && f < -0.35) wrongT += DT; else wrongT = Math.max(0, wrongT - DT * 2);
      if (wrongT > 1.2 && !finished) say("Falsche Richtung!", "bad", 300);
      // gestrandet: lange kaum Bewegung
      for (const e of me.events) {
        if (e === "boost") { sfx.boost(); shake = Math.max(shake, 0.3); }
        else if (e === "miniturbo") sfx.mini();
        else if (e === "bump") { sfx.bump(); shake = Math.max(shake, 0.45); }
        else if (e === "driftStart") sfx.drift();
      }
      me.events.length = 0;
    } else {
      me.events.length = 0;
    }
    if (++sendN % SEND_EVERY === 0 && net && (phase === "race" || phase === "done")) {
      const flags = (me.drift < 0 ? 1 : 0) | (me.drift > 0 ? 2 : 0) | (me.boostT > 0 ? 4 : 0) | (me.spinT > 0 ? 8 : 0) | (me.starT > 0 ? 16 : 0) | (finished ? 32 : 0) | (me.offroad ? 64 : 0) | (me.driftLvl << 7) | (rescue ? 512 : 0);
      const r2 = (v) => Math.round(v * 100) / 100;
      net.send("k", [r2(me.x), r2(me.z), Math.round(me.yaw * 1000) / 1000, r2(me.vx), r2(me.vz), r2(me.prog), flags, Math.round(me.steer * 100)]);
    }
  }

  // ---------- Frame ----------
  const camPos = new T.Vector3(), camLook = new T.Vector3();
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    tick(now);
  }
  function tick(now) {
    const dt = clamp((now - (last || now)) / 1000, 0, 0.05); last = now; time += dt;
    if (!world) return;

    if (phase === "countdown") {
      cd -= dt; countdownTick();
      if (cd <= 0.4 && cdShown !== 0) { cdShown = 0; }
      if (cd <= 0) goRace();
    }
    if (phase === "race") raceT += dt;
    if (phase === "race" || phase === "countdown" || phase === "done") {
      acc += dt; let n = 0;
      while (acc >= DT && n < 6) { simStep(); acc -= DT; n++; }
      if (acc > DT) acc = 0;
    }

    // Item-Auslosung
    if (rolling > 0) {
      rolling -= dt;
      if (rolling <= 0) { rolling = 0; item = drawItem(); itemCount = item === "mush3" ? 3 : 1; sfx.item(); }
    }
    if (phase === "race" || phase === "done") { updateItems(dt); }

    // Rennen anderer weich nachführen + Effekte
    for (const r of rem.values()) {
      if (r.left || !r.seen) continue;
      const age = Math.min(0.3, (performance.now() - r.tAt) / 1000);
      const ex = r.tx + r.tvx * age, ez = r.tz + r.tvz * age;
      const k = Math.min(1, dt * 11);
      r.x += (ex - r.x) * k; r.z += (ez - r.z) * k; r.yaw += angDiff(r.ty, r.yaw) * k;
      const f0 = r.flags;
      const sp = Math.hypot(r.tvx, r.tvz); r.wheel += sp * dt / 0.42;
      if (r.spinT > 0) { r.spinT -= dt; r.spinVis = ((1.35 - r.spinT) / 1.35) * Math.PI * 2 * r.spinDir; if (r.spinT <= 0) r.spinVis = 0; } else r.spinVis = 0;
      if (f0 & 512) r.hop = lerp(r.hop, RESCUE.lift, Math.min(1, dt * 4)); else if (r.hopV !== 0 || r.hop > 0) { r.hopV -= 24 * dt; r.hop += r.hopV * dt; if (r.hop <= 0) { r.hop = 0; r.hopV = 0; } }
      const f = r.flags, dr = f & 1 ? -1 : f & 2 ? 1 : 0;
      kartFx({ x: r.x, z: r.z, yaw: r.yaw, vx: r.tvx, vz: r.tvz, drift: dr, driftLvl: (f >> 7) & 3, boost: !!(f & 4), offroad: !!(f & 64) }, dt);
      { const lk = lkRem.get(r.id); if (lk) { if (f & 512) lk.set(r.x, r.hop + 3.4, r.z, world.camera.position.x, world.camera.position.z, time); else lk.hide(); } }
      models[r.idx].set({ x: r.x, z: r.z, yaw: r.yaw, hop: r.hop, steer: r.steer, drift: dr, spinVis: r.spinVis, wheel: r.wheel, boost: !!(f & 4), star: !!(f & 16) }, time);
    }
    // eigenes Kart
    if (phase !== "menu") {
      kartFx({ x: me.x, z: me.z, yaw: me.yaw, vx: me.vx, vz: me.vz, drift: me.drift, driftLvl: me.driftLvl, boost: me.boostT > 0, offroad: me.offroad }, dt);
      meModel.set({ x: me.x, z: me.z, yaw: me.yaw, hop: me.hop, steer: me.steer, drift: me.drift, spinVis: me.spinVis, wheel: me.wheel, boost: me.boostT > 0, star: me.starT > 0 }, time);
    } else {
      meModel.set({ x: me.x, z: me.z, yaw: me.yaw, hop: 0, steer: 0, drift: 0, spinVis: 0, wheel: 0 }, time);
      for (const r of rem.values()) if (!r.left) models[r.idx].set({ x: r.x, z: r.z, yaw: r.yaw, hop: 0, steer: 0, drift: 0, spinVis: 0, wheel: 0 }, time);
    }

    camera(dt);
    if (phase !== "menu") lakituPose(time); else lkMe && lkMe.hide();
    world.update(dt, time);
    world.render();
    if (phase !== "menu") { hudUpdate(); checkDone(performance.now()); }
    sfx.engine(clamp(Math.hypot(me.vx, me.vz) / MAXV, 0, 1.3), readInputGas(), phase === "race" || phase === "done");
  }
  const readInputGas = () => (keys.has("gas") || tch.gas || (isTouch && tch.auto) ? 1 : 0);

  function camera(dt) {
    const cam = world.camera;
    if (phase === "menu") {
      // langsamer Schwenk um das Startfeld
      const g = pointAt(track, -14, 0), a = time * 0.18;
      const base = Math.atan2(g.fx, g.fz) + Math.PI;
      const r = 24, ang = base + Math.sin(a) * 0.9;
      cam.position.set(g.x + Math.sin(ang) * r, 8 + Math.sin(a * 1.3) * 1.5, g.z + Math.cos(ang) * r);
      cam.lookAt(g.x, 1.6, g.z);
      cam.fov = lerp(cam.fov, world.camera.aspect < 1 ? 70 : 56, 0.1); cam.updateProjectionMatrix();
      return;
    }
    const sp = Math.hypot(me.vx, me.vz), frac = clamp(sp / MAXV, 0, 1.3);
    // Blick folgt dem Heading, im Drift etwas mehr der Fahrtrichtung
    let target = me.yaw;
    if (sp > 8 && me.drift) target = me.yaw + clamp(angDiff(Math.atan2(me.vx, me.vz), me.yaw), -0.5, 0.5) * 0.6;   // Winkel sauber mitteln (kein Umklappen bei ±π)
    camYaw += angDiff(target, camYaw) * Math.min(1, dt * (me.drift ? 3.2 : 5.5));
    const portrait0 = cam.aspect < 1, dist = (portrait0 ? 10.5 : 8.6) + frac * 1.4 + (me.boostT > 0 ? 1.1 : 0) + (rescue ? 4 : 0), h = (portrait0 ? 4.6 : 3.9) + frac * 0.25;
    const sx = Math.sin(camYaw), cz = Math.cos(camYaw);
    camPos.set(me.x - sx * dist, h + me.hop * (rescue ? 1.0 : 0.4), me.z - cz * dist);
    camLook.set(me.x + sx * 5.5, 1.3 + (rescue ? me.hop * 1.1 + 1.5 : 0), me.z + cz * 5.5);
    shake = Math.max(0, shake - dt * 2.4);
    if (shake > 0) { camPos.x += (Math.random() - 0.5) * shake * 0.5; camPos.y += (Math.random() - 0.5) * shake * 0.4; camPos.z += (Math.random() - 0.5) * shake * 0.5; }
    cam.position.copy(camPos); cam.lookAt(camLook);
    const portrait = cam.aspect < 1;
    camFov = lerp(camFov, (portrait ? 68 : 64) + frac * (portrait ? 6 : 12) + (me.boostT > 0 ? (portrait ? 4 : 9) : 0), Math.min(1, dt * 4));
    if (Math.abs(cam.fov - camFov) > 0.05) { cam.fov = camFov; cam.updateProjectionMatrix(); }
  }

  // ---------- HUD ----------
  function setTxt(key, node, v) { if (hudCache[key] !== v) { hudCache[key] = v; node.textContent = v; } }
  const keyHint = $(".kt-item .key");
  function paintKeyHint() { keyHint.hidden = isTouch || store.get("kart_item_uses", 0) >= 5; }
  paintKeyHint();
  const nodes = { pos: $(".kt-pos"), lap: $(".kt-lap"), time: $(".kt-time"), speed: $(".kt-speed b"), bar: $(".kt-speed .bar i"), dbar: $(".kt-speed .drift i"), item: $(".kt-item"), ic: $(".kt-item .ic"), n: $(".kt-item .n"), l: $(".kt-item .l"), board: $(".kt-board") };
  function hudUpdate() {
    const total = racers(), r = rank() + 1;
    const rk = solo ? "" : r + "|" + total;
    if (hudCache.rk !== rk) { hudCache.rk = rk; nodes.pos.className = "kt-pos p" + r; nodes.pos.innerHTML = solo ? "" : `${r}<span>/${total}</span>`; }
    const lapNow = clamp(Math.floor(me.prog / track.L) + 1, 1, laps);
    if (hudCache.lapN !== lapNow) { hudCache.lapN = lapNow; nodes.lap.innerHTML = `RUNDE <b>${lapNow}</b>/${laps}`; }
    setTxt("time", nodes.time, fmtTime(Math.max(0, finished ? finT : raceT)));
    const kmh = Math.round(Math.max(0, me.along) * KMH);
    setTxt("spd", nodes.speed, String(kmh));
    nodes.bar.style.width = clamp(Math.hypot(me.vx, me.vz) / (MAXV * 1.36), 0, 1) * 100 + "%";
    nodes.dbar.style.width = me.drift ? Math.min(100, (me.driftT / 3.1) * 100) + "%" : "0";
    nodes.dbar.style.background = me.drift ? "#" + LVLCOL[me.driftLvl].toString(16).padStart(6, "0") : "#fff";
    // Item
    const shown = rolling > 0 ? ["mush", "banana", "shell", "star"][Math.floor(time * 12) % 4] : item;
    const key = rolling > 0 ? "roll" + shown : item + ":" + itemCount;
    if (hudCache.item !== key) {
      hudCache.item = key;
      nodes.ic.innerHTML = shown ? ICONS[shown] : "";
      nodes.n.textContent = item === "mush3" && itemCount > 1 ? "×" + itemCount : "";
      nodes.l.textContent = !rolling && item ? ITEM_NAME[item] : "";
      nodes.item.classList.toggle("roll", rolling > 0); nodes.item.classList.toggle("ready", !rolling && !!item);
    }
    // Rangliste
    if (!solo && now100()) {
      const rows = standings();
      nodes.board.innerHTML = rows.map((s, i) => `<div class="${s.me ? "me" : ""}"><i style="background:${s.color}"></i>${i + 1}. ${esc(s.name)}${s.t < Infinity ? `<b>${fmtTime(s.t)}</b>` : ""}</div>`).join("");
    }
    // Minimap
    if (mini) {
      const ks = [{ x: me.x, z: me.z, color: colorOf(myIdx), me: true }];
      for (const k of rem.values()) if (!k.left && k.seen) ks.push({ x: k.x, z: k.z, color: k.color });
      mini.draw(ks);
    }
  }
  let t100 = 0;
  function now100() { const n = performance.now(); if (n - t100 > 250) { t100 = n; return true; } return false; }

  // ---------- Start ----------
  loadWorld();
  renderMenu();
  if (!env.manual) raf = requestAnimationFrame(frame);

  return {
    go() { if (net && isHost()) pushSel(); },
    menu: showMenu,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf);
      for (const f of offs.splice(0)) { try { f(); } catch {} }
      ro.disconnect(); clearTimeout(msgTimer);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
      sfx.close();
      if (world) world.dispose();
      host.remove();
    },
  };
}
