// Kart-Rennen — Oberfläche: HUD, Menü, Ergebnis, Touch-Steuerung, Minimap (alles DOM/CSS, unabhängig vom Design-Picker).

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const fmtTime = (t) => {
  if (!isFinite(t)) return "—";
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
};

export const KART_COLORS = ["#e8383d", "#2f7df6", "#ffc21a", "#2fc26b", "#a35cf0", "#ff7a1a"];

// kleine SVG-Symbole für die Items
export const ICONS = {
  mush: `<svg viewBox="0 0 64 64"><path d="M8 34C8 16 20 8 32 8s24 8 24 26z" fill="#e23b3b"/><circle cx="21" cy="24" r="6" fill="#fff"/><circle cx="43" cy="22" r="5" fill="#fff"/><circle cx="32" cy="15" r="3.5" fill="#fff"/><path d="M18 34h28v8c0 8-6 14-14 14s-14-6-14-14z" fill="#f6e3c0"/><circle cx="26" cy="43" r="2.2" fill="#2a2a2a"/><circle cx="38" cy="43" r="2.2" fill="#2a2a2a"/></svg>`,
  banana: `<svg viewBox="0 0 64 64"><path d="M14 12c2 22 14 34 38 36-8 6-26 6-36-6C8 32 8 20 14 12z" fill="#ffd21f" stroke="#b8860b" stroke-width="3" stroke-linejoin="round"/><path d="M12 10l6-3 2 6-6 2z" fill="#6b4a1a"/></svg>`,
  shell: `<svg viewBox="0 0 64 64"><ellipse cx="32" cy="36" rx="24" ry="20" fill="#e23b3b" stroke="#8c1b1b" stroke-width="3"/><path d="M10 40h44" stroke="#fff6dd" stroke-width="6" stroke-linecap="round"/><path d="M32 16v40M20 22l24 28M44 22L20 50" stroke="#fff" stroke-opacity=".5" stroke-width="2.5"/></svg>`,
  star: `<svg viewBox="0 0 64 64"><path d="M32 4l8.5 18.5L61 25l-15 14 4 20.5L32 49 14 59.5 18 39 3 25l20.5-2.5z" fill="#ffd23f" stroke="#c79200" stroke-width="3" stroke-linejoin="round"/><circle cx="26" cy="30" r="2.6" fill="#333"/><circle cx="38" cy="30" r="2.6" fill="#333"/></svg>`,
};
ICONS.mush3 = ICONS.mush;

export const ITEM_NAME = { mush: "Turbo-Pilz", mush3: "3× Turbo-Pilz", banana: "Banane", shell: "Panzer", star: "Stern" };

