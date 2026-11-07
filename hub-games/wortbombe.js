// Wortbombe (Bomb-Party-Prinzip) for the multiplayer hub.
//
// Die Bombe liegt bei einem Spieler. In der Mitte stehen 2 Buchstaben (später 3) – wer dran ist, tippt ein
// echtes Wort, das diese Buchstaben am Stück enthält ("en" → "Zusammen"). Stimmt das Wort, wandert die Bombe
// zum nächsten Spieler. Irgendwann (zufällige, versteckte Zündschnur) explodiert sie: wer sie dann hält,
// verliert ein Leben (3 Stück). Wer als Letzter noch Leben hat, gewinnt. Kein Wort darf zweimal vorkommen.
//
// Der Host-Client besitzt die Regeln, die Zündschnur und das Wörterbuch-Urteil. Gäste schicken nur
// Absichten ("word") und live getippten Text ("typing"); der Host sendet den vollständigen Stand ("state").
// Jeder Client lädt das Wörterbuch, damit nach einem Host-Wechsel der neue Host weiterrichten kann.
// Beim Verlassen eines Spielers wenden alle Clients dieselbe Änderung an; der Host repariert danach den Zug.

import { shell } from "../hub-kit.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LIVES = 3;
const LAP_SWITCH = 3;                    // nach so vielen "Runden" gelöster Wörter (pro Sitz) kommen 3 Buchstaben
const FUSE_MIN = 8000, FUSE_MAX = 22000; // versteckte Zündzeit einer Bombe
const BOOM_PAUSE = 1700;
const LANGS = { de: "Deutsch", en: "English" };
const WORD_RE = { de: /^[a-zäöüß]+$/, en: /^[a-z]+$/ };

// ---- Wörterbuch (modulweit gecacht, die Dateien liegen in public/words/) ----
const dicts = new Map();                 // lang → Promise<Set>
let promptsP = null;
const loadDict = (lang) => {
  if (!dicts.has(lang)) dicts.set(lang, fetch(`words/${lang}.txt`).then((r) => { if (!r.ok) throw new Error("words " + r.status); return r.text(); }).then((t) => new Set(t.split("\n"))).catch((e) => { dicts.delete(lang); throw e; }));
  return dicts.get(lang);
};
const loadPrompts = () => promptsP || (promptsP = fetch("words/prompts.json").then((r) => { if (!r.ok) throw new Error("prompts " + r.status); return r.json(); }).catch((e) => { promptsP = null; throw e; }));

// hebt die erste Fundstelle der Buchstaben grün hervor
const hl = (word, prompt) => {
  const i = prompt ? word.toLowerCase().indexOf(prompt) : -1;
  if (i < 0) return esc(word);
  return esc(word.slice(0, i)) + "<b>" + esc(word.slice(i, i + prompt.length)) + "</b>" + esc(word.slice(i + prompt.length));
};

// lange Wörter schrumpfen, damit sie nicht aus der Bühne ragen
const wsize = (w) => (w.length > 10 ? Math.max(0.55, 10 / w.length).toFixed(2) : "1");
const setW = (el, text, prompt) => { el.innerHTML = hl(text, prompt); el.style.setProperty("--wf", wsize(text)); };

const REASONS = { prompt: "Enthält die Buchstaben nicht", dict: "Nicht im Wörterbuch", used: "Schon benutzt" };
const PHASES = ["setup", "play", "boom", "over"];

