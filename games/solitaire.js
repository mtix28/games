// Solitär (Klondike) — die klassische Patience, mit wählbaren Regeln:
//   · Ziehen: 1 oder 3 Karten vom Stapel
//   · Stapel-Durchgänge: unbegrenzt, 3 oder 1 (Vegas)
//   · leere Spalten: nur Könige oder jede Karte
//   · Einstieg: alle Karten offen
// Karten per Drag & Drop ziehen, oder erst anklicken und dann das Ziel anklicken.
// Doppelklick legt eine Karte auf das Fundament.
//
// Animationen: Karten fliegen beim Ziehen, Legen, Austeilen und Zurückrutschen;
// aufgedeckte Karten werden umgeschlagen; ein gewonnenes Spiel endet mit einer
// Kaskade springender Karten. Die Zustandsänderung passiert sofort, die Animation
// zeigt sie nur — Flights verbergen die Karte am Ziel, bis sie angekommen ist.
//
// Kartenbilder: gemeinsames cards.js (PlayingCards), global pro Browser wählbar. Die Regeln hängen nicht vom Kartenbild ab.

const SOL_PRESETS = [
  { label: "Klassisch · 1 Karte · unbegrenzt (Standard)", values: [1, 0, 1, 0] },
  { label: "3 Karten · unbegrenzt",                       values: [3, 0, 1, 0] },
  { label: "1 Karte · 3 Durchgänge",                      values: [1, 3, 1, 0] },
  { label: "3 Karten · 1 Durchgang (Vegas)",              values: [3, 1, 1, 0] },
  { label: "1 Karte · jede Karte in leere Spalte",        values: [1, 0, 0, 0] },
  { label: "Einstieg · alle Karten offen",                values: [1, 0, 1, 1] },
];

initGame({
  title: "Solitär",
  tag: "Klondike · Regeln wählbar",
  presets: SOL_PRESETS,
  buttons: [
    { id: "btn-new",  label: "Neues Spiel", primary: true, onClick: () => newGame() },
    { id: "btn-undo", label: "Zurück",                     onClick: () => undo() },
    { id: "btn-targets", label: "Zielhilfe",                onClick: () => toggleTargets() },
    { id: "btn-deck", label: "Karten",                     onClick: () => PlayingCards.openMenu(document.getElementById("btn-deck")) },
  ],
  sliders: [],
  onPreset: (v) => { setRule(v); newGame(); },
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "So wird gespielt",
    text: [
      "Lege alle vier Farben auf die Fundamente, jeweils von Ass bis König. In den Spalten absteigend und abwechselnd farbig stapeln. Lücken füllen je nach Regel nur Könige oder jede Karte. Vom Stapel ziehst du 1 oder 3 Karten; wie oft der Stapel umgedreht werden darf, ist wählbar.",
      "Tasten: Leertaste Stapel ziehen · H Tipp · U zurück · N neues Spiel.",
    ],
  },
});

function setup() {
  const cnv = createCanvas(SOL_W, SOL_H);
  cnv.parent("canvas-wrap");
  newGame();
}

// ---- rules ----

let RULE = { draw: 1, passes: 0, kings: true, open: false };

function setRule(v) {
  RULE = { draw: v[0], passes: v[1], kings: !!v[2], open: !!v[3] };
  saveSettings("solitaire_state", { preset: v.join(",") });
}

// restore the last chosen preset (the shell is built synchronously by initGame)
(function restorePreset() {
  const d = loadSettings("solitaire_state");
  const hit = SOL_PRESETS.find((p) => p.values.join(",") === d.preset) || SOL_PRESETS[0];
  setRule(hit.values);
  const sel = document.getElementById("preset-select");
  if (sel) sel.value = hit.values.join(",");
})();

// ---- geometry (logical canvas) ----

