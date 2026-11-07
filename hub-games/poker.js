// Poker (Texas Hold'em) for the multiplayer hub.
//
// 2–6 players, everybody starts with 1000 chips, blinds 10/20. Two private hole cards, five community
// cards (flop, turn, river), betting rounds in between: fold, check/call, raise or go all-in. Best five
// of seven cards wins; side pots are handled. Whoever keeps all the chips wins the match.
//
// Look: a tilted felt table in 3D (CSS perspective) with a wooden rim; cards are real two-sided 3D
// objects that fly from the deck and flip over; chips are stacked discs that slide into the pot and
// back to the winner. My hole cards sit big below the table and tilt towards the pointer.
//
// The host's client owns the deck and the rules. Guests send intents ("act"), the host broadcasts the
// public state (never the hole cards) and privately sends each player their own two cards. A host
// change voids the running hand: bets are returned, the old pot is split between the players still in.

import { shell } from "../hub-kit.js";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const START = 1000, SB = 10, BB = 20;
const NEXT_MS = 9000;                       // pause after a hand before the next one is dealt
const TURN_MS = 45000;                      // time to act before the host acts for you

// ---- cards: 0..51, rank = c % 13 (0 = deuce … 12 = ace), suit = floor(c / 13) ----
const RK = "23456789TJQKA";
const SUITS = ["♠", "♥", "♦", "♣"];
const rankOf = (c) => c % 13;
const suitOf = (c) => Math.floor(c / 13);
const isCard = (c) => Number.isInteger(c) && c >= 0 && c < 52;
const rkTxt = (c) => (RK[rankOf(c)] === "T" ? "10" : RK[rankOf(c)]);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---- hand evaluation: score of five cards = category * 13^5 + tiebreak ranks in base 13 ----
const CATS = ["Hohe Karte", "Paar", "Zwei Paare", "Drilling", "Straße", "Flush", "Full House", "Vierling", "Straight Flush"];
function score5(cs) {
  const rs = cs.map(rankOf).sort((a, b) => b - a);
  const flush = cs.every((c) => suitOf(c) === suitOf(cs[0]));
  const cnt = {};
  for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  let straightHigh = -1;
  if (groups.length === 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 12 && rs[1] === 3) straightHigh = 3;      // wheel A-2-3-4-5
  }
  let cat, tb;
  if (straightHigh >= 0 && flush) { cat = 8; tb = [straightHigh]; }
  else if (cnt[groups[0]] === 4) { cat = 7; tb = groups; }
  else if (cnt[groups[0]] === 3 && cnt[groups[1]] === 2) { cat = 6; tb = groups; }
  else if (flush) { cat = 5; tb = rs; }
  else if (straightHigh >= 0) { cat = 4; tb = [straightHigh]; }
  else if (cnt[groups[0]] === 3) { cat = 3; tb = groups; }
  else if (cnt[groups[0]] === 2 && cnt[groups[1]] === 2) { cat = 2; tb = groups; }
  else if (cnt[groups[0]] === 2) { cat = 1; tb = groups; }
  else { cat = 0; tb = rs; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 13 + (tb[i] || 0);
  return s;
}
function best7(cards) {
  let best = -1, five = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) for (let b = a + 1; b < n - 3; b++) for (let c = b + 1; c < n - 2; c++)
    for (let d = c + 1; d < n - 1; d++) for (let e = d + 1; e < n; e++) {
      const f = [cards[a], cards[b], cards[c], cards[d], cards[e]], s = score5(f);
      if (s > best) { best = s; five = f; }
    }
  return { score: best, cat: Math.floor(best / 13 ** 5), five };
}
function handName(b) {
  if (b.cat === 8 && b.five.some((c) => rankOf(c) === 12) && b.five.some((c) => rankOf(c) === 11)) return "Royal Flush";
  return CATS[b.cat];
}

// ---- chips ----
const DENOM = [[500, "#7b4bd6", "#fff"], [100, "#25272e", "#fff"], [25, "#2f9147", "#fff"], [5, "#d93a2b", "#fff"], [1, "#ecebf2", "#333"]];
function chipsOf(amount, max = 7) {
  const out = [];
  let a = Math.max(0, Math.floor(amount));
  for (const [v, c, t] of DENOM) while (a >= v && out.length < max) { out.push([c, t]); a -= v; }
  return out;
}
const chipHTML = (amount, max) => `<span class="ch-stack">${chipsOf(amount, max).map(([c, t], i) =>
  `<i class="ch" style="--c:${c};--t:${t};--n:${i}"></i>`).join("")}</span>`;

