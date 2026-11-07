// Kart-Rennen (Solo) — Zeitfahren auf vier Strecken plus Zufallsstrecke, gegen die eigene Bestzeit.
// Spielt dieselbe Engine wie der Mehrspieler-Modus im Hub (hub-games/kart/); hier ohne Netz und ohne Gegner.
// Die Seite nutzt die Kopfleiste des Spielerahmens (fullscreen), das Spiel selbst rendert in Three.js.

let K = null;

initGame({
  title: "Kart-Rennen",
  tag: "Zeitfahren · Drift · Turbo",
  fullscreen: true,
  presets: [{ label: "Zeitfahren", values: [0] }],
  buttons: [
    { id: "btn-menu", label: "Strecke wählen", primary: true, onClick: () => K && K.menu() },
  ],
  sliders: [],
  onPreset: () => {},
  onSlider: () => {},
  onClamp: () => {},
  getSliderValues: () => ({}),
  info: {
    anim: infoAnim,
    title: "So wird gefahren",
    text: [
      "Fahre drei Runden so schnell du kannst. Pfeiltasten oder WASD lenken und beschleunigen, die Leertaste driftet: in der Kurve gedrückt halten, die Funken werden blau, orange, pink – beim Loslassen gibt es einen Turbo.",
      "Fahre über die Item-Boxen für Pilze und Sterne, über die gelben Pfeile am Boden für Gratis-Turbo. E setzt das Item ein, R setzt dich zurück auf die Strecke.",
      "Am Handy: links ziehen zum Lenken, rechts Drift, Item und Bremse. Auto-Gas ist an.",
    ].join(" "),
  },
});

function infoAnim(p, w, h, f) {
  p.background(...PAL.board);
  const t = (f % 90) / 90;
  p.noStroke(); p.fill(...PAL.panel); p.rect(0, h * 0.55, w, h * 0.45);
  p.fill(...PAL.well); p.quad(w * 0.4, h * 0.55, w * 0.6, h * 0.55, w * 0.92, h, w * 0.08, h);
  p.stroke(...PAL.sun); p.strokeWeight(4); p.drawingContext.setLineDash([16, 22]);
  p.line(w / 2, h * 0.56, w / 2, h); p.drawingContext.setLineDash([]); p.noStroke();
  const x = w / 2 + Math.sin(t * Math.PI * 2) * 50, y = h * 0.78;
  p.fill(...PAL.rose); p.rect(x - 26, y - 14, 52, 26, 6);
  p.fill(...PAL.ink); p.rect(x - 30, y + 6, 12, 14, 3); p.rect(x + 18, y + 6, 12, 14, 3);
  if (t > 0.5) { p.fill(...PAL.sun); for (let i = 0; i < 5; i++) p.circle(x - 30 + Math.random() * 60, y + 18 + Math.random() * 6, 4); }
}

function setup() {
  noCanvas();
  noLoop();
  const wrap = document.getElementById("canvas-wrap");
  wrap.style.touchAction = "none";
  const ui = document.getElementById("ui-overlay");
  const top = ui ? Math.ceil(ui.getBoundingClientRect().height) + 6 : 90;
  new Function("u", "return import(u)")(new URL("hub-games/kart/game.js", document.baseURI).href)
    .then((m) => m.createKart({ root: wrap, solo: true, net: null, topInset: top, onFull: (v) => { if (ui) ui.style.display = v ? "none" : ""; wrap.style.zIndex = v ? 99999 : 0; }, players: [{ id: "me", name: "Du" }], me: { id: "me" } }))
    .then((k) => { K = k; })
    .catch((e) => { console.error(e); wrap.textContent = "Kart-Rennen konnte nicht geladen werden."; });
}