const SOL_W = 620, SOL_H = 660, SOL_M = 16;
const COLW = (SOL_W - 2 * SOL_M) / 7;
const CW = 72, CH = 100;
const Y0 = SOL_M + CH + 36;   // top of the tableau
const FD = 14, FU = 26;       // vertical step of a face-down / face-up card
const SUIT = ["♠", "♥", "♦", "♣"];
const RANK = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const isRed = (s) => s === 1 || s === 2;
const colX = (i) => SOL_M + i * COLW + (COLW - CW) / 2;   // i = 0..6
const inRect = (x, y, rx, ry, rw, rh) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
const colAt = (x) => { const c = Math.floor((x - SOL_M) / COLW); return c >= 0 && c < 7 ? c : -1; };

// ---- state ----
// card: { r: 1..13, s: 0..3 (♠♥♦♣), up }
// tab: 7 arrays (bottom → top); fnd: 4 piles, index = suit; stock/waste: arrays
// safe defaults: p5 may call draw() before setup() has dealt a game
let tab = [[], [], [], [], [], [], []], fnd = [[], [], [], []], stock = [], waste = [];
let passNo = 1, moves = 0, undoStack = [], won = false;
let selected = null;   // src of a clicked card
let drag = null;       // { src, cards, sx, sy, moved, ox, oy }
let lastClick = null;  // { src, t } for double-click detection
let hintMove = null, hintUntil = 0;
let lastStatus = "", lastPointer = false;

// ---- animation state ----
// flight: a card travelling from (x0,y0) to (x1,y1); it is hidden at its target until it lands
// flip:   a card turning from its back to its face
// cascade: bouncing cards after a win
const FLY_MS = 260, FLIP_MS = 240;
let flights = [], flips = [], cascade = [], winQueue = [];
let lastFlip = null;   // set by takeCards when a tableau card was turned face-up

function addFlight(card, x0, y0, x1, y1, delay = 0, dur = FLY_MS, arc = 12) {
  flights.push({ card, x0, y0, x1, y1, t0: millis() + delay, dur, arc });
}

function newGame() {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ r, s, up: false });
  shuffleArray(deck);
  tab = [];
  let k = 0;
  for (let c = 0; c < 7; c++) {
    tab.push([]);
    for (let i = 0; i <= c; i++) {
      const card = deck[k++];
      card.up = i === c || RULE.open;
      tab[c].push(card);
    }
  }
  stock = deck.slice(k);
  waste = [];
  fnd = [[], [], [], []];
  passNo = 1; moves = 0; undoStack = []; won = false;
  selected = null; drag = null; lastClick = null; hintMove = null; hintUntil = 0;
  flips = []; cascade = []; winQueue = []; flights = [];
  // deal: every card flies from the stock to its place, column by column
  let n = 0;
  for (let c = 0; c < 7; c++) {
    for (let i = 0; i <= c; i++) {
      const card = tab[c][i];
      addFlight(card, colX(0), SOL_M, colX(c), colTop(c, i), n * 38, 320, 18);
      n++;
    }
  }
  clearParticles();
  resetHint();
  flashNote("");
}

function snapshot() { return JSON.stringify({ tab, fnd, stock, waste, passNo, moves }); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); }
function undo() {
  if (!undoStack.length) { flashNote("nichts zum Zurücknehmen"); return; }
  const s = JSON.parse(undoStack.pop());
  tab = s.tab; fnd = s.fnd; stock = s.stock; waste = s.waste; passNo = s.passNo; moves = s.moves;
  won = false; selected = null; hintMove = null;
  flights = []; flips = []; cascade = []; winQueue = [];
  flashNote("");
}

// ---- stock ----

function canRecycle() { return waste.length > 0 && (RULE.passes === 0 || passNo < RULE.passes); }
function canDraw() { return stock.length > 0 || canRecycle(); }

// where the waste card at index idx lies (with draw 3 the last three are fanned out)
function wastePos(idx) {
  const vis = RULE.draw === 3 ? Math.min(3, waste.length) : 1;
  const j = Math.max(0, idx - (waste.length - vis));
  return { x: colX(1) + (RULE.draw === 3 ? j * 7 : 0), y: SOL_M };
}