export const CSS = `
.kt { --kt-font: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif; position: absolute; inset: 0; overflow: hidden; background: #0b1020; color: #fff; border-radius: 14px; user-select: none; -webkit-user-select: none; touch-action: none;
  font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-tap-highlight-color: transparent; }
.kt * { box-sizing: border-box; }
.kt.kt-full { border-radius: 0; }
.kt-view, .kt-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.kt button { font: inherit; cursor: pointer; margin: 0; }

/* --- HUD --- */
.kt-hud { position: absolute; inset: 0; z-index: 2; pointer-events: none; padding: var(--kt-top, 0px) 0 0; }
.kt-hud[hidden], .kt-menu[hidden], .kt-result[hidden], .kt-touch[hidden], .kt-center[hidden] { display: none !important; }
.kt-glass { background: rgba(10,14,30,.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.14); border-radius: 14px; }
.kt-item { position: absolute; left: 14px; top: calc(var(--kt-top, 0px) + 12px); width: 74px; height: 74px; display: grid; place-items: center; }
.kt-item svg { width: 54px; height: 54px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); }
.kt-item .key { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); margin-left: 8px; min-width: 30px; padding: 4px 9px; border-radius: 8px; background: rgba(255,255,255,.92); color: #10142a; font: 800 16px/1 ui-monospace, Menlo, monospace; text-align: center; box-shadow: 0 3px 0 rgba(0,0,0,.35); }
.kt-item .key[hidden] { display: none; }
.kt-item.roll svg { animation: kt-roll .16s steps(1) infinite; }
.kt-item .n { position: absolute; right: 5px; bottom: 3px; font: 900 italic 18px/1 var(--kt-font); text-shadow: 0 2px 0 rgba(0,0,0,.6); }
.kt-item .l { position: absolute; left: 0; right: 0; bottom: -18px; text-align: center; font-size: 11px; font-weight: 700; color: #fff; opacity: .85; text-shadow: 0 1px 2px #000; }
.kt-item.ready { animation: kt-pulse .9s ease-in-out infinite; border-color: #ffd23f; }
@keyframes kt-pulse { 50% { transform: scale(1.07); } }
.kt-pos { position: absolute; left: 14px; top: calc(var(--kt-top, 0px) + 100px); font: 900 italic 64px/0.9 var(--kt-font); text-shadow: 0 4px 0 rgba(0,0,0,.45), 0 0 18px rgba(0,0,0,.35); }
.kt-pos span { font-size: 26px; opacity: .8; margin-left: 2px; }
.kt-pos sup { font-size: 24px; margin-left: 1px; }
.kt-pos.p1 { color: #ffd23f; } .kt-pos.p2 { color: #e4e8f2; } .kt-pos.p3 { color: #ffb36b; }
.kt-board { position: absolute; left: 14px; top: calc(var(--kt-top, 0px) + 172px); width: 150px; display: grid; gap: 3px; font-size: 12px; font-weight: 700; }
.kt-board div { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; background: rgba(10,14,30,.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kt-board div.me { background: rgba(255,255,255,.9); color: #10142a; }
.kt-board i { width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.kt-board b { margin-left: auto; font-weight: 700; opacity: .8; font-variant-numeric: tabular-nums; }
.kt-top { position: absolute; left: 50%; top: calc(var(--kt-top, 0px) + 10px); transform: translateX(-50%); padding: 6px 18px; text-align: center; font-weight: 800; letter-spacing: .04em; }
.kt-lap, .kt-best, .kt-time { display: block; line-height: 1.2; min-height: 1.2em; } .kt-lap { font-size: 15px; } .kt-lap b { font-size: 22px; font-style: italic; }
.kt-time { font: 800 22px/1.1 ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }
.kt-best { font-size: 11px; opacity: .75; font-weight: 700; }
.kt-map { position: absolute; right: 12px; top: calc(var(--kt-top, 0px) + 12px); width: 150px; height: 150px; border-radius: 14px; }
.kt-speed { position: absolute; right: 16px; bottom: 16px; width: 158px; padding: 8px 12px 10px; text-align: right; }
.kt-speed b { font: 900 italic 38px/1 var(--kt-font); font-variant-numeric: tabular-nums; } .kt-speed small { font-size: 12px; font-weight: 700; opacity: .8; margin-left: 4px; }
.kt-speed .bar { height: 7px; border-radius: 4px; background: rgba(255,255,255,.16); margin-top: 6px; overflow: hidden; }
.kt-speed .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #4be37a, #ffd23f, #ff5d5d); border-radius: 4px; }
.kt-speed .drift { height: 5px; margin-top: 5px; border-radius: 3px; background: rgba(255,255,255,.12); overflow: hidden; }
.kt-speed .drift i { display: block; height: 100%; width: 0; background: #fff; }
.kt-tools { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 8px; pointer-events: auto; }
.kt-ico { min-width: 40px; height: 40px; padding: 0 12px; border-radius: 12px; color: #fff; font-size: 17px; font-weight: 700; display: grid; place-items: center; }
.kt-ico:hover { background: rgba(255,255,255,.2); }
.kt-msg { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font: 900 italic 40px/1 var(--kt-font); text-shadow: 0 4px 0 rgba(0,0,0,.5); text-align: center; white-space: nowrap; opacity: 0; transition: opacity .25s; }
.kt-msg.on { opacity: 1; } .kt-msg.bad { color: #ff6b6b; } .kt-msg.good { color: #7dff9a; } .kt-msg.gold { color: #ffd23f; }

.kt-center { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.kt-count { font: 900 italic 170px/1 var(--kt-font); color: #fff; text-shadow: 0 8px 0 rgba(0,0,0,.4), 0 0 40px rgba(0,0,0,.5); animation: kt-pop .9s ease-out both; }
.kt-count.go { color: #7dff9a; font-size: 140px; }
@keyframes kt-pop { 0% { transform: scale(2.2); opacity: 0; } 25% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .0; } }
@keyframes kt-roll { 0% { transform: scale(1.05); } 50% { transform: scale(.9); } }
.kt-lights { position: absolute; top: 18%; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; padding: 12px 18px; border-radius: 18px; background: rgba(10,14,30,.7); }
.kt-lights i { width: 34px; height: 34px; border-radius: 50%; background: #3a3f55; }
.kt-lights i.r { background: #ff3b3b; box-shadow: 0 0 18px #ff3b3b; } .kt-lights i.g { background: #3bff7a; box-shadow: 0 0 22px #3bff7a; }

/* --- Menü & Ergebnis --- */
.kt-menu, .kt-result { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: calc(var(--kt-top, 0px) + 14px) 14px 14px; overflow: auto; background: linear-gradient(rgba(8,10,24,.55), rgba(8,10,24,.78)); }
.kt-card { flex: none; width: min(860px, 100%); margin: auto; padding: 18px 20px 20px; border-radius: 22px; background: rgba(14,18,40,.86); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.kt-card h2 { margin: 0; font: 900 italic 32px/1.05 var(--kt-font); letter-spacing: .01em; }
.kt-card h2 em { color: #ffd23f; font-style: italic; }
.kt-card .sub { margin: 4px 0 14px; opacity: .75; font-size: 14px; }
.kt-sec { margin: 14px 0 6px; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; opacity: .65; }
.kt-tracks { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
.kt-tr { position: relative; padding: 8px; border-radius: 14px; background: rgba(255,255,255,.07); border: 2px solid transparent; color: #fff; text-align: left; display: grid; gap: 4px; }
.kt-tr svg { width: 100%; height: 70px; display: block; }
.kt-tr b { font-size: 14px; } .kt-tr small { font-size: 11px; opacity: .7; line-height: 1.25; }
.kt-tr .rec { font-size: 11px; font-weight: 800; color: #ffd23f; font-variant-numeric: tabular-nums; }
.kt-tr.sel { border-color: #ffd23f; background: rgba(255,210,63,.14); }
.kt-tr[disabled] { cursor: default; } .kt-tr:not([disabled]):hover { background: rgba(255,255,255,.14); }
.kt-seg { display: inline-flex; gap: 6px; }
.kt-seg button { padding: 7px 16px; border-radius: 999px; background: rgba(255,255,255,.09); color: #fff; font-weight: 800; border: 2px solid transparent; }
.kt-seg button.sel { border-color: #ffd23f; background: rgba(255,210,63,.16); }
.kt-seg button[disabled] { cursor: default; opacity: .8; }
.kt-plist { display: flex; flex-wrap: wrap; gap: 6px; }
.kt-plist span { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.09); font-size: 13px; font-weight: 700; }
.kt-plist i { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.kt-go { margin-top: 16px; width: 100%; padding: 14px 18px; border-radius: 16px; border: 0; background: linear-gradient(#ffd23f, #ffa81a); color: #2a1a00; font: 900 italic 22px/1 var(--kt-font); box-shadow: 0 5px 0 #b97500; }
.kt-go:active { transform: translateY(3px); box-shadow: 0 2px 0 #b97500; }
.kt-go[disabled] { background: rgba(255,255,255,.14); color: #fff; box-shadow: none; cursor: default; opacity: .8; font-size: 16px; }
.kt-help { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; opacity: .78; }
.kt-help kbd { display: inline-block; min-width: 20px; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.16); font: 700 11px ui-monospace, Menlo, monospace; text-align: center; }
.kt-row2 { display: flex; flex-wrap: wrap; gap: 14px 28px; }
.kt-res { width: 100%; border-collapse: collapse; margin-top: 10px; font-variant-numeric: tabular-nums; }
.kt-res td, .kt-res th { padding: 7px 8px; text-align: left; font-size: 15px; }
.kt-res th { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; opacity: .6; }
.kt-res tr.me td { background: rgba(255,255,255,.1); } .kt-res td:first-child { font: 900 italic 20px/1 var(--kt-font); width: 40px; }
.kt-res i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 7px; box-shadow: 0 0 0 2px rgba(255,255,255,.7); }
.kt-btnrow { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.kt-btnrow .kt-go { margin: 0; flex: 1 1 200px; } .kt-btnrow .kt-sec2 { flex: 1 1 160px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.12); color: #fff; font-weight: 800; border: 0; }
.kt-new { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #ffd23f; color: #2a1a00; font: 900 12px/1.4 var(--kt-font); vertical-align: middle; }

/* --- Touch --- */
.kt-touch { position: absolute; inset: 0; pointer-events: none; }
.kt-pad { position: absolute; left: 0; top: 30%; bottom: 0; width: 46%; pointer-events: auto; }
.kt-pad .hint { position: absolute; left: 24px; bottom: 26px; display: flex; align-items: center; gap: 14px; font-size: 38px; opacity: .38; font-weight: 900; }
.kt-pad .ring { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; border: 3px solid rgba(255,255,255,.4); background: rgba(255,255,255,.08); display: none; }
.kt-pad .knob { position: absolute; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%; background: rgba(255,255,255,.75); display: none; box-shadow: 0 3px 10px rgba(0,0,0,.4); }
.kt-pad.on .ring, .kt-pad.on .knob { display: block; }
.kt-b { position: absolute; pointer-events: auto; border-radius: 50%; border: 3px solid rgba(255,255,255,.55); background: rgba(255,255,255,.14); color: #fff; font: 900 italic 14px/1 var(--kt-font); letter-spacing: .03em; display: grid; place-items: center; backdrop-filter: blur(3px); }
.kt-b.on { background: rgba(255,255,255,.5); transform: scale(.94); }
.kt-b-gas { right: 18px; bottom: 18px; width: 104px; height: 104px; font-size: 20px; background: rgba(60,220,110,.28); border-color: #7dff9a; }
.kt-b-brake { right: 140px; bottom: 16px; width: 72px; height: 72px; background: rgba(255,90,90,.25); border-color: #ff8a8a; }
.kt-b-drift { right: 22px; bottom: 140px; width: 84px; height: 84px; background: rgba(90,160,255,.28); border-color: #8cc0ff; }
.kt-b-item { right: 124px; bottom: 98px; width: 78px; height: 78px; background: rgba(255,210,63,.28); border-color: #ffd23f; }
.kt-chip { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); pointer-events: auto; padding: 6px 12px; border-radius: 999px; background: rgba(10,14,30,.55); color: #fff; border: 1px solid rgba(255,255,255,.2); font-size: 12px; font-weight: 700; display: none; }
.kt.touch .kt-tools { bottom: auto; top: calc(var(--kt-top, 0px) + 126px); left: 8px; right: auto; transform: none; flex-direction: column; }
.kt.touch .kt-ico { min-width: 36px; height: 36px; padding: 0 8px; }
.kt.touch .kt-speed { display: none; }
.kt:not(.touch) .kt-touch { display: none; }
.kt.touch.autogas .kt-b-gas { display: none; } .kt.touch.autogas .kt-b-brake { right: 24px; bottom: 24px; width: 92px; height: 92px; }
.kt.touch.autogas .kt-b-item { right: 126px; bottom: 36px; } .kt.touch.autogas .kt-b-drift { right: 40px; bottom: 138px; }
.kt.touch .kt-chip { display: block; }

@media (max-width: 760px), (max-height: 520px) {
  .kt-item { width: 56px; height: 56px; left: 8px; top: calc(var(--kt-top, 0px) + 8px); } .kt-item svg { width: 40px; height: 40px; }
  .kt-pos { font-size: 44px; left: 10px; top: calc(var(--kt-top, 0px) + 70px); } .kt-pos span { font-size: 18px; }
  .kt-board { display: none; }
  .kt-map { width: 100px; height: 100px; right: 8px; top: calc(var(--kt-top, 0px) + 8px); }
  .kt-top { padding: 4px 12px; top: calc(var(--kt-top, 0px) + 6px); } .kt-lap { font-size: 12px; } .kt-lap b { font-size: 17px; } .kt-time { font-size: 17px; }
  .kt-msg { font-size: 28px; } .kt-count { font-size: 110px; }
  .kt-tr svg { height: 54px; } .kt-card { padding: 14px; } .kt-card h2 { font-size: 24px; }
  .kt-b-gas { width: 88px; height: 88px; } .kt-b-brake { right: 118px; width: 62px; height: 62px; } .kt-b-drift { width: 72px; height: 72px; bottom: 120px; } .kt-b-item { width: 66px; height: 66px; right: 108px; bottom: 86px; }
}
@media (max-width: 760px) { .kt-tracks { grid-template-columns: repeat(2, 1fr); } }
@media (max-height: 520px) { .kt.touch .kt-tools { top: calc(var(--kt-top, 0px) + 72px); } .kt-tracks { grid-template-columns: repeat(5, 1fr); gap: 6px; } .kt-tr { padding: 5px; } .kt-tr small, .kt-tr .rec { display: none; } .kt-tr svg { height: 40px; } .kt-tr b { font-size: 12px; } .kt-card .sub, .kt-help { display: none; } .kt-menu, .kt-result { padding-top: 8px; padding-bottom: 8px; } .kt-sec { margin: 8px 0 4px; } .kt-go { margin-top: 10px; padding: 10px; font-size: 18px; } }
`;

