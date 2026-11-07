// Gemeinsames Kartenbild für alle Kartenspiele (Solitär, Blackjack, ...).
// Alle Blätter sind fertige Dateien unter cards/<deck>/ (Quellen und Lizenzen: cards/LICENSES.md),
// werden beim ersten Gebrauch geladen und in der gezeichneten Größe zwischengespeichert.
// Das SVG-Blatt (Klassisch) lassen sich pro Kartenfarbe umfärben; Bild-Blätter nicht.
// Zeichnet auf einem Canvas-2D-Kontext, unabhängig von p5.
// Suit-Index: 0 = ♠, 1 = ♥, 2 = ♦, 3 = ♣ — die Spiele rechnen immer so.
// Die Wahl gilt global pro Browser (localStorage "games_card_*").
(function () {
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = ["S", "H", "D", "C"];
  const GLYPH = ["♠", "♥", "♦", "♣"];
  const BLACK = "#000000", RED = "#ff0000";
  const SVG_COLS = [BLACK, RED, RED, BLACK];

  const BACKS = [   // wählbare Rückseiten (BdRGames); zusätzlich "own" = die Rückseite des Blatts selbst
    { id: "red", name: "Rot", css: "#c8384a" }, { id: "blue", name: "Blau", css: "#3a56a8" },
    { id: "green", name: "Grün", css: "#2f7a5c" }, { id: "black", name: "Schwarz", css: "#3a3a3a" },
    { id: "lightblue", name: "Hellblau", css: "#3aa3d2" },
  ];

  // dir = Ordner unter cards/, ten = Dateiname der Zehn, ext = Dateiendung, own = eigene Rückseite (back.<ext>),
  // defBack = Standard-Rückseite, cols = umfärbbar (nur SVG), pixel = ohne Glättung skalieren
  const DECKS = [
    { id: "skat",     name: "Klassisch",  dir: "skat",     ten: "T",  ext: "svg", defBack: "blue", cols: SVG_COLS },
    { id: "medieval", name: "Mittelalter (A. Walker)",  dir: "medieval", ten: "T",  ext: "webp", own: true, defBack: "own" },
    { id: "sharm",    name: "Verschnörkelt (Sharm)",    dir: "sharm",    ten: "T",  ext: "webp", own: true, defBack: "own" },
    { id: "simple",   name: "Schlicht",                 draw: true, defBack: "blue", cols: ["#26262b", "#d01f3a", "#d01f3a", "#26262b"] },
    { id: "pixel",    name: "Pixel Art (G. Dittmann)",  dir: "pixel",    ten: "T",  ext: "png",  own: true, defBack: "own", pixel: true },
  ];
  const tintable = (D) => !!D.cols;
  // draw = gezeichnet (Canvas) statt Bilddatei; einzige eigene Zeichnung, bewusst ganz schlicht wie die Ablagefelder

  // ---- Einstellungen (global pro Browser) ----
  const K_DECK = "games_card_deck", K_COLS = "games_card_colors", K_BACK = "games_card_back";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  let userCols = {}; try { userCols = JSON.parse(store.get(K_COLS)) || {}; } catch {}
  let userBacks = {}; try { userBacks = JSON.parse(store.get(K_BACK)) || {}; } catch {}   // pro Blatt: { deckId: backId }
  let idx = Math.max(0, DECKS.findIndex((d) => d.id === store.get(K_DECK)));
  const listeners = [];
  const current = () => DECKS[idx];
  const colsOf = (D) => (D.cols && userCols[D.id]) || D.cols;
  const emit = () => listeners.forEach((f) => f(current()));

  // ---- SVG laden (ggf. umgefärbt) ----
  const imgs = new Map();     // key -> { img, ok }
  const scaled = new Map();   // key|w|h -> canvas
  const loadWaiters = [];
  const lastBack = {};   // deckId -> zuletzt erfolgreich geladene Rückseite
  let waitTick = 0;
  const loaded = () => { if (!waitTick) waitTick = requestAnimationFrame(() => { waitTick = 0; loadWaiters.forEach((f) => f()); }); };

  // Schwarze Farben tragen ihre Farbe implizit (Pfad ohne fill) → fill am Wurzelelement; Index-Strich explizit.
  // Rote Farben stehen als fill/stroke="red" im SVG.
  function recolor(svg, suit, col) {
    if (suit === 1 || suit === 2) return svg.replace(/(fill|stroke)="red"/g, `$1="${col}"`);
    return svg.replace('stroke="#000" stroke-linecap', `stroke="${col}" stroke-linecap`).replace("<svg ", `<svg fill="${col}" `);
  }
  function load(url, suit, col) {
    const key = col ? url + "|" + col : url;
    let e = imgs.get(key);
    if (!e) {
      e = { img: new Image(), ok: false, err: false };
      e.img.onload = () => { e.ok = true; loaded(); };
      e.img.onerror = () => { e.err = true; console.warn("Karte nicht ladbar:", key); };
      imgs.set(key, e);
      if (col) fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((t) => { e.img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(recolor(t, suit, col)); })
        .catch(() => { e.err = true; });
      else e.img.src = url;
    }
    return e;
  }

  function fileOf(D, rank, suit) {
    const r = rank === 1 ? "A" : rank === 10 ? D.ten : RANKS[rank];
    return "cards/" + D.dir + "/" + r + SUITS[suit] + "." + D.ext;
  }
  const backsOf = (D) => (D.own ? [] : BACKS);   // Bild-Blätter haben nur ihre eigene Rückseite
  const backIdOf = (D) => (backsOf(D).some((b) => b.id === userBacks[D.id]) && userBacks[D.id]) || D.defBack;
  const backUrl = (D) => { const b = backIdOf(D); return b === "own" ? "cards/" + D.dir + "/back." + D.ext : "cards/backs/d3_" + b + ".svg"; };
  // Farbe nur angeben, wenn sie vom Original abweicht (sonst reicht die unveränderte Datei)
  const tintOf = (D, suit) => {
    if (!D.cols || D.draw) return null;
    const c = (colsOf(D)[suit] || "").toLowerCase();
    return c && c !== SVG_COLS[suit] ? c : null;
  };

  function preload(D) {
    if (D.draw) return;
    load(backUrl(D));
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) load(fileOf(D, r, s), s, tintOf(D, s));
  }

  // zeichnet das Bild an (x,y,w,h); im aktuellen Gerätemaßstab zwischengespeichert, damit große SVGs nur einmal gerastert werden
  function blit(ctx, e, key, x, y, w, h, pix) {
    if (!e.ok) {                                  // noch nicht geladen: schlichter Platzhalter
      ctx.save(); ctx.fillStyle = "#f4f1ea"; ctx.strokeStyle = "rgba(0,0,0,.25)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, w * 0.08); else ctx.rect(x, y, w, h);
      ctx.fill(); ctx.stroke(); ctx.restore();
      return;
    }
    const m = ctx.getTransform();
    const k = Math.hypot(m.c, m.d) || 1;            // vertikaler Maßstab: Flips stauchen nur x
    const pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
    const ck = key + "|" + pw + "|" + ph;
    let c = scaled.get(ck);
    if (!c) {
      c = document.createElement("canvas"); c.width = pw; c.height = ph;
      const g = c.getContext("2d"); g.imageSmoothingEnabled = !pix; g.imageSmoothingQuality = "high"; g.drawImage(e.img, 0, 0, pw, ph);
      scaled.set(ck, c);
      if (scaled.size > 700) scaled.delete(scaled.keys().next().value);
    }
    ctx.drawImage(c, x, y, w, h);
  }

  // Schlicht: cremefarbene Karte, grauer Rand, ein großes Symbol, Zahl in den Ecken (logische Größe 72×100)
  const SYM = ["♠\uFE0E", "♥\uFE0E", "♦\uFE0E", "♣\uFE0E"];
  function simplePath(ctx, w, h) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(1, 1, w - 2, h - 2, 9); else ctx.rect(1, 1, w - 2, h - 2); }
  function simpleFace(ctx, x, y, w, h, rank, suit, D) {
    const col = colsOf(D)[suit];
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 72, h / 100);
    simplePath(ctx, 72, 100); ctx.fillStyle = "#fbf8f1"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#5d5a54"; ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "40px system-ui, sans-serif"; ctx.fillText(SYM[suit], 36, 52);
    const corner = () => {
      ctx.font = "bold 16px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(RANKS[rank], 7, 6);
    };
    corner(); ctx.translate(72, 100); ctx.rotate(Math.PI); corner();
    ctx.restore();
  }
  function simpleBack(ctx, x, y, w, h, css) {
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 72, h / 100);
    simplePath(ctx, 72, 100); ctx.fillStyle = css; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(8, 8, 56, 84, 5); else ctx.rect(8, 8, 56, 84); ctx.stroke();
    ctx.restore();
  }

  function face(ctx, x, y, w, h, rank, suit, o = {}) {
    const D = o.deck || current();
    if (D.draw) return simpleFace(ctx, x, y, w, h, rank, suit, D);
    const url = fileOf(D, rank, suit), col = tintOf(D, suit);
    let e = load(url, suit, col), key = col ? url + "|" + col : url;
    // umgefärbte Karte lädt noch (oder ist fehlgeschlagen): solange die Originalfarbe zeigen statt eines leeren Rechtecks
    if (col && !e.ok) { const e0 = load(url); if (e0.ok) { e = e0; key = url; } }
    blit(ctx, e, key, x, y, w, h, D.pixel);
  }
  function back(ctx, x, y, w, h, o = {}) {
    const D = o.deck || current();
    if (D.draw) return simpleBack(ctx, x, y, w, h, BACKS.find((b) => b.id === backIdOf(D)).css);
    let url = backUrl(D), e = load(url);
    // neue Rückseite lädt noch: bis dahin die zuletzt gezeigte Rückseite dieses Blatts
    if (e.ok) lastBack[D.id] = url; else if (lastBack[D.id]) { const e0 = load(lastBack[D.id]); if (e0.ok) { e = e0; url = lastBack[D.id]; } }
    blit(ctx, e, url, x, y, w, h, D.pixel && backIdOf(D) === "own");
  }

  // ---- Auswahl ----
  function select(id) {
    const i = DECKS.findIndex((d) => d.id === id);
    if (i < 0 || i === idx) return current();
    idx = i; store.set(K_DECK, current().id);
    preload(current()); emit();
    return current();
  }
  function cycle() { return select(DECKS[(idx + 1) % DECKS.length].id); }
  function setColor(deckId, suit, hex) {
    const D = DECKS.find((d) => d.id === deckId); if (!D || !D.cols) return;
    const c = colsOf(D).slice(); c[suit] = hex.toLowerCase();
    userCols[deckId] = c; store.set(K_COLS, JSON.stringify(userCols));
    preload(D); emit();
  }
  function setColors(deckId, cols) {
    const D = DECKS.find((d) => d.id === deckId); if (!D || !D.cols) return;
    if (cols) userCols[deckId] = cols.map((c) => c.toLowerCase()); else delete userCols[deckId];
    store.set(K_COLS, JSON.stringify(userCols));
    preload(D); emit();
  }
  function setBack(id) {
    if (!backsOf(current()).some((b) => b.id === id)) return;
    userBacks[current().id] = id; store.set(K_BACK, JSON.stringify(userBacks));
    preload(current()); emit();
  }
  preload(current());

  // ---- Auswahlmenü: Kacheln (Dame ♥ + Rückseite) und Farbeinstellungen, geöffnet unter dem Button ----
  const CSS = `
.pc-menu{position:fixed;z-index:500;width:min(420px,calc(100vw - 24px));max-height:min(70vh,640px);overflow-y:auto;padding:6px;
  background:var(--modal-bg,var(--panel,#222));color:var(--ink,#eee);font-size:13px;
  border:var(--border-w,1px) solid var(--panel-edge,#555);border-radius:var(--r-md,12px);box-shadow:0 16px 40px -12px rgba(0,0,0,.5)}
.pc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px}
.pc-opt{all:unset;box-sizing:border-box;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;cursor:pointer;
  border-radius:calc(var(--r-sm,8px)*.7);text-align:center;font:inherit;color:inherit}
.pc-opt:hover,.pc-opt:focus-visible{background:var(--panel-2,#333)}
.pc-opt[aria-checked="true"]{outline:2px solid var(--accent,#6cf);outline-offset:-2px}
.pc-pair{display:flex;gap:6px;width:100%;justify-content:center}
.pc-pair canvas{width:min(56px,40%);min-width:0;flex:0 1 auto;height:auto;aspect-ratio:56/78;display:block}
.pc-set{margin:6px 4px 2px;padding-top:8px;border-top:1px solid var(--hairline,rgba(128,128,128,.35));display:grid;gap:8px}
.pc-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pc-row>b{min-width:66px;font-weight:600}
.pc-row label{display:flex;align-items:center;gap:4px;font-size:15px}
.pc-row input[type=color]{width:40px;height:32px;padding:0;border:1px solid var(--panel-edge,#666);border-radius:6px;background:none;cursor:pointer}
.pc-row button{all:unset;cursor:pointer;padding:3px 9px;border-radius:999px;border:1px solid var(--panel-edge,#666);font-size:12px}
.pc-row button:hover,.pc-row button:focus-visible{background:var(--panel-2,#333)}
.pc-sw{width:28px!important;height:38px!important;min-width:28px!important;box-sizing:border-box;border-radius:6px!important;padding:0!important;border:2px solid var(--panel-edge,#666)!important}
.pc-sw[aria-checked="true"]{outline:3px solid var(--accent,#6cf);outline-offset:2px}
@media (max-width:420px){.pc-grid{grid-template-columns:1fr}}`;
  let menu = null, menuBtn = null;
  function closeMenu() {
    if (!menu) return;
    const i = loadWaiters.indexOf(drawPreviews); if (i >= 0) loadWaiters.splice(i, 1);
    menu.remove(); menu = null;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", closeMenu);
  }
  const onOutside = (e) => { if (menu && !menu.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) closeMenu(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } };

  function drawPreviews() {
    if (!menu) return;
    const dpr = window.devicePixelRatio || 1;
    menu.querySelectorAll(".pc-pair canvas").forEach((cv) => {
      const D = DECKS.find((d) => d.id === cv.dataset.deck);
      if (cv.width !== 56 * dpr) { cv.width = 56 * dpr; cv.height = 78 * dpr; }
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, 56, 78);
      if (cv.dataset.side === "face") face(ctx, 0, 0, 56, 78, 12, 1, { deck: D }); else back(ctx, 0, 0, 56, 78, { deck: D });
    });
  }
  const hex = (c) => (typeof c === "string" ? c : "#000000");
  function settingsHTML() {
    const D = current();
    let h = "";
    if (tintable(D)) {
      const cs = colsOf(D);
      h += `<div class="pc-row"><b>Farben</b>${GLYPH.map((g, s) => `<label>${g}<input type="color" data-suit="${s}" value="${hex(cs[s])}" aria-label="Farbe ${g}"></label>`).join("")}</div>
        <div class="pc-row"><b></b><button type="button" data-preset="default">Standard</button><button type="button" data-preset="four">Vier Farben</button></div>`;
    }
    if (!D.own) {
      h += `<div class="pc-row"><b>Rückseite</b>${backsOf(D).map((b) => `<button type="button" class="pc-sw" data-back="${b.id}" style="background:${b.url ? "url(" + b.url + ") center/cover" : b.css}${D.pixel && b.url ? ";image-rendering:pixelated" : ""}" role="radio" aria-checked="${b.id === backIdOf(D)}" aria-label="${b.name}" title="${b.name}"></button>`).join("")}</div>`;
    }
    return h;
  }
  function renderMenu() {
    menu.innerHTML = `<div class="pc-grid">${DECKS.map((d) => `<button class="pc-opt" type="button" role="menuitemradio" data-id="${d.id}" aria-checked="${d === current()}">
      <span class="pc-pair"><canvas data-deck="${d.id}" data-side="face"></canvas><canvas data-deck="${d.id}" data-side="back"></canvas></span><span>${d.name}</span></button>`).join("")}</div>
      <div class="pc-set">${settingsHTML()}</div>`;
    if (!menu.querySelector(".pc-set").children.length) menu.querySelector(".pc-set").remove();
    drawPreviews();
  }
  function openMenu(btn) {
    if (menu) { const same = menuBtn === btn; closeMenu(); if (same) return; }
    if (!document.getElementById("pc-style")) {
      const st = document.createElement("style"); st.id = "pc-style"; st.textContent = CSS; document.head.appendChild(st);
    }
    menuBtn = btn;
    menu = document.createElement("div");
    menu.className = "pc-menu"; menu.setAttribute("role", "menu");
    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const o = e.target.closest(".pc-opt"), p = e.target.closest("[data-preset]"), b = e.target.closest("[data-back]");
      if (o) { select(o.dataset.id); renderMenu(); }
      else if (p) { setColors(current().id, p.dataset.preset === "four" ? ["#000000", "#ff0000", "#1f4fff", "#1a9a3c"] : null); renderMenu(); }
      else if (b) { setBack(b.dataset.back); renderMenu(); }
    });
    // "change" statt "input": der Farbwähler feuert beim Ziehen laufend, jede Farbe lädt 13 SVGs neu
    menu.addEventListener("change", (e) => {
      const i = e.target.closest("input[data-suit]"); if (!i) return;
      setColor(current().id, +i.dataset.suit, i.value); drawPreviews();
    });
    document.body.appendChild(menu);
    renderMenu();
    loadWaiters.push(drawPreviews);
    DECKS.forEach((d) => { if (!d.draw) { load(backUrl(d)); load(fileOf(d, 12, 1), 1, tintOf(d, 1)); } });
    const r = btn.getBoundingClientRect(), mw = menu.offsetWidth;
    const top = Math.min(r.bottom + 8, window.innerHeight - 160);
    menu.style.top = top + "px";
    menu.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + "px";
    menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - mw - 12)) + "px";
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeMenu);
  }

  window.PlayingCards = {
    decks: DECKS, ranks: RANKS, current, cycle, select, openMenu, setColor, setColors, setBack,
    face, back, preload, onChange: (f) => listeners.push(f),
  };
})();