function clickStock() {
  if (won) return;
  selected = null; hintMove = null;
  if (stock.length) {
    pushUndo();
    const drawn = [];
    for (let i = 0; i < RULE.draw && stock.length; i++) {
      const c = stock.pop();
      c.up = true;
      waste.push(c);
      drawn.push(c);
    }
    drawn.forEach((card, j) => {
      const to = wastePos(waste.indexOf(card));
      addFlight(card, colX(0), SOL_M, to.x, to.y, j * 80, 240, 10);
    });
  } else if (canRecycle()) {
    pushUndo();
    const from = waste.map((_, w) => wastePos(w));
    let k = 0;
    while (waste.length) {
      const c = waste.pop();
      c.up = false;
      stock.push(c);
      const f = from[waste.length];
      addFlight(c, f.x, f.y, colX(0), SOL_M, k * 22, 240, 10);
      k++;
    }
    passNo++;
  } else {
    flashNote(RULE.passes ? "keine Durchgänge mehr · zurück oder neues Spiel" : "Stapel ist leer");
  }
}

// ---- moves ----

function getCards(src) {
  if (!src) return [];
  if (src.t === "waste") return waste.length ? [waste[waste.length - 1]] : [];
  if (src.t === "fnd") { const f = fnd[src.s]; return f.length ? [f[f.length - 1]] : []; }
  return tab[src.c].slice(src.i);
}

function canTab(cards, c) {
  const col = tab[c], first = cards[0];
  if (!col.length) return RULE.kings ? first.r === 13 : true;
  const top = col[col.length - 1];
  return top.r === first.r + 1 && isRed(top.s) !== isRed(first.s);
}

function canFnd(cards, s) {
  if (cards.length !== 1) return false;
  const card = cards[0], f = fnd[s];
  if (card.s !== s) return false;
  return f.length ? f[f.length - 1].r + 1 === card.r : card.r === 1;
}

function legal(src, dest) {
  const cards = getCards(src);
  if (!cards.length) return false;
  if (dest.t === "fnd") return canFnd(cards, dest.s);
  if (src.t === "tab" && src.c === dest.c) return false;
  return canTab(cards, dest.c);
}

// removes the cards from their source and returns them; turns the new top card face-up
function takeCards(src) {
  lastFlip = null;
  if (src.t === "waste") return [waste.pop()];
  if (src.t === "fnd") return [fnd[src.s].pop()];
  const col = tab[src.c];
  const taken = col.splice(src.i);
  if (col.length && !col[col.length - 1].up) {
    col[col.length - 1].up = true;
    lastFlip = col[col.length - 1];
  }
  return taken;
}

// where a card of the source stack currently sits (k = position within the stack)
function srcCardPos(src, k) {
  if (src.t === "waste") return wastePos(waste.length - 1);
  if (src.t === "fnd") return { x: colX(3 + src.s), y: SOL_M };
  return { x: colX(src.c), y: colTop(src.c, src.i + k) };
}

function tryMove(src, dest) {
  if (!legal(src, dest)) return false;
  pushUndo();
  const from = getCards(src).map((_, k) => srcCardPos(src, k));
  const taken = takeCards(src);
  const flipped = lastFlip;
  if (dest.t === "fnd") fnd[dest.s].push(taken[0]);
  else tab[dest.c].push(...taken);
  // flights to the final positions (computed after the push)
  taken.forEach((card, k) => {
    const to = dest.t === "fnd"
      ? { x: colX(3 + dest.s), y: SOL_M }
      : { x: colX(dest.c), y: colTop(dest.c, tab[dest.c].length - taken.length + k) };
    addFlight(card, from[k].x, from[k].y, to.x, to.y, k * 18, FLY_MS, 16);
  });
  if (flipped) flips.push({ card: flipped, t0: millis() + FLY_MS * 0.6, dur: FLIP_MS });
  moves++;
  selected = null; hintMove = null;
  if (fnd.every((f) => f.length === 13)) startWin();
  return true;
}