const CSS = `
.hub-stage.hub-poker { padding: 0; border: 0; background: none; box-shadow: none; }
.pk { position: relative; display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; outline: none; }
.pk-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: min(820px, 100%); }
.pk-meta { font: 600 13px var(--font); color: var(--muted); }
.pk-snd { flex: none; padding: 6px 12px !important; font-size: 12px !important; opacity: .85; }

/* ---- the scene: perspective + tilted felt ---- */
.pk-scene { position: relative; width: min(820px, 100%); aspect-ratio: 1.62; container-type: inline-size;
  perspective: 1300px; perspective-origin: 50% 20%; border-radius: 22px; overflow: hidden;
  background: repeating-linear-gradient(92deg, rgba(0,0,0,.16) 0 2px, transparent 2px 64px), radial-gradient(ellipse 95% 90% at 50% 45%, #4a2c18 0%, #2c190c 62%, #170c05 100%);
  box-shadow: var(--wrap-shadow), 0 0 0 var(--border-w) var(--hairline); }
.pk-felt { position: absolute; left: 3%; right: 3%; top: 7%; bottom: 17%; transform-style: preserve-3d;
  transform: rotateX(36deg); transform-origin: 50% 60%; }
.pk-rim { position: absolute; inset: 0; border-radius: 50%;
  background: repeating-linear-gradient(97deg, rgba(40,20,6,.28) 0 1px, transparent 1px 9px), repeating-linear-gradient(83deg, rgba(255,214,150,.07) 0 2px, transparent 2px 23px), linear-gradient(160deg, #a5733f, #6b4528 48%, #432712);
  box-shadow: 0 3cqw 4cqw rgba(0, 0, 0, .65), inset 0 .5cqw 1cqw rgba(255, 220, 170, .35), inset 0 -1cqw 1.4cqw rgba(0, 0, 0, .55);
  transform: translateZ(-1.4cqw); }
.pk-cloth { position: absolute; inset: 3.2cqw; border-radius: 50%; overflow: hidden;
  background: radial-gradient(75% 70% at 50% 42%, #24774d 0%, #1b5a3a 58%, #10402a 100%);
  box-shadow: inset 0 0 3cqw rgba(0, 0, 0, .6), inset 0 0 0 .35cqw rgba(255, 255, 255, .12); }
.pk-cloth::after { content: ""; position: absolute; inset: 0; opacity: .35; mix-blend-mode: multiply;
  background-image: radial-gradient(rgba(0, 0, 0, .55) 1px, transparent 1.3px); background-size: 7px 7px; }
.pk-cloth::before { content: ""; position: absolute; inset: 6.5%; border-radius: 50%; border: .22cqw solid rgba(255, 214, 110, .28); }
.pk-logo { position: absolute; left: 0; right: 0; top: 56%; text-align: center; font: 400 5cqw/1 "Caveat Brush", "Caveat", Georgia, cursive;
  letter-spacing: .18em; color: rgba(255, 226, 150, .13); text-transform: uppercase; pointer-events: none; }

.pk-layer { position: absolute; inset: 0; font-family: Georgia, "Times New Roman", serif; --cw: 7.4cqw; font-size: clamp(10px, 1.7cqw, 15px); }
.pk-layer > * { position: absolute; }

/* ---- 3D cards ---- */
.pcard { position: relative; display: inline-block; width: var(--cw); height: calc(var(--cw) / .7); flex: none; perspective: 700px; user-select: none; -webkit-user-select: none; }
.pc-in { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform .6s cubic-bezier(.3, 1.2, .5, 1); }
.pcard.down .pc-in { transform: rotateY(180deg); }
.pc-f { position: absolute; inset: 0; border-radius: 9%; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden;
  box-shadow: 0 .5cqw 1.2cqw rgba(0, 0, 0, .45); }
.pc-f.fr { background: linear-gradient(160deg, #fbf6e8, #ece6d6); color: #2a170a; border: 1px solid #cdbf9f; }
.pc-f.fr.red { color: #cf2f2a; }
.pc-f.bk { transform: rotateY(180deg); border: calc(var(--cw) * .06) solid #fff;
  background: repeating-linear-gradient(45deg, #274a9c 0 6px, #1d3a82 6px 12px); }
.pc-f.bk::after { content: "♠"; position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, .55); font-size: calc(var(--cw) * .45); }
.pc-c { position: absolute; top: 5%; left: 9%; font: 800 calc(var(--cw) * .27)/1 var(--font); font-style: normal; text-align: center; }
.pc-c.b { top: auto; left: auto; bottom: 5%; right: 9%; transform: rotate(180deg); }
.pc-big { position: absolute; inset: 0; display: grid; place-items: center; font: 400 calc(var(--cw) * .62)/1 serif; }
.pcard.deal .pc-in { animation: pk-deal .75s cubic-bezier(.2, .9, .3, 1) backwards; animation-delay: var(--dl, 0s); }
.pcard.flipin .pc-in { animation: pk-flip .7s cubic-bezier(.3, 1.1, .4, 1) backwards; animation-delay: var(--dl, 0s); }
@keyframes pk-deal { 0% { transform: translate(var(--fx, -20cqw), var(--fy, -6cqw)) rotateY(180deg) rotateZ(-240deg) scale(.55); opacity: 0; } 15% { opacity: 1; } 100% { transform: none; } }
@keyframes pk-flip { from { transform: rotateY(180deg) translateZ(2cqw); } to { transform: none; } }
.pcard.win .pc-f.fr { box-shadow: 0 0 0 .35cqw #ffd94d, 0 0 2.2cqw #ffd94d; }

/* ---- seats ---- */
.pk-seat { transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: .5cqw; z-index: 3; transition: opacity .3s, filter .3s; }
.pk-seat .pk-cards { display: flex; --cw: 4.6cqw; margin-bottom: -1.2cqw; z-index: 1; }
.pk-seat .pk-cards .pcard + .pcard { margin-left: -1.4cqw; }
.pk-seat .pk-cards .pcard:nth-child(1) { transform: rotate(-7deg); } .pk-seat .pk-cards .pcard:nth-child(2) { transform: rotate(7deg) translateY(.2cqw); }
.pk-plate { position: relative; display: flex; align-items: center; gap: .9cqw; padding: .55cqw 1.7cqw .55cqw .6cqw; border-radius: 999px;
  background: linear-gradient(#6b4528, #3f2616); border: .2cqw solid #c99a4a; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .18), 0 .5cqw 0 #1b0e06, 0 1cqw 1.6cqw rgba(0, 0, 0, .5); color: #f6e7b4; white-space: nowrap; z-index: 2; }
.pk-seat.me .pk-plate { border-color: #ffe08a; background: linear-gradient(#85592f, #4f301a); }
.pk-seat.turn .pk-plate { border-color: #7dffb0; box-shadow: 0 0 0 .3cqw rgba(125, 255, 176, .35), 0 0 2.4cqw rgba(125, 255, 176, .7); animation: pk-glow 1.2s ease-in-out infinite; }
@keyframes pk-glow { 50% { box-shadow: 0 0 0 .5cqw rgba(125, 255, 176, .2), 0 0 3.4cqw rgba(125, 255, 176, .9); } }
.pk-seat.win .pk-plate { border-color: #ffd94d; box-shadow: 0 0 0 .4cqw rgba(255, 217, 77, .5), 0 0 3cqw rgba(255, 217, 77, .95); animation: pk-bounce .8s ease-in-out 3; }
@keyframes pk-bounce { 50% { transform: translateY(-.8cqw) scale(1.06); } }
.pk-seat.fold { opacity: .45; filter: grayscale(.7); } .pk-seat.sit { opacity: .3; filter: grayscale(1); }
.pk-av { position: relative; width: 4.6cqw; height: 4.6cqw; min-width: 28px; min-height: 28px; flex: none; border-radius: 50%; overflow: hidden; border: .2cqw solid #fff;
  display: grid; place-items: center; font: 800 1.9cqw var(--font); color: #fff; background: #667; }
.pk-av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pk-nm { display: flex; flex-direction: column; line-height: 1.15; max-width: 12cqw; }
.pk-nm span { overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
.pk-nm b { color: #ffe08a; font-variant-numeric: tabular-nums; font-size: .95em; }
.pk-tag { position: absolute; top: -1cqw; right: -.4cqw; font: 800 1.15cqw/1 var(--font); padding: .35cqw .8cqw; border-radius: 999px; background: #eea41c; color: #3c2a05; font-style: normal; }
.pk-tag.allin { background: #e0473a; color: #fff; left: 50%; right: auto; transform: translateX(-50%); animation: pk-pop .35s cubic-bezier(.2, 1.6, .4, 1); }
.pk-tag.act { background: #fdf6e8; color: #333; left: 50%; right: auto; top: auto; bottom: -1.2cqw; transform: translateX(-50%); }
.pk-dealer { position: absolute; left: -1.6cqw; bottom: -.6cqw; width: 2.6cqw; height: 2.6cqw; min-width: 20px; min-height: 20px; border-radius: 50%; background: radial-gradient(#fff, #ddd); color: #222;
  display: grid; place-items: center; font: 800 1.4cqw var(--font); font-style: normal; border: .15cqw solid #999; box-shadow: 0 .3cqw .8cqw rgba(0, 0, 0, .5); }
@keyframes pk-pop { from { transform: translateX(-50%) scale(0); } }
.pk-timer { position: absolute; left: 12%; right: 12%; bottom: -.4cqw; height: .45cqw; border-radius: 9px; background: rgba(255, 255, 255, .15); overflow: hidden; z-index: 3; }
.pk-timer i { display: block; height: 100%; background: #7dffb0; transform-origin: 0 50%; animation: pk-timer linear forwards; animation-duration: var(--t, 45s); }
@keyframes pk-timer { to { transform: scaleX(0); background: #e0473a; } }

/* ---- chips (stacked discs) ---- */
.ch-stack { position: relative; display: inline-block; width: 3.4cqw; height: 2.1cqw; }
.ch { position: absolute; left: 0; bottom: 0; width: 3.4cqw; height: 2cqw; border-radius: 50%; transform: translateY(calc(var(--n) * -.42cqw));
  background: radial-gradient(ellipse at 50% 50%, var(--c) 0 38%, #fff 39% 44%, var(--c) 45%);
  box-shadow: 0 .38cqw 0 color-mix(in srgb, var(--c) 55%, #000), 0 .5cqw .5cqw rgba(0, 0, 0, .35); border: .12cqw dashed rgba(255, 255, 255, .55); box-sizing: border-box; }
.pk-bet { transform: translate(-50%, -50%); display: flex; align-items: center; gap: .7cqw; z-index: 2; animation: pk-toss .45s cubic-bezier(.2, 1, .3, 1) backwards; }
.pk-bet b { padding: .2cqw .8cqw; border-radius: 999px; background: rgba(0, 0, 0, .55); color: #fff; font-variant-numeric: tabular-nums; font-size: .95em; }
@keyframes pk-toss { from { transform: translate(calc(-50% + var(--tx, 0cqw)), calc(-50% + var(--ty, 0cqw))) scale(.4); opacity: 0; } }
.pk-pot { left: 69%; top: 31%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: .9cqw; z-index: 2; }
.pk-pot .ch-stack { width: 3.4cqw; }
.pk-pot b { padding: .35cqw 1.2cqw; border-radius: 999px; background: rgba(0, 0, 0, .55); color: #ffd94d; font-size: 1.1em; font-variant-numeric: tabular-nums; }
.pk-pot small { color: rgba(255, 255, 255, .7); font-size: .78em; letter-spacing: .12em; text-transform: uppercase; margin-right: -.3cqw; }
.ch.fly { position: absolute; z-index: 20; pointer-events: none; }

/* ---- board & deck ---- */
.pk-deck { left: 21%; top: 44%; transform: translate(-50%, -50%); --cw: 6cqw; width: var(--cw); height: calc(var(--cw) / .7); }
.pk-deck .pcard { position: absolute; left: 0; top: 0; }
.pk-deck .pcard:nth-child(2) { transform: translate(.35cqw, -.35cqw); } .pk-deck .pcard:nth-child(3) { transform: translate(.7cqw, -.7cqw); }
.pk-board { left: 50%; top: 46%; transform: translate(-50%, -50%) perspective(60cqw) rotateX(14deg); display: flex; gap: 1.1cqw; z-index: 2; }
.pk-board .slot { position: relative; width: var(--cw); height: calc(var(--cw) / .7); border-radius: 9%; border: .25cqw dashed rgba(255, 255, 255, .22); background: rgba(0, 0, 0, .12); flex: none; }
.pk-board .slot .pcard { position: absolute; inset: 0; }

/* ---- result banner ---- */
.pk-res { left: 50%; top: 71%; transform: translate(-50%, -50%); z-index: 6; display: flex; flex-direction: column; align-items: center; gap: .6cqw; padding: 1.1cqw 2.6cqw;
  border-radius: 1.8cqw; background: linear-gradient(#3b2516ee, #20120aee); border: .25cqw solid #c99a4a; box-shadow: 0 2cqw 5cqw rgba(0, 0, 0, .65), inset 0 0 0 .5cqw rgba(0, 0, 0, .25); color: #ecdab0; text-align: center; animation: pk-banner .5s cubic-bezier(.2, 1.4, .4, 1); }
.pk-res[hidden] { display: none; }
.pk-res h3 { margin: 0; font: 400 4.2cqw/1.05 "Caveat Brush", "Caveat", Georgia, cursive; color: #ffe08a; text-shadow: 0 .3cqw 0 #7d4d0c, 0 1cqw 2cqw rgba(0, 0, 0, .5); }
.pk-res p { margin: 0; font-size: 1.05em; line-height: 1.35; } .pk-res p em { font-style: normal; color: #ffe6a6; font-weight: 700; }
.pk-res .pk-nextbtn { margin-top: .4cqw; }
@keyframes pk-banner { from { transform: translate(-50%, -30%) scale(.6); opacity: 0; } }

/* ---- status, actions, my hole cards ---- */
.pk-status { font-size: 16px; min-height: 26px; text-align: center; color: var(--muted); }
.pk-status.mine { color: var(--ink); font-weight: 700; }
.pk-note { margin: -4px 0 0; font-size: 13px; color: var(--dim); min-height: 18px; text-align: center; }
.pk-act { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; min-height: 56px; width: min(820px, 100%); }
.pk-act button { flex: none; padding: 11px 24px; font: 700 15px Georgia, serif; letter-spacing: .08em; border-radius: 999px; border: 1px solid #c99a4a; color: #f6e7b4 !important; background: linear-gradient(#70492a, #3b2314) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .2), 0 5px 0 #1b0e06, 0 12px 20px rgba(0, 0, 0, .45); transition: transform .08s, filter .2s; }
.pk-act .b-call, .pk-act .b-raise, .pk-act .b-next { color: #3d2106 !important; border-color: #fff0b8; background: linear-gradient(#ffe69a, #e2a42a) !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .7), 0 5px 0 #7d4d0c, 0 12px 20px rgba(0, 0, 0, .5); }
.pk-act .b-fold { border-color: #b4563f; }
.pk-act button:hover { filter: brightness(1.1); }
.pk-act button:active { transform: translateY(3px); box-shadow: 0 2px 0 #1b0e06; }
.pk-act button:disabled { opacity: .5; cursor: default; transform: none; }
.pk-raise { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; padding: 6px 12px; border-radius: 16px; background: linear-gradient(#3b2516, #24150c); border: 1px solid #c99a4a; color: #f6e7b4; }
.pk-raise input[type=range] { width: 160px; accent-color: #d18a0d; }
.pk-raise output { min-width: 56px; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
.pk-raise .q { padding: 5px 10px !important; font-size: 12px !important; letter-spacing: 0 !important; box-shadow: 0 3px 0 #1b0e06 !important; }

.pk-hole { --cw: 96px; display: flex; justify-content: center; gap: 14px; min-height: calc(var(--cw) / .7 + 8px); perspective: 900px; padding-top: 4px; --tx: 0deg; --ty: 0deg; }
.pk-hole .pcard { transform: rotateX(var(--ty)) rotateY(var(--tx)) rotateZ(var(--rz, 0deg)); transition: transform .15s ease-out, filter .3s; transform-style: preserve-3d; }
.pk-hole .pcard:nth-child(1) { --rz: -5deg; } .pk-hole .pcard:nth-child(2) { --rz: 5deg; }
.pk-hole .pcard:hover { transform: translateY(-8px) rotateX(var(--ty)) rotateY(var(--tx)) rotateZ(0deg); }
/* "Karten verstecken": face down, only a faint peek while hovering / touching */
.pk-hole.hide .pcard .pc-in { transform: rotateY(180deg); }
.pk-hole.hide .pcard:hover .pc-in, .pk-hole.hide .pcard:active .pc-in { transform: rotateY(0deg); }
.pk-holerow { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.pk-eye { justify-self: start; margin-left: 14px; width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 2px solid #c99a4a; background: linear-gradient(#6b4528, #3f2616); color: #f3dba0; cursor: pointer; display: grid; place-items: center; }
.pk-eye svg { width: 22px; height: 22px; }
.pk-eye[aria-pressed="true"] { color: #ffd94d; background: linear-gradient(#85592f, #4f301a); }
.pk-hole.hide .pcard:hover { transform: rotateX(var(--ty)) rotateY(var(--tx)) rotateZ(var(--rz, 0deg)); }
.pk-hole.fold .pcard { filter: grayscale(1) brightness(.6); }
.pk-hole .pc-f { box-shadow: 0 8px 20px rgba(0, 0, 0, .45); }

@media (max-width: 640px) {
  .pk-scene { aspect-ratio: 1.02; } .pk-felt { top: 9%; bottom: 20%; transform: rotateX(26deg); }
  .pk-layer { --cw: 11.5cqw; font-size: 11px; } .pk-seat .pk-cards { --cw: 8cqw; margin-bottom: -2cqw; } .pk-seat .pk-cards .pcard + .pcard { margin-left: -2.6cqw; }
  .pk-deck { --cw: 9cqw; left: 17%; } .pk-board { gap: 1.4cqw; } .pk-pot { left: 74%; top: 27%; }
  .ch-stack, .ch { width: 5.4cqw; } .ch { height: 3.2cqw; } .ch-stack { height: 3.4cqw; } .ch { transform: translateY(calc(var(--n) * -.7cqw)); }
  .pk-plate { padding: .8cqw 2.4cqw .8cqw .8cqw; } .pk-av { width: 8cqw; height: 8cqw; min-width: 26px; min-height: 26px; } .pk-nm { max-width: 20cqw; font-size: 11px; }
  .pk-res { top: 72%; padding: 6px 14px; } .pk-res h3 { font-size: 14px; }
  .pk-hole { --cw: 70px; gap: 10px; } .pk-status { font-size: 14px; min-height: 40px; }
  .pk-av { width: 6cqw; height: 6cqw; } .pk-nm { max-width: 16cqw; } .pk-plate { font-size: 9px; }
  .pk-raise input[type=range] { width: 120px; }
}
@media (prefers-reduced-motion: reduce) {
  .pcard.deal .pc-in, .pcard.flipin .pc-in, .pk-seat.turn .pk-plate, .pk-seat.win .pk-plate, .pk-bet, .pk-res { animation: none; }
  .pc-in, .pk-felt { transition: none; }
}
`;