function cleanState(d, ids) {
  if (!d || typeof d !== "object" || !PHASES.includes(d.phase) || !(d.lang in LANGS) || !Array.isArray(d.seats) || d.seats.length < 1 || d.seats.length > 12) return null;
  const seats = [];
  for (const s of d.seats) {
    if (!s || !ids.has(s.id)) return null;
    seats.push({
      id: s.id, name: String(s.name || "").slice(0, 24), avatar: String(s.avatar || ""), accessory: String(s.accessory || ""), color: String(s.color || ""),
      lives: Math.max(0, Math.min(LIVES, s.lives | 0)), alive: !!s.alive, w: String(s.w || "").slice(0, 30), p: String(s.p || "").slice(0, 3),
    });
  }
  return {
    phase: d.phase, lang: d.lang, seats,
    turn: Math.max(0, Math.min(seats.length - 1, d.turn | 0)),
    prompt: String(d.prompt || "").slice(0, 3), level: d.level === 3 ? 3 : 2, solved: Math.max(0, d.solved | 0),
    used: Array.isArray(d.used) ? d.used.slice(-2000).map((w) => String(w).slice(0, 30)) : [],
    recent: Array.isArray(d.recent) ? d.recent.slice(-15).map((w) => String(w).slice(0, 3)) : [],
    age: Math.max(0, +d.age || 0),
    fx: { n: (d.fx && d.fx.n) | 0, id: d.fx && ids.has(d.fx.id) ? d.fx.id : null },
    winner: ids.has(d.winner) ? d.winner : null,
  };
}