export const TEMPLATE = `
<div class="kt-view"></div>
<div class="kt-hud" hidden>
  <div class="kt-item kt-glass"><div class="ic"></div><kbd class="key">E</kbd><span class="n"></span><div class="l"></div></div>
  <div class="kt-pos"></div>
  <div class="kt-board"></div>
  <div class="kt-top kt-glass"><div class="kt-lap"></div><div class="kt-time">0:00.00</div><div class="kt-best"></div></div>
  <canvas class="kt-map kt-glass" width="300" height="300"></canvas>
  <div class="kt-speed kt-glass"><b>0</b><small>km/h</small><div class="bar"><i></i></div><div class="drift"><i></i></div></div>
  <div class="kt-msg"></div>
  <div class="kt-tools">
    <button class="kt-ico kt-glass" data-a="reset" title="Zurück auf die Strecke (R)">↺</button>
    <button class="kt-ico kt-glass" data-a="sound" title="Ton (M)">♪</button>
    <button class="kt-ico kt-glass" data-a="full" title="Vollbild (F)">⛶</button>
  </div>
</div>
<div class="kt-center" hidden></div>
<div class="kt-touch" hidden>
  <div class="kt-pad"><div class="hint">◀ ▶</div><div class="ring"></div><div class="knob"></div></div>
  <button class="kt-b kt-b-brake" data-k="brake">BREMSE</button>
  <button class="kt-b kt-b-gas" data-k="gas">GAS</button>
  <button class="kt-b kt-b-drift" data-k="drift">DRIFT</button>
  <button class="kt-b kt-b-item" data-k="item">ITEM</button>
  <button class="kt-chip" data-a="auto">Auto-Gas: an</button>
</div>
<div class="kt-menu" hidden></div>
<div class="kt-result" hidden></div>`;