// a state that came over the wire is rebuilt from scratch before it is used
function clean(d, ids) {
  if (!d || typeof d !== "object") return null;
  const ok = (x) => ids.has(x);
  const order = Array.isArray(d.order) ? d.order.filter(ok) : [];
  if (order.length < 2) return null;
  const num = (v, lo = 0, hi = 1e9) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo);
  const map = (m, f) => { const o = {}; if (m && typeof m === "object") for (const k of ids) if (k in m) o[k] = f(m[k]); return o; };
  const flag = (m) => { const o = {}; if (m && typeof m === "object") for (const k of ids) if (m[k]) o[k] = 1; return o; };
  const cards = (a, n) => (Array.isArray(a) ? a.filter(isCard).slice(0, n) : []);
  return {
    phase: ["wait", "bet", "show", "over"].includes(d.phase) ? d.phase : "wait",
    order, hand: num(d.hand, 0, 99999), street: num(d.street, 0, 3),
    dealer: ok(d.dealer) ? d.dealer : null, sb: ok(d.sb) ? d.sb : null, bb: ok(d.bb) ? d.bb : null,
    chips: map(d.chips, (v) => num(v)), bets: map(d.bets, (v) => num(v)),
    pot: num(d.pot), cur: num(d.cur), minRaise: num(d.minRaise, 1),
    board: cards(d.board, 5), turn: ok(d.turn) ? d.turn : null, tms: num(d.tms, 0, 600000),
    fold: flag(d.fold), allin: flag(d.allin), sit: flag(d.sit), gone: flag(d.gone),
    shown: map(d.shown, (v) => cards(v, 2)),
    names: map(d.names, (v) => String(v).slice(0, 40)),
    results: Array.isArray(d.results) ? d.results.slice(0, 8).map((r) => ({
      ids: Array.isArray(r.ids) ? r.ids.filter(ok) : [], amt: num(r.amt), name: String(r.name || "").slice(0, 40), win: cards(r.win, 5),
    })) : [],
    last: map(d.last, (v) => String(v).slice(0, 20)),
    winner: ok(d.winner) ? d.winner : null,
    note: typeof d.note === "string" ? d.note.slice(0, 200) : "",
  };
}