export default {
  min: 2, max: 6,

  mount(ctx) {
    const kit = shell(ctx, { title: "Wortbombe" });
    const ids = new Set(ctx.players.map((p) => p.id));
    const me = () => ctx.me.id;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    // ---- state ----
    let st = {
      phase: "setup", lang: "de",
      seats: ctx.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar || "", accessory: p.accessory || "", color: p.color || "", lives: LIVES, alive: true, w: "", p: "" })),
      turn: 0, prompt: "", level: 2, solved: 0, used: [], recent: [], age: 0, fx: { n: 0, id: null }, winner: null,
    };
    let typed = "";                      // was der Spieler am Zug gerade tippt (nur Anzeige)
    let bombT0 = Date.now();             // lokal: wann die aktuelle Bombe scharf wurde (nur fürs Rütteln)
    let seenFx = 0, seenPhase = "setup";
    let dictReady = false, dictError = false, loadedLang = "";
    let badTimer = 0, msg = "";          // letzter Fehlerhinweis für mich
    let arrowRot = 0;
    let boomT = 0, armed = false; // Host: Timer der Zündschnur

    const seatOf = (id) => st.seats.findIndex((s) => s.id === id);
    const aliveCount = () => st.seats.filter((s) => s.alive).length;
    const nextAlive = (from) => { const n = st.seats.length; for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (st.seats[i].alive) return i; } return from; };
    const myTurn = () => st.phase === "play" && st.seats[st.turn] && st.seats[st.turn].id === me();

    // ---- DOM ----
    const root = kit.body;
    root.innerHTML = `<div class="wb">
      <div class="wb-stage"><div class="wb-flash"></div><div class="wb-seats"></div>
        <div class="wb-arrow"><svg viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wbg" x1="0" x2="1"><stop offset="0" stop-color="#e3bb14"/><stop offset="1" stop-color="#f7dc4a"/></linearGradient></defs><path d="M10 17 L150 17 L150 3 L196 22 L150 41 L150 27 L10 27Z" fill="url(#wbg)" stroke="#d9b414" stroke-width="2" stroke-linejoin="round"/></svg></div>
        <div class="wb-bomb"><svg viewBox="-60 -70 130 130" aria-hidden="true"><g class="wb-fuse"><path d="M12 -44 Q22 -56 30 -62" stroke="#2c2418" stroke-width="6" fill="none" stroke-linecap="round"/><g class="wb-spark" transform="translate(34 -66)"><polygon points="0,-17 5,-9 14,-12 10,-3 18,3 8,6 9,15 0,9 -9,15 -8,6 -18,3 -10,-3 -14,-12 -5,-9" fill="#f6c60e" stroke="#2c2418" stroke-width="3.5" stroke-linejoin="round"/><polygon points="0,-8 3,-3 8,-2 4,2 5,7 0,4 -5,7 -4,2 -8,-2 -3,-3" fill="#fff2a0"/></g></g><circle r="50" fill="#3b332d" stroke="#2a2420" stroke-width="5"/><circle r="42" fill="none" stroke="#4d433b" stroke-width="3"/><path d="M-30 -22 A38 38 0 0 1 8 -37" stroke="#fff" stroke-opacity=".13" stroke-width="7" fill="none" stroke-linecap="round"/></svg>
          <div class="wb-prompt"></div></div>
        <div class="wb-boom"></div>
      </div>
      <div class="wb-ui"></div></div>`;
    const wb = root.querySelector(".wb"), stage = root.querySelector(".wb-stage"), seatsEl = root.querySelector(".wb-seats"), arrow = root.querySelector(".wb-arrow");
    const bomb = root.querySelector(".wb-bomb"), promptEl = root.querySelector(".wb-prompt"), boomEl = root.querySelector(".wb-boom"), flash = root.querySelector(".wb-flash"), ui = root.querySelector(".wb-ui");
    let input = null;

    const avSize = () => Math.max(46, Math.min(96, Math.round(stage.clientWidth * 0.15)));
    const avatar = (s, size) => {
      const MPW = window.Multiplayer;
      const inner = s.avatar && MPW && MPW.avatarHtml ? MPW.avatarHtml(s.avatar, s.accessory, size) : `<span class="wb-ini" style="font-size:${Math.round(size * 0.5)}px">${esc((s.name || "?").slice(0, 1).toUpperCase())}</span>`;
      return `<div class="wb-av" style="width:${size}px;height:${size}px;${s.color ? "background:" + esc(s.color) : ""}">${inner}</div>`;
    };
    const hearts = (s) => {
      if (!s.alive) return `<div class="wb-hearts wb-dead" aria-label="ausgeschieden">☠️</div>`;
      let h = "";
      for (let i = 0; i < LIVES; i++) h += `<svg class="wb-heart${i < s.lives ? "" : " off"}" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21 C-4 9 4 -3 12 5 C20 -3 28 9 12 21Z"/></svg>`;
      return `<div class="wb-hearts" aria-label="${s.lives} Leben">${h}</div>`;
    };

    function seatPos(i, n) {
      const a = (-90 - 180 / n + (360 / n) * i) * Math.PI / 180;
      return { x: 50 + 37 * Math.cos(a), y: 50 + 37 * Math.sin(a), deg: a * 180 / Math.PI };
    }

    function renderSeats() {
      const n = st.seats.length, size = avSize();
      seatsEl.innerHTML = st.seats.map((s, i) => {
        const pos = seatPos(i, n), cur = st.phase !== "setup" && st.phase !== "over" && i === st.turn && s.alive;
        const word = cur && st.phase === "play" ? hl(typed, st.prompt) : hl(s.w, s.p);
        return `<div class="wb-seat${s.alive ? "" : " out"}${cur ? " cur" : ""}${st.winner === s.id ? " win" : ""}${s.id === me() ? " me" : ""}" data-id="${esc(s.id)}" style="left:${pos.x}%;top:${pos.y}%">
          <div class="wb-name">${esc(s.name)}</div>${avatar(s, size)}${hearts(s)}<div class="wb-x" hidden></div>
          <div class="wb-w${cur ? " live" : ""}" style="--wf:${wsize(cur && st.phase === "play" ? typed : s.w)}">${word}</div></div>`;
      }).join("");
      for (const s of st.seats) if (s.id === badId) markBad(s.id);
    }
    let badId = null;
    function markBad(id) {
      const el = seatsEl.querySelector(`.wb-seat[data-id="${CSS.escape(id)}"] .wb-x`);
      if (el) { el.hidden = false; el.textContent = "✖"; }
    }
    function flashBad(id) {
      badId = id; markBad(id);
      clearTimeout(badTimer);
      badTimer = later(() => { badId = null; const el = seatsEl.querySelector(".wb-x:not([hidden])"); if (el) el.hidden = true; }, 800);
    }

    function renderUi() {
      const cur = st.seats[st.turn];
      if (st.phase === "setup") {
        const host = ctx.isHost;
        ui.innerHTML = `<div class="wb-card">
          <div class="wb-rules"><b>So geht’s:</b> In der Mitte stehen Buchstaben. Tippe ein Wort, das sie enthält – dann geht die Bombe weiter. Wen sie beim Explodieren hält, verliert ein Leben (${LIVES} pro Spieler). Nach ein paar Runden werden es 3 Buchstaben.</div>
          <div class="wb-row">${host ? `<span class="wb-lbl">Sprache</span><div class="wb-seg">${Object.entries(LANGS).map(([k, v]) => `<button type="button" data-lang="${k}" class="${st.lang === k ? "on" : ""}">${v}</button>`).join("")}</div>
            <button type="button" class="primary wb-go" data-start ${dictReady ? "" : "disabled"}>${dictError ? "Wörterbuch fehlt" : dictReady ? "Start" : "Lade Wörterbuch …"}</button>`
            : `<span class="wb-wait">Der Host wählt die Sprache (<b>${LANGS[st.lang]}</b>) und startet die Runde.</span>`}</div></div>`;
        input = null;
        return;
      }
      if (st.phase === "over") {
        const w = st.seats.find((s) => s.id === st.winner);
        ui.innerHTML = `<div class="wb-card wb-over"><div class="wb-win">${w ? `🏆 ${esc(w.name)} gewinnt!` : "Unentschieden"}</div>
          ${ctx.isHost ? `<button type="button" class="primary" data-again>Nochmal</button>` : `<span class="wb-wait">Der Host startet die nächste Runde.</span>`}</div>`;
        input = null;
        return;
      }
      const mine = myTurn();
      if (mine) {
        if (!input) {
          ui.innerHTML = `<form class="wb-card wb-type" autocomplete="off"><input class="wb-in" type="text" inputmode="text" enterkeyhint="send" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="30" aria-label="Dein Wort" placeholder="Wort mit den Buchstaben …"/><button type="submit" class="primary">Los</button></form><div class="wb-msg" aria-live="polite"></div>`;
          input = ui.querySelector(".wb-in");
          input.value = typed;
          input.focus({ preventScroll: true });
        }
        ui.querySelector(".wb-msg").textContent = msg;
      } else {
        input = null;
        ui.innerHTML = `<div class="wb-card"><span class="wb-wait">${st.phase === "boom" ? "💥 Bumm!" : cur ? `<b>${esc(cur.name)}</b> ist dran …` : ""}</span></div>`;
      }
    }

    function renderCenter() {
      promptEl.textContent = st.phase === "setup" ? "" : (st.phase === "over" ? "" : st.prompt.toUpperCase());
      promptEl.classList.toggle("l3", st.prompt.length >= 3);
      bomb.classList.toggle("gone", st.phase === "boom" || st.phase === "over" || st.phase === "setup");
      arrow.classList.toggle("gone", st.phase !== "play");
      if (st.phase === "play") {
        const deg = seatPos(st.turn, st.seats.length).deg;
        arrowRot += ((deg - arrowRot + 540) % 360) - 180;
        arrow.style.transform = `rotate(${arrowRot}deg)`;
      }
    }

    function render() {
      // Effekte nur bei neuen Ereignissen
      if (st.fx.n !== seenFx) { if (st.phase === "boom") explodeFx(); seenFx = st.fx.n; }
      if (st.phase === "over" && seenPhase !== "over" && typeof confetti === "function") {
        try { confetti({ particleCount: 140, spread: 85, startVelocity: 40, origin: { y: 0.55 }, zIndex: 300, disableForReducedMotion: true }); } catch {}
      }
      if (st.phase === "play" && seenPhase !== "play") typed = "";
      seenPhase = st.phase;
      renderSeats(); renderCenter(); renderUi();
    }

    function explodeFx() {
      boomEl.classList.remove("go"); void boomEl.offsetWidth; boomEl.classList.add("go");
      flash.classList.remove("go"); void flash.offsetWidth; flash.classList.add("go");
      stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
    }

    // ---- animation loop: the bomb shakes more and more ----
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (st.phase !== "play") { bomb.style.transform = ""; return; }
      const r = Math.min(1, (Date.now() - bombT0) / FUSE_MAX);
      const k = 0.4 + r * r * 5;
      bomb.style.transform = `translate(${((Math.random() - .5) * k).toFixed(2)}px,${((Math.random() - .5) * k).toFixed(2)}px) scale(${(1 + r * 0.06).toFixed(3)})`;
    };
    raf = requestAnimationFrame(frame);

    // ---- dictionary ----
    function ensureDict() {
      if (loadedLang === st.lang && (dictReady || dictError)) return;
      loadedLang = st.lang; dictReady = false; dictError = false;
      const lang = st.lang;
      Promise.all([loadDict(lang), loadPrompts()]).then(() => { if (loadedLang === lang) { dictReady = true; if (st.phase === "setup") renderUi(); } })
        .catch(() => { if (loadedLang === lang) { dictError = true; if (st.phase === "setup") renderUi(); } });
    }

    // ---- host: rules ----
    const push = () => { st.age = Date.now() - bombT0; ctx.send("state", st); render(); };
    const pickSync = () => {
      // Prompts sind geladen, bevor der Host starten kann; Fallback nur für Notfälle
      const P = promptsCache; const list = P && P[st.lang] && P[st.lang][st.level === 3 ? "3" : "2"];
      if (!list) return st.prompt || "en";
      let p = list[Math.floor(Math.random() * list.length)];
      for (let t = 0; t < 40 && st.recent.includes(p); t++) p = list[Math.floor(Math.random() * list.length)];
      st.recent = [...st.recent, p].slice(-15);
      return p;
    };
    let promptsCache = null;
    loadPrompts().then((p) => { promptsCache = p; }).catch(() => {});

    function armBomb(min = FUSE_MIN, max = FUSE_MAX) {
      clearTimeout(boomT); timers.delete(boomT);
      bombT0 = Date.now(); armed = true;
      boomT = later(explode, min + Math.random() * (max - min));
    }
    function setLevel() { st.level = st.solved >= LAP_SWITCH * st.seats.length ? 3 : 2; }
    function finish() {
      clearTimeout(boomT); timers.delete(boomT);
      const alive = st.seats.filter((s) => s.alive);
      st.phase = "over"; st.winner = alive.length ? alive[0].id : null;
      push();
    }
    function advance() {                                         // nächster lebender Spieler, neuer Prompt
      st.turn = nextAlive(st.turn); setLevel(); st.prompt = pickSync(); typed = "";
    }
    function startRound() {
      if (!ctx.isHost || !dictReady || !promptsCache) return;
      for (const s of st.seats) { s.lives = LIVES; s.alive = ctx.room() ? !!ctx.room().players.find((p) => p.id === s.id) : true; s.w = ""; s.p = ""; }
      st.turn = Math.floor(Math.random() * st.seats.length);
      while (!st.seats[st.turn].alive) st.turn = nextAlive(st.turn);
      st.phase = "play"; st.solved = 0; st.used = []; st.recent = []; st.winner = null; st.fx = { n: st.fx.n, id: null }; typed = "";
      setLevel(); st.prompt = pickSync();
      if (aliveCount() < 2) { st.phase = "setup"; return push(); }
      armBomb(); push();
    }
    function explode() {
      if (!ctx.isHost || st.phase !== "play") return;
      const s = st.seats[st.turn];
      s.lives = Math.max(0, s.lives - 1); if (s.lives === 0) s.alive = false;
      st.phase = "boom"; st.fx = { n: st.fx.n + 1, id: s.id };
      push();
      later(resolveBoom, BOOM_PAUSE);
    }
    function resolveBoom() {
      if (!ctx.isHost || st.phase !== "boom") return;
      if (aliveCount() <= 1) return finish();
      advance(); st.phase = "play"; armBomb(); push();
    }
    function bad(id, reason) {
      ctx.send("bad", { id, reason });
      onBad(id, reason);
    }
    function onBad(id, reason) {
      flashBad(id);
      if (id === me()) { msg = REASONS[reason] || ""; const m = ui.querySelector(".wb-msg"); if (m) m.textContent = msg; if (input) { input.classList.remove("nope"); void input.offsetWidth; input.classList.add("nope"); input.select(); } }
    }
    async function submit(from, raw) {
      if (!ctx.isHost || st.phase !== "play" || !st.seats[st.turn] || st.seats[st.turn].id !== from) return;
      const w = String(raw || "").trim().toLowerCase().slice(0, 30);
      if (!w.includes(st.prompt)) return bad(from, "prompt");
      let dict; try { dict = await loadDict(st.lang); } catch { return bad(from, "dict"); }
      if (st.phase !== "play" || st.seats[st.turn].id !== from) return;     // der Zug kann sich während des Ladens geändert haben
      if (!WORD_RE[st.lang].test(w) || !dict.has(w)) return bad(from, "dict");
      if (st.used.includes(w)) return bad(from, "used");
      st.used.push(w); st.solved++;
      const s = st.seats[st.turn]; s.w = w; s.p = st.prompt;
      advance(); push();
    }
    // Host übernimmt (neuer Host nach Weggang): Zug reparieren, Zündschnur neu starten, Stand verteilen
    function repair() {
      if (!ctx.isHost) return;
      if (st.phase === "play") {
        if (aliveCount() <= 1) return finish();
        if (!st.seats[st.turn].alive) { advance(); }
        if (!armed) armBomb(6000, 16000);
        push();
      } else if (st.phase === "boom") {
        armed = false; later(resolveBoom, 600); push();
      } else push();
    }

    // ---- input ----
    ui.addEventListener("input", (e) => {
      if (e.target !== input) return;
      typed = input.value; msg = "";
      const m = ui.querySelector(".wb-msg"); if (m) m.textContent = "";
      const el = seatsEl.querySelector(".wb-seat.cur .wb-w"); if (el) setW(el, typed, st.prompt);
      throttleTyping();
    });
    let typingT = 0;
    function throttleTyping() { if (typingT) return; typingT = later(() => { typingT = 0; if (myTurn()) ctx.send("typing", typed.slice(0, 30)); }, 90); }
    ui.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!myTurn() || !input) return;
      const w = input.value.trim().toLowerCase();
      if (!w) return;
      if (!w.includes(st.prompt)) return onBad(me(), "prompt");
      if (ctx.isHost) submit(me(), w); else ctx.send("word", w, ctx.hostId);
    });
    ui.addEventListener("click", (e) => {
      const l = e.target.closest("[data-lang]");
      if (l && ctx.isHost && st.phase === "setup") { st.lang = l.dataset.lang; ensureDict(); push(); return; }
      if (e.target.closest("[data-start]") && ctx.isHost) startRound();
      else if (e.target.closest("[data-again]") && ctx.isHost) startRound();
    });
    window.addEventListener("resize", renderSeats);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => renderSeats()) : null;
    if (ro) ro.observe(stage);

    // ---- messages ----
    ctx.onMessage("word", ({ from, data }) => { if (ctx.isHost && typeof data === "string") submit(from, data); });
    ctx.onMessage("bad", ({ from, data }) => { if (from === ctx.hostId && data && ids.has(data.id)) onBad(data.id, data.reason); });
    ctx.onMessage("typing", ({ from, data }) => {
      if (typeof data !== "string" || st.phase !== "play" || !st.seats[st.turn] || st.seats[st.turn].id !== from || from === me()) return;
      typed = data.slice(0, 30);
      const el = seatsEl.querySelector(".wb-seat.cur .wb-w"); if (el) setW(el, typed, st.prompt);
    });
    ctx.onMessage("state", ({ data, from }) => {
      if (from !== ctx.hostId) return;
      const n = cleanState(data, ids);
      if (!n) return;
      const turnChanged = n.turn !== st.turn || n.prompt !== st.prompt || n.phase !== st.phase;
      st = n; bombT0 = Date.now() - st.age;
      if (turnChanged) { typed = ""; msg = ""; input = null; }
      ensureDict(); render();
    });
    // jemand ist gegangen: alle wenden dieselbe Änderung an, danach repariert der Host den Zug
    ctx.onEvent("leave", ({ id }) => {
      const i = seatOf(id);
      if (i < 0 || !st.seats[i].alive) return;
      if (st.phase === "setup") { st.seats[i].alive = false; render(); return; }
      st.seats[i].alive = false; st.seats[i].lives = 0;
      if (ctx.isHost) repair(); else render();
    });
    ctx.onEvent("host", ({ you }) => { if (you) { armed = false; repair(); } });

    ensureDict();
    render();
    return {
      go() { render(); },
      destroy() {
        cancelAnimationFrame(raf); window.removeEventListener("resize", renderSeats); if (ro) ro.disconnect();
        for (const t of timers) clearTimeout(t); timers.clear();
      },
    };
  },
};