function startWin() {
  won = true;
  celebrate(3);
  winQueue = [];
  fnd.forEach((f, s) => f.slice().reverse().forEach((card) => winQueue.push({ card, s })));
}

function autoFoundation(src) {
  if (!src || src.t === "fnd") return false;
  const cards = getCards(src);
  if (cards.length !== 1) return false;
  return tryMove(src, { t: "fnd", s: cards[0].s });
}

// a legal move worth suggesting, or null
function findHint() {
  const srcs = [];
  if (waste.length) srcs.push({ t: "waste" });
  fnd.forEach((f, s) => { if (f.length) srcs.push({ t: "fnd", s }); });
  tab.forEach((col, c) => col.forEach((card, i) => { if (card.up) srcs.push({ t: "tab", c, i }); }));
  for (const src of srcs) {
    const cards = getCards(src);
    if (cards.length === 1) {
      const f = { t: "fnd", s: cards[0].s };
      if (legal(src, f)) return { from: src, to: f };
    }
    for (let c = 0; c < 7; c++) {
      const d = { t: "tab", c };
      if (src.t === "tab" && src.i === 0 && !tab[c].length) continue;   // pointless shuffle of a whole column
      if (legal(src, d)) return { from: src, to: d };
    }
  }
  return null;
}

function showHint() {
  if (won) return;
  const h = findHint();
  if (h) { selected = null; hintMove = h; hintUntil = millis() + 2500; flashNote(""); }
  else if (canDraw()) flashNote("kein Zug sichtbar · vom Stapel ziehen");
  else flashNote("keine Züge mehr · zurück oder neues Spiel");
}

// ---- hit testing ----

function colTop(c, i) {
  let y = Y0;
  for (let j = 0; j < i; j++) y += tab[c][j].up ? FU : FD;
  return y;
}

function hitAt(x, y) {
  if (inRect(x, y, colX(0), SOL_M, CW, CH)) return { t: "stock" };
  if (inRect(x, y, colX(1), SOL_M, CW + 14, CH)) return waste.length ? { t: "waste" } : null;
  for (let s = 0; s < 4; s++) if (inRect(x, y, colX(3 + s), SOL_M, CW, CH)) return { t: "fnd", s };
  const c = colAt(x);
  if (c < 0 || y < Y0) return null;
  const col = tab[c];
  if (!col.length) return { t: "empty", c };
  let top = Y0;
  for (let i = 0; i < col.length; i++) {
    const last = i === col.length - 1;
    const ext = last ? CH : (col[i].up ? FU : FD);
    if (y >= top && y < top + ext) return col[i].up ? { t: "tab", c, i } : { t: "down" };
    top += ext;
  }
  return null;
}

function srcFromHit(h) {
  if (!h) return null;
  if (h.t === "waste") return { t: "waste" };
  if (h.t === "fnd") return fnd[h.s].length ? { t: "fnd", s: h.s } : null;
  if (h.t === "tab") return { t: "tab", c: h.c, i: h.i };
  return null;
}

// where a dragged/clicked destination is: a foundation slot or a tableau column (anywhere in the column)
function destAt(x, y) {
  for (let s = 0; s < 4; s++) if (inRect(x, y, colX(3 + s) - 6, SOL_M - 6, CW + 12, CH + 12)) return { t: "fnd", s };
  const c = colAt(x);
  if (c >= 0 && y >= Y0 - 20) return { t: "tab", c };
  return null;
}

function sameSrc(a, b) { return a.t === b.t && a.c === b.c && a.i === b.i && a.s === b.s; }

// a dragged stack that was dropped on an illegal spot slides back to where it came from
function sendHome(d) {
  const bx = mouseX - d.ox, by = mouseY - d.oy;
  d.cards.forEach((card, k) => {
    const home = srcCardPos(d.src, k);
    addFlight(card, bx, by + k * FU, home.x, home.y, 0, 200, 0);
  });
}