export default {
  min: 2, max: 6,

  mount(ctx) {
    const kit = shell(ctx, { title: "Poker" }), root = kit.body;
    const info = Object.fromEntries(ctx.players.map((p) => [p.id, p]));
    const names = Object.fromEntries(ctx.players.map((p) => [p.id, p.name]));
    const ids = new Set(Object.keys(names));
    const me = () => ctx.me.id;
    const nm = (id) => esc(names[id] || "?") + (id === me() ? " (du)" : "");
    const pn = (id) => names[id] || "?";

    let st = {
      phase: "wait", order: ctx.players.map((p) => p.id), hand: 0, street: 0, dealer: null, sb: null, bb: null,
      chips: Object.fromEntries(ctx.players.map((p) => [p.id, START])), bets: {}, pot: 0, cur: 0, minRaise: BB,
      board: [], turn: null, tms: 0, fold: {}, allin: {}, sit: {}, gone: {}, shown: {}, names: {}, results: [], last: {}, winner: null, note: "",
    };

    // ---- host-only engine state ----
    let deck = [], hole = {}, contrib = {}, acted = {};
    let turnTimer = 0, nextTimer = 0, runTimer = 0;
    // ---- my private view ----
    let myHole = [], myHoleH = -1, myRaise = 0, raiseFor = "";

    // ---- sound ----
    let sound = true;
    try { sound = localStorage.getItem("pk_sound") !== "0"; } catch {}
    let AC = null;
    const ac = () => {
      if (!sound) return null;
      if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
      if (AC && AC.state === "suspended") { try { AC.resume(); } catch {} }
      return AC;
    };
    function tone(f, t0, dur, type = "triangle", vol = 0.04) {
      const c = ac(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, c.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.02);
    }
    const snd = {
      deal: () => { tone(900, 0, 0.04, "square", 0.02); tone(1200, 0.04, 0.05, "square", 0.015); },
      chip: () => { tone(1800, 0, 0.03, "square", 0.02); tone(2300, 0.03, 0.04, "square", 0.015); tone(1500, 0.07, 0.05, "square", 0.012); },
      check: () => { tone(220, 0, 0.06, "sine", 0.08); tone(180, 0.07, 0.06, "sine", 0.06); },
      fold: () => { tone(500, 0, 0.1, "sine", 0.03); tone(380, 0.08, 0.14, "sine", 0.03); },
      turn: () => { tone(660, 0, 0.1); tone(880, 0.09, 0.14); },
      win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.26)),
    };

    // ---- DOM ----
    const styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
    root.innerHTML = `<div class="pk" tabindex="-1">
      <div class="pk-head"><span class="pk-meta"></span></div>
      <div class="pk-scene">
        <div class="pk-felt"><div class="pk-rim"></div><div class="pk-cloth"><div class="pk-logo">Hold'em</div></div></div>
        <div class="pk-layer">
          <div class="pk-deck"></div>
          <div class="pk-pot"></div>
          <div class="pk-board"></div>
          <div class="pk-res" hidden></div>
        </div>
      </div>
      <div class="pk-status" aria-live="polite"></div>
      <p class="pk-note"></p>
      <div class="pk-act"></div>
      <div class="pk-holerow"><span></span><div class="pk-hole"></div><button type="button" class="pk-eye"></button></div>
    </div>`;
    const rootEl = root.firstElementChild;
    const $ = (s) => rootEl.querySelector(s);
    const headEl = $(".pk-head"), metaEl = $(".pk-meta"), sceneEl = $(".pk-scene"), layerEl = $(".pk-layer"),
      deckEl = $(".pk-deck"), potEl = $(".pk-pot"), boardEl = $(".pk-board"), resEl = $(".pk-res"),
      statusEl = $(".pk-status"), noteEl = $(".pk-note"), actEl = $(".pk-act"), holeEl = $(".pk-hole");

    // ---- card html ----
    function faceHTML(c) {
      const s = SUITS[suitOf(c)], red = suitOf(c) === 1 || suitOf(c) === 2;
      return `<span class="pc-f fr${red ? " red" : ""}"><i class="pc-c">${rkTxt(c)}<br>${s}</i><i class="pc-c b">${rkTxt(c)}<br>${s}</i><b class="pc-big">${s}</b></span>`;
    }
    // c = null → card back only
    const cardHTML = (c, { down = false, cls = "", style = "" } = {}) =>
      `<span class="pcard${down || c == null ? " down" : ""} ${cls}" style="${style}"><span class="pc-in">${c == null ? "" : faceHTML(c)}<span class="pc-f bk"></span></span></span>`;

    const avHTML = (id) => {
      const p = info[id] || {};
      const init = esc((pn(id)[0] || "?").toUpperCase());
      const img = p.avatar ? `<img src="/avatar/${esc(p.avatar)}" alt="" draggable="false">` : "";
      return `<span class="pk-av" style="background:${esc(p.color || "#6a5f8a")}">${p.avatar ? "" : init}${img}</span>`;
    };

    // keyed list of elements: only touches an element when its signature changed
    function sync(parent, items) {
      const map = parent._m || (parent._m = new Map());
      const seen = new Set();
      for (const it of items) {
        seen.add(it.k);
        let el = map.get(it.k);
        if (!el) { el = document.createElement("div"); map.set(it.k, el); parent.appendChild(el); el._s = null; }
        if (el._s !== it.sig) {
          el._s = it.sig; el.className = it.cls; el.style.cssText = it.style || ""; el.innerHTML = it.html;
        }
      }
      for (const [k, el] of map) if (!seen.has(k)) { el.remove(); map.delete(k); }
    }

    // ---- positions ----
    const seatPos = (rel, n) => {
      const a = ((90 + (rel * 360) / n) * Math.PI) / 180;
      return { x: 50 + 41 * Math.cos(a), y: 49 + 37 * Math.sin(a) };
    };

    // ---- animation bookkeeping ----
    let seenHand = -1, seenBoard = 0, seenDeal = {}, seenShow = {}, lastBets = {};

    // ---- rendering ----
    const seated = () => st.order.filter((id) => !st.gone[id]);
    const myTurn = () => st.phase === "bet" && st.turn === me();

    function paint() {
      if (st.hand !== seenHand) { seenHand = st.hand; seenBoard = 0; seenDeal = {}; seenShow = {}; lastBets = {}; }
      const list = seated();
      const mi = Math.max(0, list.indexOf(me()));
      const N = list.length;

      metaEl.textContent = st.hand ? `Hand ${st.hand} · Blinds ${SB}/${BB}` : `Texas Hold'em · ${SB}/${BB}`;

      // deck decoration
      if (!deckEl.firstChild) deckEl.innerHTML = cardHTML(null) + cardHTML(null) + cardHTML(null);
      deckEl.style.display = st.phase === "wait" || st.phase === "over" ? "none" : "";

      // seats + bets
      const seatItems = [], betItems = [];
      const winIds = new Set(st.phase === "show" || st.phase === "over" ? st.results.flatMap((r) => r.ids) : []);
      list.forEach((id, i) => {
        const rel = (i - mi + N) % N, pos = seatPos(rel, N), isMe = id === me();
        const folded = !!st.fold[id], sit = !!st.sit[id];
        const showCards = st.shown[id] && st.shown[id].length === 2 ? st.shown[id] : null;
        const dealt = st.phase !== "wait" && !sit && st.phase !== "over";
        const first = !seenDeal[id] && dealt;
        if (dealt) seenDeal[id] = 1;
        const flipNew = showCards && !seenShow[id];
        if (showCards) seenShow[id] = 1;
        let cards = "";
        if (!isMe && dealt && !(folded && !showCards)) {
          const di = ((i - (st.order.indexOf(st.dealer) < 0 ? 0 : list.indexOf(st.dealer)) + N) % N);
          cards = showCards
            ? showCards.map((c, k) => cardHTML(c, { cls: (flipNew ? "flipin " : "") + (winCard(id, c) ? "win" : ""), style: `--dl:${k * 0.12}s` })).join("")
            : [0, 1].map((k) => cardHTML(null, { cls: first ? "deal" : "", style: `--dl:${(di % N) * 0.05 + k * 0.18 + i * 0.12}s;--fx:${(50 - pos.x) * 0.6}cqw;--fy:${(40 - pos.y) * 0.6}cqw` })).join("");
        }
        const tag = st.allin[id] && !folded ? `<u class="pk-tag allin">ALL-IN</u>`
          : (st.last[id] && !folded && ((st.phase === "bet" && st.turn !== id) || (st.phase !== "bet" && showCards)) ? `<u class="pk-tag act">${esc(st.last[id])}</u>` : "");
        const blind = id === st.sb ? "SB" : id === st.bb ? "BB" : "";
        const timer = st.phase === "bet" && st.turn === id && st.tms ? `<span class="pk-timer"><i style="--t:${st.tms}ms"></i></span>` : "";
        const cls = ["pk-seat", isMe ? "me" : "", st.turn === id && st.phase === "bet" ? "turn" : "", folded ? "fold" : "", sit ? "sit" : "", winIds.has(id) ? "win" : ""].join(" ");
        seatItems.push({
          k: "s" + id, cls, style: `left:${pos.x}%;top:${pos.y}%`,
          sig: [cls, pos.x, st.chips[id], cards.length, showCards ? 1 : 0, tag, blind, st.dealer === id, st.tms, st.turn === id].join("|"),
          html: `<div class="pk-cards">${cards}</div>
            <div class="pk-plate">${avHTML(id)}<span class="pk-nm"><span>${nm(id)}</span><b>${st.chips[id] ?? 0}</b></span>
            ${st.dealer === id && !sit ? '<i class="pk-dealer">D</i>' : ""}${blind && !sit ? `<u class="pk-tag" style="right:auto;left:-.4cqw">${blind}</u>` : ""}${tag}${timer}</div>`,
        });
        const b = st.bets[id] | 0;
        if (b > 0) {
          const bx = pos.x + (50 - pos.x) * 0.5, by = pos.y + (46 - pos.y) * 0.5;
          const grew = b !== lastBets[id];
          lastBets[id] = b;
          betItems.push({
            k: "b" + id, cls: "pk-bet", sig: b + "|" + bx.toFixed(1),
            style: `left:${bx}%;top:${by}%;--tx:${((pos.x - bx) * 0.9).toFixed(1)}cqw;--ty:${((pos.y - by) * 0.9).toFixed(1)}cqw` + (grew ? "" : ";animation:none"),
            html: `${chipHTML(b, 6)}<b>${b}</b>`,
          });
        } else delete lastBets[id];
      });
      sync(layerEl, seatItems.concat(betItems));

      // pot
      const potSig = st.pot + "|" + st.phase;
      if (potEl._p !== potSig) {
        potEl._p = potSig;
        potEl.innerHTML = st.pot > 0 ? `<small>Pot</small>${chipHTML(st.pot, 9)}<b>${st.pot}</b>` : "";
      }

      // board: five fixed slots, only new cards fly in
      const slots = [];
      for (let i = 0; i < 5; i++) slots.push(i);
      if (!boardEl.children.length) boardEl.innerHTML = slots.map((i) => `<span class="slot" data-i="${i}"></span>`).join("");
      st.board.forEach((c, i) => {
        const slot = boardEl.children[i];
        if (slot._c === c) return;
        slot._c = c;
        const fresh = i >= seenBoard;
        const idx = i >= 3 ? 0 : i;
        slot.innerHTML = cardHTML(c, {
          cls: (fresh ? "deal " : "") + (winBoard(c) ? "win" : ""),
          style: `--dl:${idx * 0.16}s;--fx:${(21 - (50 + (i - 2) * 8.5)).toFixed(1)}cqw;--fy:-2cqw`,
        });
        if (fresh) snd.deal();
      });
      for (let i = st.board.length; i < 5; i++) { const s = boardEl.children[i]; if (s._c != null) { s._c = null; s.innerHTML = ""; } }
      seenBoard = st.board.length;
      boardEl.querySelectorAll(".pcard").forEach((el, k) => { const c = st.board[k]; el.classList.toggle("win", winBoard(c)); });

      paintResult();
      paintStatus();
      paintAct();
      paintHole();
    }

    // winning five cards highlight (showdown only)
    const winSet = () => {
      const s = new Set();
      if (st.phase === "show" || st.phase === "over") for (const r of st.results) for (const c of r.win) s.add(c);
      return s;
    };
    const winCard = (id, c) => winSet().has(c);
    const winBoard = (c) => winSet().has(c);

    function paintResult() {
      const show = (st.phase === "show" || st.phase === "over") && st.results.length;
      resEl.hidden = !show;
      if (!show) { resEl._h = ""; return; }
      const lines = st.results.map((r) => `<p><em>${r.ids.map(pn).map(esc).join(" & ")}</em> ${r.ids.length > 1 ? "teilen" : "gewinnt"} <b>${r.amt}</b>${r.name ? ` · ${esc(r.name)}` : ""}</p>`).join("");
      let h = `<h3>${st.phase === "over" && st.winner ? `🏆 ${esc(pn(st.winner))} gewinnt die Partie!` : "Showdown"}</h3>${lines}`;
      if (st.phase === "over" && ctx.isHost) h += `<div class="pk-act"><button type="button" class="b-next pk-nextbtn" data-restart>Neue Partie</button></div>`;
      if (resEl._h !== h) { resEl._h = h; resEl.innerHTML = h; }
    }

    function paintStatus() {
      let t = "", mine = false;
      if (st.phase === "wait") t = "Die Karten werden gemischt …";
      else if (st.phase === "over") t = st.winner ? `${nm(st.winner)} hat alle Chips gewonnen.` : "Die Partie ist zu Ende.";
      else if (st.phase === "show") t = ctx.isHost ? "Hand beendet – gleich geht’s weiter." : "Hand beendet.";
      else if (st.phase === "bet") {
        if (st.turn === me()) { mine = true; const to = Math.max(0, st.cur - (st.bets[me()] | 0)); t = to ? `Du bist dran – <b>${Math.min(to, st.chips[me()])}</b> zum Mitgehen` : "Du bist dran – Check oder Setzen"; }
        else if (st.turn) t = `<b>${nm(st.turn)}</b> überlegt …`;
        else t = "Karten werden aufgedeckt …";
      }
      const sig = t + mine;
      if (statusEl._s !== sig) { statusEl._s = sig; statusEl.innerHTML = t; statusEl.classList.toggle("mine", mine); }
      noteEl.textContent = st.note || "";
    }

    function paintAct() {
      const m = me();
      let h = "", sig;
      if (st.phase === "show" && ctx.isHost) {
        sig = "show"; h = `<button type="button" class="b-next" data-next>Nächste Hand</button>`;
      } else if (myTurn()) {
        const have = st.chips[m] | 0, myBet = st.bets[m] | 0, to = Math.max(0, st.cur - myBet);
        const maxTo = myBet + have, minTo = Math.min(st.cur + st.minRaise, maxTo);
        const canRaise = have > to;
        const key = st.hand + ":" + st.street + ":" + st.cur;
        if (raiseFor !== key) { raiseFor = key; myRaise = minTo; }
        myRaise = Math.max(minTo, Math.min(maxTo, myRaise));
        const callTxt = to === 0 ? "Check" : have <= to ? `All-In ${have}` : `Call ${to}`;
        sig = [key, have, myBet, st.pot, minTo, maxTo].join("|");
        h = `<button type="button" class="b-fold" data-act="fold">Passen</button>
          <button type="button" class="b-call" data-act="call">${callTxt}</button>
          ${canRaise ? `<div class="pk-raise">
            <button type="button" class="q" data-q="0.5">½ Pot</button><button type="button" class="q" data-q="1">Pot</button><button type="button" class="q" data-q="max">Max</button>
            <input type="range" min="${minTo}" max="${maxTo}" step="${minTo === maxTo ? 1 : 5}" value="${myRaise}" aria-label="Einsatz">
            <button type="button" class="b-raise" data-act="raise">${st.cur ? "Erhöhen" : "Setzen"} auf <output>${myRaise}</output></button>
          </div>` : ""}`;
      } else sig = "-";
      if (actEl._s !== sig) { actEl._s = sig; actEl.innerHTML = h; }
    }

    function paintHole() {
      const ok = myHoleH === st.hand && myHole.length === 2 && (st.phase === "bet" || st.phase === "show" || st.phase === "over");
      const folded = !!st.fold[me()];
      const sig = ok ? myHole.join(",") + "|" + st.hand : "-";
      holeEl.classList.toggle("fold", folded);
      if (holeEl._s === sig) return;
      holeEl._s = sig;
      holeEl.innerHTML = ok ? myHole.map((c, k) => cardHTML(c, { cls: "deal", style: `--dl:${0.5 + k * 0.2}s;--fx:0cqw;--fy:-30cqw` })).join("") : "";
      if (ok) snd.deal();
    }

    // ---- host engine ----
    const bump = (id) => ctx.send("hand", { h: st.hand, cards: hole[id] || [] }, id);
    function pushState() {
      const pub = { ...st, names: undefined };
      ctx.send("state", pub);
      paint();
    }
    const note = (t) => { st.note = t; };
    const isLive = (id) => !st.sit[id] && !st.fold[id] && !st.gone[id];
    const canAct = (id) => isLive(id) && !st.allin[id] && (st.chips[id] | 0) > 0;
    const needsAct = (id) => canAct(id) && (!acted[id] || (st.bets[id] | 0) < st.cur);
    const nextWhere = (fromId, pred) => {
      const o = st.order, n = o.length, i0 = o.indexOf(fromId);
      for (let k = 1; k <= n; k++) { const id = o[(i0 + k + n) % n]; if (pred(id)) return id; }
      return null;
    };
    const clearTimers = () => { clearTimeout(turnTimer); clearTimeout(nextTimer); clearTimeout(runTimer); };

    function pay(id, amt) {
      const p = Math.max(0, Math.min(amt, st.chips[id] | 0));
      st.chips[id] -= p; st.bets[id] = (st.bets[id] | 0) + p; contrib[id] = (contrib[id] | 0) + p; st.pot += p;
      if (st.chips[id] === 0) st.allin[id] = 1;
      return p;
    }

    function armTurn() {
      clearTimeout(turnTimer);
      st.tms = st.turn ? TURN_MS : 0;
      if (!st.turn) return;
      const who = st.turn;
      turnTimer = setTimeout(() => {
        if (st.phase !== "bet" || st.turn !== who) return;
        const to = st.cur - (st.bets[who] | 0);
        act(who, to <= 0 ? "call" : "fold", 0, true);
      }, TURN_MS);
    }

    function startHand() {
      clearTimers();
      const prevDealer = st.dealer;
      st.order = st.order.filter((id) => !st.gone[id]);
      st.gone = {};
      const alive = st.order.filter((id) => (st.chips[id] | 0) > 0);
      if (alive.length < 2) { endMatch(alive[0] || null); return; }
      st.hand++;
      st.sit = {}; st.fold = {}; st.allin = {}; st.bets = {}; st.shown = {}; st.results = []; st.last = {};
      for (const id of st.order) if (!(st.chips[id] > 0)) st.sit[id] = 1;
      deck = shuffle(Array.from({ length: 52 }, (_, i) => i));
      hole = {}; contrib = {}; acted = {};
      for (const id of alive) { hole[id] = [deck.pop(), deck.pop()]; contrib[id] = 0; }
      st.board = []; st.street = 0; st.pot = 0; st.cur = 0; st.minRaise = BB; st.winner = null; st.note = "";
      const live = (id) => alive.includes(id);
      st.dealer = nextWhere(st.order.includes(prevDealer) ? prevDealer : st.order[st.order.length - 1], live);
      const hu = alive.length === 2;
      st.sb = hu ? st.dealer : nextWhere(st.dealer, live);
      st.bb = nextWhere(st.sb, live);
      pay(st.sb, SB); pay(st.bb, BB);
      st.cur = Math.max(...Object.values(st.bets));
      st.phase = "bet";
      for (const id of alive) if (id !== me()) bump(id);
      myHole = hole[me()] || []; myHoleH = st.hand;
      note(`${pn(st.dealer)} gibt – Blinds ${SB}/${BB}.`);
      snd.deal();
      st.turn = nextWhere(st.bb, needsAct);
      if (st.turn == null) { st.tms = 0; pushState(); runTimer = setTimeout(endStreet, 1200); return; }
      armTurn(); pushState();
    }

    function act(id, t, amt, auto = false) {
      if (!ctx.isHost || st.phase !== "bet" || st.turn !== id) return;
      const myBet = st.bets[id] | 0, ch = st.chips[id] | 0, to = Math.max(0, st.cur - myBet);
      let said = "";
      if (t === "fold") { clearTimeout(turnTimer); st.fold[id] = 1; said = "Passt"; note(`${pn(id)} passt${auto ? " (Zeit abgelaufen)" : ""}.`); snd.fold(); }
      else if (t === "call") {
        clearTimeout(turnTimer);
        const p = pay(id, to);
        said = to === 0 ? "Check" : st.allin[id] ? "All-In" : "Call " + p;
        note(to === 0 ? `${pn(id)} checkt.` : `${pn(id)} geht mit ${p}.`);
        to === 0 ? snd.check() : snd.chip();
      } else if (t === "raise" || t === "allin") {
        const maxTo = myBet + ch;
        const target = t === "allin" ? maxTo : Math.min(Math.floor(+amt) || 0, maxTo);
        const minTo = st.cur + st.minRaise;
        if (target <= st.cur) { clearTimeout(turnTimer); pay(id, to); said = "Call"; }
        else if (target < minTo && target < maxTo) return;                  // illegal – the client never offers it
        else {
          clearTimeout(turnTimer);
          const inc = target - st.cur;
          pay(id, target - myBet);
          if (inc >= st.minRaise) st.minRaise = inc;
          st.cur = target; acted = {};
          said = st.allin[id] ? "All-In" : "Raise " + target;
          note(`${pn(id)} ${st.allin[id] ? "geht ALL-IN mit" : st.cur - inc > 0 ? "erhöht auf" : "setzt"} ${target}.`);
        }
        snd.chip();
      } else return;
      acted[id] = 1; st.last[id] = said;
      afterAct();
    }

    function afterAct() {
      const live = st.order.filter(isLive);
      if (live.length === 1) { award([{ amt: st.pot, elig: live }], null, true); return; }
      const nx = nextWhere(st.turn, needsAct);
      if (nx) { st.turn = nx; armTurn(); pushState(); return; }
      endStreet();
    }

    function endStreet() {
      clearTimeout(runTimer);
      if (st.phase !== "bet") return;
      st.bets = {}; st.cur = 0; st.minRaise = BB; acted = {}; st.turn = null; st.last = {};
      if (st.street === 3) { showdown(); return; }
      st.street++;
      st.board.push(...(st.street === 1 ? [deck.pop(), deck.pop(), deck.pop()] : [deck.pop()]));
      note(["", "Flop", "Turn", "River"][st.street] + ".");
      const able = st.order.filter(canAct).length;
      if (able < 2) { st.tms = 0; pushState(); runTimer = setTimeout(endStreet, 1500); return; }
      st.turn = nextWhere(st.dealer, needsAct);
      armTurn(); pushState();
    }

    function showdown() {
      const live = st.order.filter(isLive);
      const sc = {};
      for (const id of live) {
        const b = best7(hole[id].concat(st.board));
        sc[id] = b; st.shown[id] = hole[id];
      }
      // side pots, built from what everybody put in
      const all = Object.keys(contrib);
      const lv = [...new Set(all.map((id) => contrib[id]).filter((v) => v > 0))].sort((a, b) => a - b);
      const pots = []; let prev = 0;
      for (const L of lv) {
        let amt = 0;
        for (const id of all) amt += Math.max(0, Math.min(contrib[id], L) - prev);
        const elig = live.filter((id) => contrib[id] >= L);
        prev = L;
        if (!elig.length) { if (pots.length) pots[pots.length - 1].amt += amt; continue; }
        const last = pots[pots.length - 1];
        if (last && last.elig.length === elig.length) last.amt += amt;    // same players eligible: one pot
        else pots.push({ amt, elig });
      }
      award(pots, sc, false);
    }

    function award(pots, sc, uncontested) {
      clearTimers();
      const results = [];
      const start = st.dealer;
      for (const pot of pots) {
        let winners;
        if (sc) {
          const top = Math.max(...pot.elig.map((id) => sc[id].score));
          winners = pot.elig.filter((id) => sc[id].score === top);
        } else winners = pot.elig;
        // odd chips go to the winner closest left of the dealer
        const ordered = [];
        const o = st.order, n = o.length, i0 = Math.max(0, o.indexOf(start));
        for (let k = 1; k <= n; k++) { const id = o[(i0 + k) % n]; if (winners.includes(id)) ordered.push(id); }
        const share = Math.floor(pot.amt / ordered.length);
        let rest = pot.amt - share * ordered.length;
        for (const id of ordered) { st.chips[id] += share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
        results.push({ ids: ordered, amt: pot.amt, name: sc ? handName(sc[ordered[0]]) : "", win: sc ? sc[ordered[0]].five : [] });
      }
      // merge identical results to keep the banner short
      st.results = results;
      if (sc) for (const id of Object.keys(sc)) st.last[id] = handName(sc[id]);
      st.pot = 0; st.bets = {}; st.turn = null; st.tms = 0; st.cur = 0; st.phase = "show";
      note(uncontested ? `${pn(results[0].ids[0])} gewinnt – alle anderen haben gepasst.` : "");
      const alive = st.order.filter((id) => !st.gone[id] && st.chips[id] > 0);
      if (alive.length < 2) { st.phase = "over"; st.winner = alive[0] || null; pushState(); celebrate(); return; }
      pushState(); celebrate();
      nextTimer = setTimeout(startHand, NEXT_MS);
    }

    function endMatch(w) {
      clearTimers();
      st.phase = "over"; st.winner = w; st.turn = null; st.tms = 0; st.bets = {}; st.pot = 0;
      if (!st.results.length) st.results = w ? [{ ids: [w], amt: st.chips[w] | 0, name: "", win: [] }] : [];
      pushState();
    }

    function restart() {
      if (!ctx.isHost) return;
      clearTimers();
      st.order = st.order.filter((id) => !st.gone[id]); st.gone = {};
      for (const id of st.order) st.chips[id] = START;
      st.hand = 0; st.dealer = null; st.results = []; st.winner = null; st.shown = {};
      startHand();
    }

    // ---- effects ----
    function flyChips(fromEl, toEl, n = 7) {
      if (!fromEl || !toEl || !sceneEl.animate) return;
      const sr = sceneEl.getBoundingClientRect(), a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      for (let i = 0; i < n; i++) {
        const c = document.createElement("i");
        c.className = "ch fly";
        const col = DENOM[(i + 1) % DENOM.length];
        c.style.cssText = `--c:${col[1]};--n:0;left:${a.left - sr.left + a.width / 2 - 8}px;top:${a.top - sr.top + a.height / 2}px;`;
        sceneEl.appendChild(c);
        const dx = b.left - a.left + (b.width - a.width) / 2, dy = b.top - a.top + (b.height - a.height) / 2;
        const an = c.animate([
          { transform: "translate(0,0) scale(.8)", opacity: 1 },
          { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 40}px) scale(1.15)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx}px,${dy}px) scale(.8)`, opacity: 0.2 },
        ], { duration: 900 + i * 80, delay: i * 70, easing: "cubic-bezier(.3,.7,.3,1)", fill: "backwards" });
        an.onfinish = () => c.remove();
      }
    }
    function celebrate() {
      requestAnimationFrame(() => {
        for (const r of st.results) for (const id of r.ids) flyChips(potEl, layerEl.querySelector(`.pk-seat.win`) && seatEl(id), 6);
        snd.win();
      });
    }
    const seatEl = (id) => { const m = layerEl._m && layerEl._m.get("s" + id); return m ? m.querySelector(".pk-plate") : null; };

    // ---- messages ----
    ctx.onMessage("act", ({ data, from }) => {
      if (!data || typeof data.t !== "string") return;
      act(from, data.t, data.amt);
    });
    ctx.onMessage("next", ({ from }) => { if (ctx.isHost && from === ctx.hostId && st.phase === "show") startHand(); });
    ctx.onMessage("need", ({ from }) => {
      if (ctx.isHost && hole[from]) ctx.send("hand", { h: st.hand, cards: hole[from] }, from);
    });
    ctx.onMessage("hand", ({ data, from }) => {
      if (from !== ctx.hostId || !data || !Array.isArray(data.cards)) return;
      myHole = data.cards.filter(isCard).slice(0, 2); myHoleH = Number.isInteger(data.h) ? data.h : -1;
      holeEl._s = null;
      paint();
    });
    ctx.onMessage("state", ({ data, from }) => {
      if (from !== ctx.hostId) return;
      const next = clean(data, ids);
      if (!next) return;
      const prev = st;
      st = next;
      if (st.phase === "bet" && st.turn === me() && prev.turn !== me()) snd.turn();
      if (st.phase === "bet" && myHoleH !== st.hand && !st.sit[me()] && !st.fold[me()]) ctx.send("need", null, ctx.hostId);
      const gotChips = Object.keys(st.bets).some((k) => (st.bets[k] | 0) > (prev.bets[k] | 0) && k !== me());
      if (gotChips) snd.chip();
      paint();
      if ((st.phase === "show" || st.phase === "over") && prev.phase === "bet") celebrate();
    });

    // ---- inputs ----
    const send = (t, amt) => (ctx.isHost ? act(me(), t, amt) : ctx.send("act", { t, amt }, ctx.hostId));
    actEl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.next !== undefined) { startHand(); return; }
      if (b.dataset.act === "fold") send("fold");
      else if (b.dataset.act === "call") send("call");
      else if (b.dataset.act === "raise") send("raise", myRaise);
      else if (b.dataset.q !== undefined) {
        const rg = actEl.querySelector("input[type=range]");
        if (!rg) return;
        const m = me(), to = Math.max(0, st.cur - (st.bets[m] | 0));
        const v = b.dataset.q === "max" ? +rg.max : st.cur + Math.round((st.pot + to) * parseFloat(b.dataset.q));
        setRaise(Math.max(+rg.min, Math.min(+rg.max, v)));
      }
    });
    function setRaise(v) {
      myRaise = Math.round(v);
      const rg = actEl.querySelector("input[type=range]"), out = actEl.querySelector("output");
      if (rg) rg.value = myRaise;
      if (out) out.textContent = myRaise;
    }
    actEl.addEventListener("input", (e) => { if (e.target.matches("input[type=range]")) setRaise(+e.target.value); });
    resEl.addEventListener("click", (e) => { if (e.target.closest("[data-restart]")) restart(); });
    rootEl.addEventListener("keydown", (e) => {
      if (!myTurn() || e.target.matches("input")) return;
      const k = e.key.toLowerCase();
      if (k === "f") { e.preventDefault(); send("fold"); }
      else if (k === "c" || k === " ") { e.preventDefault(); send("call"); }
      else if (k === "r") { e.preventDefault(); send("raise", myRaise); }
    });

    // my cards tilt towards the pointer (the table itself stays put)
    holeEl.addEventListener("pointermove", (e) => {
      const r = holeEl.getBoundingClientRect();
      holeEl.style.setProperty("--tx", (((e.clientX - r.left) / r.width - 0.5) * 28).toFixed(1) + "deg");
      holeEl.style.setProperty("--ty", ((0.5 - (e.clientY - r.top) / r.height) * 22).toFixed(1) + "deg");
    });
    holeEl.addEventListener("pointerleave", () => { holeEl.style.setProperty("--tx", "0deg"); holeEl.style.setProperty("--ty", "0deg"); });

    const sndBtn = document.createElement("button");
    sndBtn.type = "button"; sndBtn.className = "pk-snd"; sndBtn.title = "Sound an/aus";
    sndBtn.textContent = sound ? "Ton an" : "Ton aus";
    sndBtn.addEventListener("click", () => {
      sound = !sound;
      try { localStorage.setItem("pk_sound", sound ? "1" : "0"); } catch {}
      if (!sound && AC) { try { AC.close(); } catch {} AC = null; }
      sndBtn.textContent = sound ? "Ton an" : "Ton aus";
      if (sound) snd.chip();
    });
    headEl.appendChild(sndBtn);

    // hide my cards (playing side by side): face down, only faintly visible while hovering
    let hidden = false;
    try { hidden = localStorage.getItem("pk_hide") === "1"; } catch {}
    const hideBtn = $(".pk-eye");
    hideBtn.title = "Eigene Karten verdecken – nur beim Drüberfahren sichtbar";
    const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>';
    const applyHide = () => {
      holeEl.classList.toggle("hide", hidden);
      hideBtn.innerHTML = EYE + (hidden ? '<path d="M3 3l18 18"/>' : "") + "</svg>";
      hideBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
      hideBtn.setAttribute("aria-label", hidden ? "Karten anzeigen" : "Karten verdecken");
    };
    hideBtn.addEventListener("click", () => {
      hidden = !hidden;
      try { localStorage.setItem("pk_hide", hidden ? "1" : "0"); } catch {}
      applyHide();
    });
    applyHide();

    // ---- host migration / leaving ----
    ctx.onEvent("host", ({ you }) => {
      if (you) {
        clearTimers();
        deck = []; hole = {}; acted = {};
        if (st.phase === "bet") {
          // the new host never saw the deck or the hole cards: give the bets back, split the rest between those still in
          const back = st.pot - Object.values(st.bets).reduce((a, b) => a + b, 0);
          for (const id of Object.keys(st.bets)) st.chips[id] += st.bets[id];
          const still = st.order.filter(isLive);
          still.forEach((id, i) => { st.chips[id] += Math.floor(back / still.length) + (i === 0 ? back % still.length : 0); });
          st.pot = 0; st.bets = {}; st.cur = 0; st.turn = null; st.tms = 0; st.phase = "show"; st.results = []; st.board = st.board.slice();
          note("Der Gastgeber hat gewechselt – die Hand verfällt, Einsätze sind zurück.");
        }
        if (st.phase === "show") nextTimer = setTimeout(startHand, 4000);
        pushState();
      } else paint();
    });
    ctx.onEvent("leave", ({ id }) => {
      if (!ids.has(id)) return;
      if (ctx.isHost) {
        st.gone[id] = 1;
        if (st.phase === "bet") {
          st.fold[id] = 1;
          if (st.turn === id) { acted[id] = 1; afterAct(); return; }
          const live = st.order.filter(isLive);
          if (live.length === 1) { award([{ amt: st.pot, elig: live }], null, true); return; }
          if (!st.turn) { pushState(); return; }
        }
        const left = st.order.filter((x) => !st.gone[x]);
        if (left.length < 2 && st.phase !== "bet") { endMatch(left[0] || null); return; }
        pushState();
      } else paint();
    });
    ctx.onEvent("join", () => paint());

    paint();
    setTimeout(() => { try { rootEl.focus({ preventScroll: true }); } catch {} }, 80);

    return {
      go() { if (ctx.isHost && st.phase === "wait") { startHand(); } else paint(); },
      destroy() {
        clearTimers();
        try { if (AC) AC.close(); } catch {} AC = null;
        sndBtn.remove(); styleEl.remove();
      },
    };
  },
};