// Minimap: Strecke einmal vorzeichnen, dann nur noch Punkte
export function makeMinimap(canvas, track) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, pad = 22;
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = W / 2 - ((minX + maxX) / 2) * sc, oz = H / 2 - ((minZ + maxZ) / 2) * sc;
  const px = (x) => ox + x * sc, pz = (z) => H - (oz + z * sc);     // z nach oben, damit „vorne“ der Karte oben ist
  const base = document.createElement("canvas"); base.width = W; base.height = H;
  const b = base.getContext("2d");
  b.lineJoin = "round"; b.lineCap = "round";
  const path = () => { b.beginPath(); for (let i = 0; i <= track.N; i++) { const k = i % track.N; i ? b.lineTo(px(track.cx[k]), pz(track.cz[k])) : b.moveTo(px(track.cx[k]), pz(track.cz[k])); } b.closePath(); };
  b.strokeStyle = "rgba(255,255,255,.9)"; b.lineWidth = 17; path(); b.stroke();
  b.strokeStyle = "#2b2f44"; b.lineWidth = 11; path(); b.stroke();
  // Ziellinie
  const sx = px(track.cx[0]), sz = pz(track.cz[0]);
  b.strokeStyle = "#fff"; b.lineWidth = 4; b.beginPath();
  b.moveTo(sx - track.rx[0] * 9, sz + track.rz[0] * 9); b.lineTo(sx + track.rx[0] * 9, sz - track.rz[0] * 9); b.stroke();
  return {
    draw(karts) {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);
      for (const k of karts.slice().sort((a, c) => (a.me ? 1 : 0) - (c.me ? 1 : 0))) {
        ctx.fillStyle = k.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = k.me ? 4 : 3;
        ctx.beginPath(); ctx.arc(px(k.x), pz(k.z), k.me ? 11 : 8, 0, 7); ctx.fill(); ctx.stroke();
      }
    },
  };
}

// SVG-Umriss für Streckenkarten im Menü
export function trackSvg(track, color = "#fff") {
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const w = maxX - minX, h = maxZ - minZ, sc = Math.min(160 / w, 80 / h);
  const pts = [];
  for (let i = 0; i < track.N; i += 6) pts.push(((track.cx[i] - (minX + maxX) / 2) * sc + 90).toFixed(1) + "," + (-(track.cz[i] - (minZ + maxZ) / 2) * sc + 45).toFixed(1));
  return `<svg viewBox="0 0 180 90"><polygon points="${pts.join(" ")}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="9" stroke-linejoin="round"/><polygon points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round"/></svg>`;
}