// ---- mouse / keyboard ----

function mousePressed() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  if (won) return;
  const h = hitAt(mouseX, mouseY);
  if (h && h.t === "stock") { clickStock(); return false; }
  const src = srcFromHit(h);
  drag = { src, cards: src ? getCards(src) : [], sx: mouseX, sy: mouseY, moved: false, ox: 0, oy: 0 };
  if (src) {
    const p = srcCardPos(src, 0);
    drag.ox = mouseX - p.x;
    drag.oy = mouseY - p.y;
  }
  return false;
}

function mouseDragged() {
  if (drag && !drag.moved && dist(mouseX, mouseY, drag.sx, drag.sy) > 6) drag.moved = true;
  if (drag && drag.moved) return false;
}

function mouseReleased() {
  const d = drag;
  drag = null;
  if (!d || won) return;
  if (d.moved) {
    if (d.src) {
      const dest = destAt(mouseX, mouseY);
      const ok = !!dest && tryMove(d.src, dest);
      if (!ok) sendHome(d);
    }
    return;
  }
  // a click
  const now = millis();
  const prev = lastClick;
  lastClick = null;
  if (d.src && prev && sameSrc(prev.src, d.src) && now - prev.t < 400) {
    if (autoFoundation(d.src)) return;
  }
  if (selected) {
    const dest = destAt(mouseX, mouseY);
    if (dest && tryMove(selected, dest)) return;
    if (d.src && sameSrc(selected, d.src)) { selected = null; return; }
    // leeres Ziel angeklickt, aber die Karte darf nicht dorthin: Hinweis, Auswahl bleibt.
    // Eine andere Karte angeklickt: die wird neu ausgewählt (weiter unten).
    if (dest && !d.src) { flashNote("Dorthin darf diese Karte nicht"); return; }
  }
  if (d.src) { selected = d.src; lastClick = { src: d.src, t: now }; }
  else selected = null;
}

function keyPressed() {
  if (keyCode === 27) { selected = null; flashNote(""); return false; }   // Escape drops the selection
  if (key === "n" || key === "N") { newGame(); return false; }
  if (key === "u" || key === "U") { undo(); return false; }
  if (key === " ") { clickStock(); return false; }
  if (key === "h" || key === "H") { showHint(); return false; }
}

// ---- status ----

function refreshStatus() {
  const found = fnd.reduce((a, f) => a + f.length, 0);
  let text, state = null;
  if (won) {
    text = "gelöst in " + moves + (moves === 1 ? " Zug" : " Zügen");
    state = "solved";
  } else {
    text = "Züge " + moves + " · Durchgang " + passNo + (RULE.passes ? "/" + RULE.passes : "") + " · " + found + "/52";
    if (!canDraw() && !findHint()) { text = "keine Züge mehr · " + found + "/52"; state = "dead"; }
  }
  const key = text + "|" + state;
  if (key !== lastStatus) { lastStatus = key; setStatus(text, state); }
}

// ---- card designs ----
// Das Kartenbild kommt aus dem gemeinsamen cards.js (PlayingCards) und gilt für alle
// Kartenspiele. Die Wahl ist global pro Browser; nur die Optik ändert sich, nicht die Regeln.
function refreshDeckButton() {
  const b = document.getElementById("btn-deck");
  if (b) b.textContent = "Karten: " + PlayingCards.current().name;
}
PlayingCards.onChange(refreshDeckButton);
refreshDeckButton();

// Zielhilfe: rahmt bei gewählter Karte alle erlaubten Ziele. Standard aus, global pro Browser.
const TARGETS_KEY = "games_solitaire_targets";
let showTargets = false;
try { showTargets = localStorage.getItem(TARGETS_KEY) === "1"; } catch {}
function toggleTargets() {
  showTargets = !showTargets;
  try { localStorage.setItem(TARGETS_KEY, showTargets ? "1" : "0"); } catch {}
  setButtonActive("btn-targets", showTargets);
}
setButtonActive("btn-targets", showTargets);

function drawFace(g, x, y, c, o) {
  PlayingCards.face(g.drawingContext, x, y, CW, CH, c.r, c.s);
  if (o.hl) {
    const a = 165 + 90 * Math.sin(millis() / 170);
    g.noFill();
    g.stroke(o.hl[0], o.hl[1], o.hl[2], 60); g.strokeWeight(6);
    g.rect(x - 3, y - 3, CW + 6, CH + 6, 12);
    g.stroke(o.hl[0], o.hl[1], o.hl[2], a); g.strokeWeight(3);
    g.rect(x - 1.5, y - 1.5, CW + 3, CH + 3, 10);
  }
}

// one card. g = p5 instance or `window` (global mode). o: { hl, sx, back, lift }
//   hl    highlight colour [r,g,b] (pulses)   sx  horizontal scale (card flip)
//   back  force the back side                  lift 0..1 shadow strength (flying cards)
function solCard(g, x, y, c, o = {}) {
  const lift = o.lift || 0;
  const back = o.back ?? !c.up;
  g.push();
  if (o.sx !== undefined && o.sx !== 1) {
    g.translate(x + CW / 2, y + CH / 2);
    g.scale(Math.max(0.04, Math.abs(o.sx)), 1);
    x = -CW / 2; y = -CH / 2;
  }
  // soft two-layer shadow; deeper while lifted
  g.noStroke();
  g.fill(0, 0, 0, 22 + lift * 34);
  g.rect(x - 1 + lift * 2, y + 2 + lift * 6, CW + 2, CH + 2, 10);
  g.fill(0, 0, 0, 30 + lift * 30);
  g.rect(x + 1, y + 3 + lift * 2, CW, CH, 9);

  if (back) PlayingCards.back(g.drawingContext, x, y, CW, CH);
  else drawFace(g, x, y, c, o);
  g.pop();
}

// an empty place: foundation suit, stock recycle sign, or a plain column slot
function solSlot(g, x, y, glyph, ink) {
  g.noStroke();
  g.fill(...PAL.well, 150);
  g.rect(x, y, CW, CH, 9);
  g.noFill(); g.stroke(...PAL.lineHi, 170); g.strokeWeight(1.5);
  g.rect(x, y, CW, CH, 9);
  if (glyph) {
    g.noStroke();
    g.fill(...(ink || PAL.lineHi), ink ? 130 : 200);
    g.textAlign("center", "center"); g.textSize(34);
    g.text(glyph, x + CW / 2, y + CH / 2);
  }
}

// frame around a legal target slot, pulsing softly
function targetFrame(x, y, alpha) {
  noFill(); stroke(...PAL.sun, alpha); strokeWeight(3);
  rect(x - 3, y - 3, CW + 6, CH + 6, 11);
}

// felt-like table: soft lamp glow in the middle
function solTable() {
  background(...PAL.board);
  noStroke();
  for (let k = 9; k >= 1; k--) {
    fill(...PAL.mint, 4);
    ellipse(SOL_W / 2, SOL_H * 0.42, SOL_W * (0.45 + k * 0.09), SOL_H * (0.36 + k * 0.08));
  }
}

function solBanner() {
  const bw = 320, bh = 104, bx = SOL_W / 2 - bw / 2, by = SOL_H / 2 - bh / 2 - 30;
  noStroke();
  fill(...PAL.board, 225);
  rect(bx, by, bw, bh, 18);
  fill(...PAL.mint, 40);
  rect(bx + 2, by + 2, bw - 4, bh / 2 - 2, 16, 16, 4, 4);
  textAlign(CENTER, CENTER);
  fill(...PAL.mint);
  textStyle(BOLD); textSize(36);
  text("Gelöst!", SOL_W / 2, by + bh / 2 - 12);
  textStyle(NORMAL); fill(...PAL.muted); textSize(15);
  text(moves + (moves === 1 ? " Zug" : " Züge"), SOL_W / 2, by + bh / 2 + 24);
}

function draw() {
  solTable();
  const now = millis();
  flights = flights.filter((f) => now < f.t0 + f.dur);
  flips = flips.filter((f) => now < f.t0 + f.dur);
  const inFlight = new Set(flights.map((f) => f.card));
  const selCards = selected ? getCards(selected) : [];
  const hintCards = hintMove && now < hintUntil ? getCards(hintMove.from) : [];
  const dragging = drag && drag.moved && drag.src ? drag.cards : [];
  const hlFor = (card) => (hintCards.includes(card) ? PAL.mint : selCards.includes(card) ? PAL.sun : null);
  const shown = (card) => !dragging.includes(card) && !inFlight.has(card);
  const flipOf = (card) => {
    const f = flips.find((x) => x.card === card);
    if (!f) return {};
    if (now < f.t0) return { back: true };
    const p = (now - f.t0) / f.dur;
    return { sx: Math.abs(2 * p - 1), back: p < 0.5 };
  };
  const drawCard = (x, y, card) => solCard(window, x, y, card, Object.assign({ hl: hlFor(card) }, flipOf(card)));

  // stock
  if (stock.length) solCard(window, colX(0), SOL_M, stock[stock.length - 1], { back: true });
  else solSlot(window, colX(0), SOL_M, canRecycle() ? "↻" : "×");

  // waste (fanned out with draw 3)
  if (waste.length) {
    const n = RULE.draw === 3 ? Math.min(3, waste.length) : 1;
    for (let j = 0; j < n; j++) {
      const card = waste[waste.length - n + j];
      if (shown(card)) drawCard(colX(1) + j * 7, SOL_M, card);
    }
  } else solSlot(window, colX(1), SOL_M, "");

  // foundations, one pile per suit
  for (let s = 0; s < 4; s++) {
    const f = fnd[s];
    if (f.length) { const card = f[f.length - 1]; if (shown(card)) drawCard(colX(3 + s), SOL_M, card); }
    else solSlot(window, colX(3 + s), SOL_M, SUIT[s], isRed(s) ? [206, 44, 68] : null);
  }

  // tableau
  for (let c = 0; c < 7; c++) {
    const col = tab[c], x = colX(c);
    if (!col.length) { solSlot(window, x, Y0, ""); continue; }
    let y = Y0;
    for (const card of col) {
      if (shown(card)) drawCard(x, y, card);
      y += card.up ? FU : FD;
    }
  }

  // drop preview while dragging: a legal target gets a mint frame where the card would land
  if (dragging.length) {
    const dest = destAt(mouseX, mouseY);
    if (dest && legal(drag.src, dest)) {
      const x = dest.t === "fnd" ? colX(3 + dest.s) : colX(dest.c);
      const y = dest.t === "fnd" ? SOL_M : colTop(dest.c, tab[dest.c].length);
      noFill(); stroke(...PAL.mint, 230); strokeWeight(3);
      rect(x - 3, y - 3, CW + 6, CH + 6, 11);
    }
  }

  // while a card is selected: every place it may go gets a sun frame
  if (showTargets && selCards.length && !dragging.length) {
    const pulse = 150 + 80 * Math.sin(now / 220);
    for (let s = 0; s < 4; s++) {
      if (legal(selected, { t: "fnd", s })) targetFrame(colX(3 + s), SOL_M, pulse);
    }
    for (let c = 0; c < 7; c++) {
      if (legal(selected, { t: "tab", c })) targetFrame(colX(c), tab[c].length ? colTop(c, tab[c].length) : Y0, pulse);
    }
  }

  // hint destination (pulsing)
  if (hintCards.length && hintMove) {
    const to = hintMove.to;
    const x = to.t === "fnd" ? colX(3 + to.s) : colX(to.c);
    const y = to.t === "fnd" ? SOL_M : colTop(to.c, tab[to.c].length);
    noFill(); stroke(...PAL.mint, 120 + 100 * Math.sin(now / 180)); strokeWeight(3);
    rect(x - 3, y - 3, CW + 6, CH + 6, 11);
  }

  // flying cards (drawn above the board, under the dragged stack)
  for (const f of flights) {
    if (now < f.t0) continue;
    const p = Math.min(1, (now - f.t0) / f.dur);
    const e = 1 - Math.pow(1 - p, 3);
    const x = f.x0 + (f.x1 - f.x0) * e;
    const y = f.y0 + (f.y1 - f.y0) * e - f.arc * Math.sin(Math.PI * p);
    solCard(window, x, y, f.card, { lift: Math.sin(Math.PI * p) });
  }

  // the card(s) being dragged follow the pointer
  if (dragging.length) {
    const bx = mouseX - drag.ox, by = mouseY - drag.oy;
    dragging.forEach((card, k) => solCard(window, bx, by + k * FU, card, { lift: 1, hl: PAL.sun }));
  }

  // win: cards leave the foundations one by one and bounce around the table
  if (won) {
    if (winQueue.length && frameCount % 4 === 0) {
      const q = winQueue.shift();
      cascade.push({ card: q.card, x: colX(3 + q.s), y: SOL_M, vx: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 3.5), vy: -2 - Math.random() * 3, life: 0 });
    }
    for (const c of cascade) {
      c.vy += 0.5; c.x += c.vx; c.y += c.vy; c.life++;
      if (c.y > SOL_H - CH) { c.y = SOL_H - CH; c.vy *= -0.62; c.vx *= 0.97; }
      solCard(window, c.x, c.y, c.card, { lift: 0.6 });
    }
    cascade = cascade.filter((c) => c.x > -CW * 2 && c.x < SOL_W + CW && c.life < 900);
    solBanner();
  }

  // pointer cursor over things you can click or drag
  const hov = !won && !drag && mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height ? hitAt(mouseX, mouseY) : null;
  const wantPointer = !!hov && hov.t !== "empty" && hov.t !== "down" && !(hov.t === "fnd" && !fnd[hov.s].length);
  if (wantPointer !== lastPointer) { lastPointer = wantPointer; cursor(wantPointer ? "pointer" : "default"); }

  refreshStatus();
}

// ---- how-to-play animation (440×280, looping) ----
// one card: stock → waste → foundation, then the loop starts again

function infoAnim(p, w, h, frame) {
  p.background(...PAL.board);
  const cw = 58, ch = 84, y = h / 2 - ch / 2 + 6;
  const xS = 70, xW = 180, xF = 320;
  const slot = (x) => { p.noFill(); p.stroke(...PAL.lineHi); p.strokeWeight(1.5); p.rect(x, y, cw, ch, 7); };
  slot(xS); slot(xW); slot(xF);
  const t = frame % 150;
  const prog = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  let cx = xS, lift = 0;
  if (t >= 10 && t < 40) { const u = prog(10, 40); cx = xS + (xW - xS) * ease(u); lift = 10 * Math.sin(u * Math.PI); }
  else if (t >= 40 && t < 60) cx = xW;
  else if (t >= 60) { const u = prog(60, 95); cx = xW + (xF - xW) * ease(u); lift = 10 * Math.sin(u * Math.PI); }
  const up = t >= 10;
  // the card itself: ace of hearts
  p.noStroke(); p.fill(0, 0, 0, 60); p.rect(cx + 2, y - lift + 3, cw, ch, 7);
  if (!up) {
    p.fill(...PAL.lilac); p.rect(cx, y, cw, ch, 7);
  } else {
    p.fill(252, 250, 244); p.stroke(190, 186, 176); p.strokeWeight(1); p.rect(cx, y - lift, cw, ch, 7);
    p.noStroke(); p.fill(206, 44, 68);
    p.textAlign("center", "center"); p.textSize(30);
    p.text("A", cx + cw / 2, y - lift + ch / 2 - 8);
    p.textSize(20); p.text("♥", cx + cw / 2, y - lift + ch / 2 + 20);
  }
}
