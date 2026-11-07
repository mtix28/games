// Game manifest — the single registry the home grid is built from.
//
// Adding a new game:
//   1. create games/<id>.js (call initGame({...}) — see game.js for the config shape)
//   2. add one entry here: { id, title, desc, preview }
// The preview receives (p, w, h) on a 600×360 p5 canvas and draws one static,
// representative snapshot of the game (no animation — p.noLoop() is set).

const GAMES = [
  { id: "minesweeper", title: "Minesweeper",   desc: "clear every safe cell",       preview: drawMinesweeper },
  { id: "bugs",        title: "Bug Nudge",     desc: "push every bug home",         preview: drawBugs },
  { id: "snake",       title: "Snake",         desc: "eat · grow · survive",        preview: drawSnake },
  { id: "nonogram",    title: "Nonogram",      desc: "paint the hidden picture",    preview: drawNonogram },
  { id: "conway",      title: "Conway's Life", desc: "it's a game, right?",         preview: drawConway },
  { id: "2048",        title: "2048",          desc: "merge tiles · reach 2048",    preview: draw2048 },
  { id: "lightsout",   title: "Circuit Align", desc: "switch every light off",      preview: drawLightsOut },
  { id: "tictactoe",   title: "Tic Tac Toe",   desc: "Tic² Tac² Toe² · vs computer", preview: drawTicTacToe },
  { id: "flood",       title: "Flood It",      desc: "flood the board",             preview: drawFlood },
  { id: "sudoku",      title: "Sudoku",        desc: "9×9 · 6×6 · 4×4",             preview: drawSudoku },
  { id: "netwalk",     title: "Netwalk",       desc: "rotate pipes · power the grid", preview: drawNetwalk },
  { id: "blackjack",   title: "Blackjack",     desc: "hit · stand · beat the dealer", preview: drawBlackjack },
  { id: "solitaire",   title: "Solitär",       desc: "Klondike · Regeln wählbar",   preview: drawSolitaire },
  { id: "kniffel",     title: "Kniffel · Yahtzee", desc: "roll · hold · write it down", preview: drawKniffel },
  { id: "kritzel",     title: "Kritzel-Revier",    desc: "kritzle das größte Revier",   preview: drawKritzel },
  { id: "kart",        title: "Kart-Rennen",       desc: "drift · turbo · Bestzeit",    preview: drawKart },
  { id: "battleship", title: "Schiffe versenken", desc: "Flotte aufstellen und feuern, gegen den Computer · drei Stufen", preview: drawBattleship },
];

// ---- preview renderers ----
// Each receives (p, w, h) on a 600×360 canvas and draws a static, hand-placed
// snapshot in the same style as the game itself. Boards are centred with
// breathing room so nothing is cropped by the card.

function previewBg(p, w, h) {
  p.background(...PAL.board);
  p.noStroke();
  // a soft glow behind the board
  for (let k = 6; k >= 1; k--) {
    p.fill(...PAL.lilac, 3);
    p.ellipse(w / 2, h / 2, w * (0.4 + k * 0.1), h * (0.4 + k * 0.12));
  }
}

function tile(p, x, y, s, col, r) {
  p.noStroke();
  p.fill(...col);
  p.rect(x, y, s, s, r ?? s * 0.18);
}

function drawMinesweeper(p, w, h) {
  previewBg(p, w, h);
  const C = 11, R = 6, cs = 44, g = 3;
  const ox = (w - C * cs) / 2, oy = (h - R * cs) / 2;
  // 0 covered · -1 open blank · 1-4 number · 9 flag · 10 mine (blast)
  const L = [
    [0, 0, 0, 1,-1,-1, 1, 0, 0, 0, 0],
    [0, 9, 0, 2,-1,-1, 2, 9, 0, 0, 0],
    [0, 0, 0, 2, 1, 1, 3, 0, 0, 9, 0],
    [1, 1, 1, 1, 9, 0, 0, 0, 0, 0, 0],
    [-1,-1,-1, 1, 2, 3, 0,10, 0, 0, 0],
    [-1,-1,-1,-1,-1, 1, 0, 0, 0, 0, 0],
  ];
  const NUM = [null, PAL.sky, PAL.mint, PAL.rose, PAL.lilac];
  p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(cs * 0.54);
  for (let j = 0; j < R; j++)
    for (let i = 0; i < C; i++) {
      const v = L[j][i], x = ox + i * cs + g / 2, y = oy + j * cs + g / 2, s = cs - g;
      if (v === 0 || v === 9) {
        tile(p, x, y, s, PAL.panel);
        p.fill(255, 255, 255, 10); p.rect(x, y, s, s * 0.45, s * 0.18, s * 0.18, 0, 0);
        if (v === 9) {
          const cx = x + s / 2, cy = y + s / 2;
          p.stroke(...PAL.ink, 220); p.strokeWeight(2.4);
          p.line(cx - s * 0.12, cy - s * 0.26, cx - s * 0.12, cy + s * 0.24);
          p.noStroke(); p.fill(...PAL.rose);
          p.triangle(cx - s * 0.1, cy - s * 0.27, cx + s * 0.24, cy - s * 0.13, cx - s * 0.1, cy + s * 0.02);
        }
      } else if (v === 10) {
        tile(p, x, y, s, [...PAL.rose, 90]);
        const cx = x + s / 2, cy = y + s / 2, d = s * 0.44;
        p.stroke(...PAL.mineHi); p.strokeWeight(3); p.strokeCap(p.ROUND);
        for (let a = 0; a < 4; a++) { const an = a * Math.PI / 4; p.line(cx - Math.cos(an) * d * 0.78, cy - Math.sin(an) * d * 0.78, cx + Math.cos(an) * d * 0.78, cy + Math.sin(an) * d * 0.78); }
        p.noStroke(); p.fill(...PAL.mine); p.circle(cx, cy, d);
        p.fill(255, 255, 255, 190); p.circle(cx - d * 0.17, cy - d * 0.17, d * 0.26);
      } else {
        tile(p, x, y, s, PAL.well);
        if (v > 0) { p.fill(...NUM[v]); p.text(v, x + s / 2, y + s / 2 + 1); }
      }
    }
}

function drawLadybug(p, cx, cy, cs, home) {
  const d = cs * 0.62;
  if (home) {
    p.noStroke(); p.fill(...PAL.mint, 40); p.circle(cx, cy, cs * 0.92);
    p.noFill(); p.stroke(...PAL.mint, 200); p.strokeWeight(2.5); p.circle(cx, cy, cs * 0.84);
  }
  p.stroke(170, 80, 125); p.strokeWeight(d * 0.06);
  for (const s of [-1, 1]) for (const k of [-0.22, 0.05, 0.3]) p.line(cx, cy + k * d, cx + s * d * 0.52, cy + k * d + k * 0.5 * d);
  p.noStroke();
  p.fill(60, 34, 72); p.circle(cx, cy - d * 0.38, d * 0.42);
  p.stroke(60, 34, 72); p.strokeWeight(d * 0.045);
  p.line(cx - d * 0.08, cy - d * 0.52, cx - d * 0.2, cy - d * 0.66);
  p.line(cx + d * 0.08, cy - d * 0.52, cx + d * 0.2, cy - d * 0.66);
  p.noStroke(); p.fill(...PAL.rose); p.ellipse(cx, cy + d * 0.04, d * 0.8, d * 0.84);
  p.fill(255, 170, 190, 110); p.ellipse(cx - d * 0.16, cy - d * 0.12, d * 0.22, d * 0.16);
  p.stroke(120, 34, 70); p.strokeWeight(d * 0.04); p.line(cx, cy - d * 0.37, cx, cy + d * 0.45);
  p.noStroke(); p.fill(120, 34, 70);
  for (const [sx, sy, r] of [[-0.2, 0, 0.14], [0.2, 0, 0.14], [-0.17, 0.25, 0.11], [0.17, 0.25, 0.11]]) p.circle(cx + sx * d, cy + sy * d, r * d);
  p.fill(255); p.circle(cx - d * 0.09, cy - d * 0.44, d * 0.08); p.circle(cx + d * 0.09, cy - d * 0.44, d * 0.08);
}

function drawBugs(p, w, h) {
  previewBg(p, w, h);
  const C = 7, R = 4, cs = 66, g = 4;
  const ox = (w - C * cs) / 2, oy = (h - R * cs) / 2;
  const homes = [[1, 0], [4, 1], [2, 2], [5, 3], [6, 0]];
  const bugs = [[1, 0, true], [4, 1, true], [3, 3, false], [6, 1, false]];
  for (let j = 0; j < R; j++)
    for (let i = 0; i < C; i++) {
      const x = ox + i * cs + g / 2, y = oy + j * cs + g / 2, s = cs - g;
      const home = homes.some(([a, b]) => a === i && b === j);
      if (home) {
        const filled = bugs.some(([a, b]) => a === i && b === j);
        p.fill(...PAL.sun, filled ? 44 : 22); p.stroke(...PAL.sun, filled ? 150 : 90); p.strokeWeight(1.5);
        p.rect(x, y, s, s, s * 0.16); p.noStroke();
        const r = cs * 0.09;
        p.fill(...PAL.sun, filled ? 120 : 255);
        p.quad(x + s / 2, y + s / 2 - r, x + s / 2 + r, y + s / 2, x + s / 2, y + s / 2 + r, x + s / 2 - r, y + s / 2);
      } else tile(p, x, y, s, PAL.well, s * 0.16);
    }
  // nudge preview arrows around the hovered cell (4,2)
  p.noFill(); p.stroke(...PAL.lilac, 200); p.strokeWeight(2.5);
  p.rect(ox + 4 * cs + 4, oy + 2 * cs + 4, cs - 8, cs - 8, cs * 0.16);
  const ax = ox + 3 * cs + cs / 2, ay = oy + 3 * cs + cs / 2;
  p.stroke(...PAL.lilac, 170); p.strokeCap(p.ROUND);
  p.line(ax - cs * 0.28, ay + cs * 0.28, ax - cs * 0.62, ay + cs * 0.62);
  for (const [bx, by, home] of bugs) drawLadybug(p, ox + bx * cs + cs / 2, oy + by * cs + cs / 2, cs, home);
}

function drawSnake(p, w, h) {
  previewBg(p, w, h);
  const gw = 20, gh = 11, cs = 26;
  const ox = (w - gw * cs) / 2, oy = (h - gh * cs) / 2;
  p.noStroke(); p.fill(...PAL.well); p.rect(ox, oy, gw * cs, gh * cs, 14);
  p.fill(...PAL.line);
  for (let x = 1; x < gw; x++) for (let y = 1; y < gh; y++) p.circle(ox + x * cs, oy + y * cs, 2);
  const c = (gx, gy) => [ox + gx * cs + cs / 2, oy + gy * cs + cs / 2];
  // food
  for (const [fx, fy] of [[9, 5], [15, 2], [4, 8]]) {
    const [x, y] = c(fx, fy);
    p.fill(...PAL.sun, 34); p.circle(x, y, cs * 0.95);
    p.fill(...PAL.sun); p.circle(x, y, cs * 0.55);
    p.fill(...PAL.ink); p.circle(x, y, cs * 0.24);
  }
  function snake(body, col, head, dir) {
    for (let i = 1; i < body.length; i++) {
      const f = i / (body.length - 1);
      p.stroke(p.lerp(head[0], col[0], f), p.lerp(head[1], col[1], f), p.lerp(head[2], col[2], f), 230);
      p.strokeWeight(cs * 0.74); p.strokeCap(p.ROUND);
      p.line(...c(...body[i - 1]), ...c(...body[i]));
    }
    p.noStroke();
    const [hx, hy] = c(...body[0]);
    p.fill(...head, 50); p.circle(hx, hy, cs * 1.05);
    p.fill(...head); p.circle(hx, hy, cs * 0.6);
    p.fill(...PAL.board);
    const e = cs * 0.16;
    p.circle(hx + dir[0] * e - dir[1] * e, hy + dir[1] * e - dir[0] * e, cs * 0.1);
    p.circle(hx + dir[0] * e + dir[1] * e, hy + dir[1] * e + dir[0] * e, cs * 0.1);
  }
  snake([[8, 5], [7, 5], [6, 5], [6, 4], [6, 3], [5, 3], [4, 3], [3, 3], [2, 3]], PAL.mint, PAL.mintHi, [1, 0]);
  snake([[12, 6], [13, 6], [14, 6], [14, 7], [14, 8], [15, 8], [16, 8], [17, 8]], PAL.sky, PAL.skyHi, [-1, 0]);
}

function drawNonogram(p, w, h) {
  previewBg(p, w, h);
  // a little heart, mostly painted
  const sol = [
    "0110110",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000",
  ];
  const C = 7, R = 6, cs = 38, u = cs * 0.62;
  const runs = (s) => { const o = []; let c = 0; for (const ch of s) { if (ch === "1") c++; else if (c) { o.push(c); c = 0; } } if (c) o.push(c); return o.length ? o : [0]; };
  const colStr = (i) => sol.map(r => r[i]).join("");
  const maxR = 2, maxC = 2;
  const totW = cs * C + (maxR + 0.4) * u, totH = cs * R + (maxC + 0.4) * u;
  const gx = (w - totW) / 2 + (maxR + 0.4) * u, gy = (h - totH) / 2 + (maxC + 0.4) * u;
  const painted = (i, j) => sol[j][i] === "1" && !(j === 3 && i >= 4) && !(j === 4);
  const crossed = (i, j) => sol[j][i] === "0" && (j <= 1 || i === 0);
  p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(u * 0.88);
  for (let i = 0; i < C; i++) {
    const cl = runs(colStr(i));
    const ok = sol.every((r, j) => (r[i] === "1") === painted(i, j));
    p.fill(...(ok ? PAL.mint : PAL.muted));
    cl.forEach((v, k) => p.text(v, gx + i * cs + cs / 2, gy - 0.65 * u - (cl.length - 1 - k) * u));
  }
  for (let j = 0; j < R; j++) {
    const cl = runs(sol[j]);
    const ok = [...sol[j]].every((ch, i) => (ch === "1") === painted(i, j));
    p.fill(...(ok ? PAL.mint : PAL.muted));
    cl.forEach((v, k) => p.text(v, gx - 0.7 * u - (cl.length - 1 - k) * u, gy + j * cs + cs / 2));
  }
  p.noStroke(); p.fill(...PAL.well); p.rect(gx - 4, gy - 4, C * cs + 8, R * cs + 8, 8);
  for (let i = 0; i < C; i++)
    for (let j = 0; j < R; j++) {
      const x = gx + i * cs + 1.5, y = gy + j * cs + 1.5, s = cs - 3;
      if (painted(i, j)) {
        const t = (i + j) / (C + R - 2);
        const a = p.color(...PAL.sun), b = p.color(...PAL.rose), c = p.color(...PAL.lilac);
        p.fill(t < 0.5 ? p.lerpColor(a, b, t * 2) : p.lerpColor(b, c, (t - 0.5) * 2));
        p.rect(x, y, s, s, 5);
      } else {
        tile(p, x, y, s, PAL.panel, 5);
        if (crossed(i, j)) {
          p.stroke(...PAL.dim); p.strokeWeight(2.5); p.strokeCap(p.ROUND);
          const k = s * 0.28;
          p.line(x + k, y + k, x + s - k, y + s - k); p.line(x + s - k, y + k, x + k, y + s - k);
          p.noStroke();
        }
      }
    }
}

function drawConway(p, w, h) {
  previewBg(p, w, h);
  const cs = 14;
  const offX = Math.floor(w / 2), offY = Math.floor(h / 2);
  // Gosper glider gun snapshot (partial) + a few escaping gliders
  const pts = [
    [-18,-3],[-18,-2],[-17,-3],[-17,-2],
    [-8,-3],[-8,-2],[-8,-1],[-7,-4],[-7,0],[-6,-5],[-6,1],[-5,-5],[-5,1],[-4,-4],[-4,0],[-3,-3],[-3,-2],[-3,-1],[-2,-2],
    [1,-4],[1,-3],[1,-2],[2,-5],[2,-1],[3,-6],[3,0],[4,-6],[4,0],[5,-5],[5,-1],[6,-4],[6,-3],[6,-2],[7,-3],
    [11,-5],[11,-4],[12,-5],[12,-4],
    [-14,6],[-13,7],[-15,8],[-14,8],[-13,8],
    [-5,9],[-4,10],[-6,11],[-5,11],[-4,11],
    [5,5],[6,6],[4,7],[5,7],[6,7],
  ];
  p.fill(...PAL.well);
  for (let x = -22; x <= 22; x++) for (let y = -13; y <= 13; y++) p.circle(offX + x * cs, offY + y * cs, 1.6);
  p.noStroke();
  for (const [cx, cy] of pts) {
    const roll = Math.abs((cx * 31 + cy * 17) % 20);
    const col = roll < 3 ? PAL.aqua : roll < 10 ? PAL.mint : roll < 16 ? PAL.sun : PAL.peach;
    p.fill(...col);
    p.rect(offX + cx * cs + 1, offY + cy * cs + 1, cs - 2, cs - 2, 3);
  }
}

function draw2048(p, w, h) {
  previewBg(p, w, h);
  const N = 4, cs = 66, gap = 8, pad = 12;
  const bw = cs * N + gap * (N - 1) + pad * 2;
  const ox = (w - bw) / 2, oy = (h - bw) / 2;
  const snap = [
    [2, 0, 4, 8],
    [0, 16, 32, 64],
    [4, 128, 256, 512],
    [8, 1024, 2048, 0],
  ];
  const COL = {};
  PAL.tiles.forEach((c, k) => { COL[2 << k] = c; });
  const lightFg = (v) => { const [r, g, b] = COL[v]; return (0.299 * r + 0.587 * g + 0.114 * b) / 255 <= 0.6; };
  p.noStroke(); p.fill(...PAL.well); p.rect(ox, oy, bw, bw, 16);
  p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const x = ox + pad + c * (cs + gap), y = oy + pad + r * (cs + gap), v = snap[r][c];
      if (!v) { tile(p, x, y, cs, PAL.panel, cs * 0.14); continue; }
      if (v >= 128) { p.fill(...COL[v], 50); p.rect(x - 4, y - 4, cs + 8, cs + 8, cs * 0.2); }
      tile(p, x, y, cs, COL[v], cs * 0.14);
      p.fill(255, 255, 255, 16); p.rect(x, y, cs, cs * 0.5, cs * 0.14, cs * 0.14, 0, 0);
      p.fill(...(lightFg(v) ? PAL.onDark : PAL.onLight));
      p.textSize(cs * (v >= 1000 ? 0.3 : v >= 100 ? 0.36 : 0.44));
      p.text(v, x + cs / 2, y + cs / 2 + 1);
    }
}

function drawLightsOut(p, w, h) {
  previewBg(p, w, h);
  const N = 5, cs = 62;
  const ox = (w - N * cs) / 2, oy = (h - N * cs) / 2;
  const on = [
    [1, 0, 0, 1, 0],
    [0, 1, 0, 1, 1],
    [0, 0, 0, 0, 0],
    [1, 1, 0, 1, 0],
    [0, 1, 0, 0, 1],
  ];
  const ctr = (i) => i * cs + cs / 2;
  p.strokeCap(p.ROUND);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const x = ox + ctr(c), y = oy + ctr(r);
      for (const [x2, y2, lit] of [[x + cs, y, c < N - 1 && on[r][c] && on[r][c + 1]], [x, y + cs, r < N - 1 && on[r][c] && on[r + 1][c]]]) {
        if ((x2 > x && c === N - 1) || (y2 > y && r === N - 1)) continue;
        if (lit) { p.stroke(...PAL.sun, 40); p.strokeWeight(10); p.line(x, y, x2, y2); p.stroke(...PAL.sun, 230); p.strokeWeight(3.2); }
        else { p.stroke(...PAL.line); p.strokeWeight(3.2); }
        p.line(x, y, x2, y2);
      }
    }
  p.noStroke();
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const x = ox + ctr(c), y = oy + ctr(r);
      if (on[r][c]) {
        p.fill(...PAL.sun, 22); p.circle(x, y, cs * 0.78);
        p.fill(...PAL.sun, 55); p.circle(x, y, cs * 0.54);
        p.fill(...PAL.sun); p.circle(x, y, cs * 0.36);
        p.fill(...PAL.sunHi); p.circle(x - cs * 0.04, y - cs * 0.04, cs * 0.2);
      } else {
        p.fill(...PAL.panel); p.stroke(...PAL.line); p.strokeWeight(2.2); p.circle(x, y, cs * 0.36);
        p.noStroke(); p.fill(...PAL.well); p.circle(x, y, cs * 0.14);
      }
    }
}

function drawTicTacToe(p, w, h) {
  previewBg(p, w, h);
  const board = 300, gap = 10, big = (board - gap * 2) / 3, small = big / 3;
  const ox = (w - board) / 2, oy = (h - board) / 2;
  const XC = PAL.mint, OC = PAL.sky;
  const sub = [
    [1,2,0, 0,1,0, 2,0,0],
    [0,0,0, 0,2,0, 0,0,0],
    [2,1,0, 0,0,0, 0,0,1],
    [0,0,0, 1,0,0, 0,0,0],
    [1,1,1, 2,2,0, 0,1,0],
    [0,2,0, 0,0,0, 0,0,0],
    [2,0,1, 0,0,0, 0,0,0],
    [0,0,0, 0,2,0, 1,0,0],
    [0,0,0, 0,0,0, 0,0,0],
  ];
  const mark = (cx, cy, s, m, a) => {
    p.noFill();
    if (m === 1) {
      p.stroke(...XC, a); p.strokeWeight(Math.max(2, s * 0.12)); p.strokeCap(p.ROUND);
      const k = s * 0.28; p.line(cx - k, cy - k, cx + k, cy + k); p.line(cx + k, cy - k, cx - k, cy + k);
    } else {
      p.stroke(...OC, a); p.strokeWeight(Math.max(2, s * 0.1)); p.circle(cx, cy, s * 0.58);
    }
  };
  for (let b = 0; b < 9; b++) {
    const x = ox + (b % 3) * (big + gap), y = oy + Math.floor(b / 3) * (big + gap);
    if (b === 4) { p.noStroke(); p.fill(...XC, 22); p.rect(x - 2, y - 2, big + 4, big + 4, 10); }
    if (b === 7) { p.fill(...OC, 16); p.stroke(...OC, 120); p.strokeWeight(1.5); p.rect(x - 2, y - 2, big + 4, big + 4, 10); }
    p.stroke(...PAL.line); p.strokeWeight(2); p.strokeCap(p.ROUND);
    for (let g = 1; g < 3; g++) {
      p.line(x + g * small, y + 6, x + g * small, y + big - 6);
      p.line(x + 6, y + g * small, x + big - 6, y + g * small);
    }
    for (let i = 0; i < 9; i++) if (sub[b][i]) mark(x + (i % 3) * small + small / 2, y + Math.floor(i / 3) * small + small / 2, small, sub[b][i], 255);
    if (b === 4) mark(x + big / 2, y + big / 2, big * 0.9, 1, 70);
  }
  p.stroke(...PAL.lineHi); p.strokeWeight(4);
  for (let g = 1; g < 3; g++) {
    const o = g * big + (g - 0.5) * gap;
    p.line(ox + o, oy - 4, ox + o, oy + board + 4);
    p.line(ox - 4, oy + o, ox + board + 4, oy + o);
  }
}

// Klick-Rennen (hub only): a big button and a live scoreboard
function drawClickRace(p, w, h) {
  previewBg(p, w, h);
  p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD);
  p.noStroke(); p.fill(...PAL.mint, 40); p.rect(w / 2 - 130, 70, 260, 120, 22);
  p.stroke(...PAL.mint); p.strokeWeight(3); p.noFill(); p.rect(w / 2 - 130, 70, 260, 120, 22);
  p.noStroke(); p.fill(...PAL.mint); p.textSize(44); p.text("KLICK!", w / 2, 130);
  p.fill(...PAL.ink); p.textSize(30); p.text("0:09", w / 2, 40);
  const rows = [["Mia", 64, PAL.sky], ["Ben", 51, PAL.rose], ["Du", 47, PAL.lilac]];
  rows.forEach(([n, v, c], i) => {
    const y = 226 + i * 38;
    p.fill(...PAL.panel); p.rect(w / 2 - 170, y, 340, 30, 8);
    p.fill(...c, 90); p.rect(w / 2 - 170, y, 340 * v / 64, 30, 8);
    p.fill(...PAL.ink); p.textSize(15); p.textAlign(p.LEFT, p.CENTER); p.text(n, w / 2 - 158, y + 15);
    p.textAlign(p.RIGHT, p.CENTER); p.text(v, w / 2 + 158, y + 15);
  });
}

function drawWortbombe(p, w, h) {
  p.background(72, 63, 56);
  p.noStroke();
  for (let k = 5; k >= 1; k--) { p.fill(96, 84, 74, 22); p.ellipse(w / 2, h / 2, w * (0.25 + k * 0.1), h * (0.3 + k * 0.12)); }
  const cx = w / 2, cy = h / 2, R = 118;
  const names = ["Mia", "Ben", "Lena", "Du", "Tom", "Ida"], lives = [3, 2, 3, 1, 2, 3];
  p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD);
  for (let i = 0; i < 6; i++) {
    const a = (-120 + 60 * i) * Math.PI / 180, x = cx + Math.cos(a) * R * 1.45, y = cy + Math.sin(a) * R * 0.95, s = 40;
    p.fill(...PAL.panel); p.rect(x - s / 2, y - s / 2, s, s, 4);
    p.fill(...[PAL.sky, PAL.rose, PAL.mint, PAL.lilac, PAL.sun, PAL.sky][i], 140); p.rect(x - s / 2, y - s / 2, s, s, 4);
    p.fill(240); p.textSize(13); p.text(names[i], x, y - s / 2 - 17);
    p.fill(226, 52, 52);
    for (let k = 0; k < lives[i]; k++) p.circle(x - 11 + k * 11, y - s / 2 - 3, 9);
  }
  // Pfeil zum Spieler "Du"
  const ta = (-120 + 180) * Math.PI / 180;
  p.stroke(240, 208, 51); p.strokeWeight(6); p.strokeCap(p.ROUND);
  p.line(cx - Math.cos(ta) * 30, cy - Math.sin(ta) * 30, cx + Math.cos(ta) * 108, cy + Math.sin(ta) * 74);
  p.noStroke(); p.fill(240, 208, 51);
  p.push(); p.translate(cx + Math.cos(ta) * 120, cy + Math.sin(ta) * 80); p.rotate(Math.atan2(Math.sin(ta) * 80, Math.cos(ta) * 120)); p.triangle(8, 0, -8, -9, -8, 9); p.pop();
  // Bombe mit Buchstaben
  p.fill(58, 50, 44); p.stroke(36, 31, 27); p.strokeWeight(4); p.circle(cx, cy, 78);
  p.noStroke(); p.fill(246, 198, 14); p.circle(cx + 28, cy - 36, 14);
  p.fill(255); p.textSize(30); p.text("EN", cx, cy + 1);
}

function drawPanzer(p, w, h) {
  const sky = p.drawingContext.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#10143a"); sky.addColorStop(0.55, "#4a2f72"); sky.addColorStop(1, "#e8756a");
  p.drawingContext.fillStyle = sky; p.drawingContext.fillRect(0, 0, w, h);
  p.noStroke();
  p.fill(255, 214, 150, 230); p.circle(w * 0.7, h * 0.5, 70);
  const bump = (x, c, s) => Math.exp(-Math.pow((x - c) / s, 2));
  const gy = (x) => h * 0.7 - 60 * bump(x, w * 0.5, 90) - 18 * Math.sin(x * 0.012) - 40 * bump(x, w * 0.86, 60);
  const crater = (x) => { const d = (x - w * 0.62) / 34; return Math.abs(d) < 1 ? 34 * Math.sqrt(1 - d * d) : 0; };
  p.fill(94, 66, 44); p.beginShape(); p.vertex(0, h);
  for (let x = 0; x <= w; x += 6) p.vertex(x, gy(x) + crater(x));
  p.vertex(w, h); p.endShape(p.CLOSE);
  p.noFill(); p.stroke(111, 205, 90); p.strokeWeight(5); p.beginShape();
  for (let x = 0; x <= w; x += 6) p.vertex(x, gy(x) + crater(x));
  p.endShape();
  p.noStroke();
  const tank = (x, col, a) => {
    const y = gy(x);
    p.push(); p.translate(x, y);
    p.fill(36, 38, 48); p.rect(-22, -11, 44, 12, 6);
    p.fill(...col); p.rect(-18, -21, 36, 12, 4); p.arc(0, -17, 20, 20, p.PI, 0);
    p.stroke(...col); p.strokeWeight(5); p.line(0, -18, Math.cos(a) * 30, -18 - Math.sin(a) * 30);
    p.pop();
  };
  tank(w * 0.16, PAL.sky, 0.9); tank(w * 0.84, PAL.rose, 2.4);
  p.noStroke(); p.fill(255, 240, 190, 90); for (let k = 0; k < 7; k++) p.circle(w * 0.16 + 40 + k * 46, h * 0.7 - 70 - Math.sin(k / 6 * Math.PI) * 90 + k * 6, 6);
  p.fill(255, 210, 120); p.circle(w * 0.62, gy(w * 0.62) - 6, 24); p.fill(255, 255, 255, 200); p.circle(w * 0.62, gy(w * 0.62) - 6, 11);
  p.fill(12, 12, 28, 200); p.rect(w / 2 - 120, 14, 240, 28, 8);
  p.fill(...PAL.sky); p.rect(w / 2 - 112, 30, 100, 6, 3); p.fill(...PAL.rose); p.rect(w / 2 + 12, 30, 70, 6, 3);
}

function drawKaboom(p, w, h) {
  // KABOOM (hub-games/kaboom.js): mid-round snapshot — a fresh bomb, a flame cross, three players, extras
  previewBg(p, w, h);
  p.noStroke();
  const C = 15, R = 11, cs = 28, ox = (w - C * cs) / 2, oy = (h - R * cs) / 2;
  const rows = [                                          // x = 1…13 of rows 1…9; walls come from the pattern
    "....CC.C.CC..", ".WCW.WCW.WCW.", "CC.C.C...C.CC", ".WCWCW.W.WCW.", "C.CC.C.....C.",
    ".W.WCWCW.WCWC", "CC.C..C......", ".WCW.WCWCW.W.", ".CC...CC.C...",
  ];
  const wall = (x, y) => x === 0 || y === 0 || x === C - 1 || y === R - 1 || (x % 2 === 0 && y % 2 === 0);
  const dk = (c, f) => c.map((v) => v * (1 - f)), lt = (c, f) => c.map((v) => v + (255 - v) * f);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const X = ox + x * cs, Y = oy + y * cs;
    p.fill(...((x + y) % 2 ? PAL.well : PAL.board)); p.rect(X, Y, cs, cs);
    if (wall(x, y)) {
      p.fill(...PAL.panelHi); p.rect(X, Y, cs, cs);
      p.fill(...lt(PAL.panelHi, 0.16)); p.rect(X, Y, cs, 4);
      p.fill(...PAL.line); p.rect(X, Y + cs - 6, cs, 6);
    } else if (y >= 1 && y <= 9 && rows[y - 1][x - 1] === "C") {
      p.fill(...dk(PAL.peach, 0.5)); p.rect(X + 3, Y + 2, cs - 6, cs - 5, 5);
      p.fill(...PAL.peach); p.rect(X + 5, Y + 4, cs - 10, cs - 9, 3);
      p.fill(...dk(PAL.peach, 0.35)); p.rect(X + 4, Y + 8, cs - 8, 3); p.rect(X + 4, Y + cs - 11, cs - 8, 3);
    }
  }
  const at = (x, y) => [ox + x * cs + cs / 2, oy + y * cs + cs / 2];
  // flame cross around (9, 5), range 2
  const [fx, fy] = at(9, 5);
  for (const [col, hw] of [[PAL.rose, 12], [PAL.sun, 8], [PAL.sunHi, 4]]) {
    p.fill(...col);
    p.rect(fx - 2 * cs - cs / 2 + 4, fy - hw, 5 * cs - 8, hw * 2, hw);
    p.rect(fx - hw, fy - 2 * cs - cs / 2 + 4, hw * 2, 5 * cs - 8, hw);
  }
  // extras
  const item = (x, y, col) => { const [cx, cy] = at(x, y); p.fill(...PAL.lineHi); p.rect(cx - 12, cy - 12, 24, 24, 4); p.fill(...PAL.panel); p.rect(cx - 10, cy - 10, 20, 20, 3); p.fill(...col); p.circle(cx, cy, 11); };
  item(7, 3, PAL.rose); item(5, 7, PAL.sky); item(12, 9, PAL.mine);
  // a fresh bomb next to mint
  const [bx, by] = at(3, 1);
  p.fill(...dk(PAL.mine, 0.5)); p.circle(bx, by + 1, 22); p.fill(...PAL.mine); p.circle(bx, by + 1, 18);
  p.fill(...PAL.mineHi); p.circle(bx - 4, by - 3, 5);
  p.stroke(...PAL.muted); p.strokeWeight(2); p.line(bx + 4, by - 8, bx + 8, by - 13); p.noStroke();
  p.fill(...PAL.sunHi); p.circle(bx + 9, by - 14, 5); p.fill(...PAL.sun, 160); p.circle(bx + 9, by - 14, 9);
  // players
  const guy = (x, y, col, dir) => {
    const [cx, cy] = at(x, y);
    p.fill(0, 0, 0, 50); p.ellipse(cx, cy + 11, 20, 5);
    p.fill(...dk(col, 0.55)); p.rect(cx - 10, cy - 11, 20, 21, 8);
    p.fill(...col); p.rect(cx - 8, cy - 9, 16, 17, 6);
    p.fill(...lt(col, 0.45)); p.rect(cx - 6, cy - 7, 3, 4, 1);
    p.fill(...lt(col, 0.92)); p.rect(cx - 5 + dir * 2, cy - 3, 4, 5, 1); p.rect(cx + 1 + dir * 2, cy - 3, 4, 5, 1);
    p.fill(...dk(col, 0.82)); p.rect(cx - 5 + dir * 3, cy, 2, 2); p.rect(cx + 1 + dir * 3, cy, 2, 2);
    p.fill(...dk(col, 0.55)); p.rect(cx - 1, cy - 16, 2, 5); p.fill(...lt(col, 0.45)); p.circle(cx, cy - 17, 5);
  };
  guy(1, 2, PAL.mint, 0); guy(11, 7, PAL.sky, -1); guy(5, 9, PAL.rose, 1);
}

function drawFlood(p, w, h) {
  previewBg(p, w, h);
  const N = 10, cs = 26, SW = 44;
  const bw = cs * N;
  const ox = (w - bw) / 2, oy = (h - bw - SW) / 2;
  const PALETTE = PAL.flood;
  const L = [
    [1,1,1,1,2,2,3,3,0,0],
    [1,1,1,2,2,3,3,0,0,4],
    [1,1,1,1,2,3,3,0,4,4],
    [1,1,1,2,2,3,0,0,4,5],
    [1,1,1,1,3,3,0,4,4,5],
    [1,1,2,2,3,0,0,4,5,5],
    [1,1,1,2,3,3,4,4,5,5],
    [1,1,2,2,3,0,4,5,5,3],
    [1,1,1,3,3,0,0,4,5,3],
    [1,1,2,3,3,4,4,5,3,3],
  ];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) tile(p, ox + c * cs, oy + r * cs, cs - 2, PALETTE[L[r][c]], 4);
  // territory outline
  p.noFill(); p.stroke(...PAL.ink, 230); p.strokeWeight(2.5); p.strokeJoin(p.ROUND);
  const own = (r, c) => r >= 0 && c >= 0 && r < N && c < N && L[r][c] === 1 && c <= 3;
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if (!own(r, c)) continue;
      const x = ox + c * cs - 1, y = oy + r * cs - 1;
      if (!own(r - 1, c)) p.line(x, y, x + cs, y);
      if (!own(r + 1, c)) p.line(x, y + cs, x + cs, y + cs);
      if (!own(r, c - 1)) p.line(x, y, x, y + cs);
      if (!own(r, c + 1)) p.line(x + cs, y, x + cs, y + cs);
    }
  const sw = bw / 6, sy = oy + bw + 12;
  for (let i = 0; i < 6; i++) {
    p.noStroke(); p.fill(...PALETTE[i], i === 1 ? 110 : 255);
    p.rect(ox + i * sw + 3, sy, sw - 6, SW - 14, 9);
    if (i === 1) { p.noFill(); p.stroke(...PAL.ink, 230); p.strokeWeight(2); p.rect(ox + i * sw + 3, sy, sw - 6, SW - 14, 9); }
  }
}

function drawSudoku(p, w, h) {
  previewBg(p, w, h);
  const N = 9, cs = 34;
  const bp = N * cs;
  const ox = (w - bp) / 2, oy = (h - bp) / 2;
  const grid = [
    [5,3,0, 0,7,0, 0,0,0],
    [6,0,0, 1,9,5, 0,0,0],
    [0,9,8, 0,0,0, 0,6,0],
    [8,0,0, 0,6,0, 0,0,3],
    [4,0,0, 8,5,3, 0,0,1],
    [7,0,0, 0,2,0, 0,0,6],
    [0,6,0, 0,0,0, 2,8,0],
    [0,0,0, 4,1,9, 0,0,5],
    [0,0,0, 0,8,0, 0,7,9],
  ];
  const mine = new Set(["4,4", "2,0", "6,5"]);
  grid[2][0] = 1; grid[6][5] = 7;
  p.noStroke(); p.fill(...PAL.well); p.rect(ox, oy, bp, bp, 10);
  p.fill(...PAL.lilac, 16); p.rect(ox, oy + 4 * cs, bp, cs); p.rect(ox + 4 * cs, oy, cs, bp);
  p.fill(...PAL.lilac, 70); p.rect(ox + 4 * cs + 1, oy + 4 * cs + 1, cs - 2, cs - 2, 4);
  p.textAlign(p.CENTER, p.CENTER);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const v = grid[r][c];
      if (!v) continue;
      const m = mine.has(r + "," + c);
      p.fill(...(m ? PAL.sky : PAL.ink));
      p.textStyle(m ? p.NORMAL : p.BOLD);
      p.textSize(cs * (m ? 0.56 : 0.52));
      p.text(v, ox + c * cs + cs / 2, oy + r * cs + cs / 2 + 1);
    }
  // pencil notes in one cell
  p.textStyle(p.NORMAL); p.textSize(9); p.fill(...PAL.muted);
  [[1, 0], [2, 0], [1, 2]].forEach(([a, b], k) => p.text([2, 4, 7][k], ox + 1 * cs + 6 + a * 10, oy + 2 * cs + 7 + b * 10));
  p.stroke(...PAL.line); p.strokeWeight(1);
  for (let i = 1; i < N; i++) {
    if (i % 3) { p.line(ox + i * cs, oy + 4, ox + i * cs, oy + bp - 4); p.line(ox + 4, oy + i * cs, ox + bp - 4, oy + i * cs); }
  }
  p.stroke(...PAL.lineHi); p.strokeWeight(2.5); p.strokeCap(p.ROUND);
  for (let i = 3; i < N; i += 3) { p.line(ox + i * cs, oy + 2, ox + i * cs, oy + bp - 2); p.line(ox + 2, oy + i * cs, ox + bp - 2, oy + i * cs); }
  p.noFill(); p.rect(ox, oy, bp, bp, 10);
}

function drawNetwalk(p, w, h) {
  previewBg(p, w, h);
  const SZ = 6, cs = 50;
  const bw = cs * SZ;
  const ox = (w - bw) / 2, oy = (h - bw) / 2;
  const Nd = 1, Ed = 2, Sd = 4, Wd = 8;
  const DX = { 1: 0, 2: 1, 4: 0, 8: -1 }, DY = { 1: -1, 2: 0, 4: 1, 8: 0 }, OPP = { 1: 4, 2: 8, 4: 1, 8: 2 };
  const src = { r: 2, c: 2 };
  const layout = [
    [Ed|Sd, Sd|Wd, Ed|Sd, Sd|Wd, Ed,    Sd|Wd],
    [Nd,    Nd|Sd, Nd|Sd, Nd|Ed, Sd|Wd, Nd|Sd],
    [Ed|Sd, Nd|Sd|Wd, Nd, Sd,   Nd|Ed, Nd|Sd|Wd],
    [Nd|Sd, Nd,    Ed|Sd, Nd|Ed|Sd|Wd, Wd, Nd|Sd],
    [Nd|Ed|Sd, Sd|Wd, Nd|Sd, Nd|Sd, Ed|Sd, Nd|Wd],
    [Nd,    Nd|Ed, Nd|Wd, Nd|Ed, Nd|Ed|Wd, Wd],
  ];
  const lit = [
    [0,0,1,1,1,1],
    [0,0,1,1,1,1],
    [0,0,1,0,1,1],
    [0,0,0,0,0,1],
    [0,0,0,0,1,1],
    [0,0,0,0,1,0],
  ];
  p.noStroke(); p.fill(...PAL.well); p.rect(ox - 6, oy - 6, bw + 12, bw + 12, 12);
  p.fill(255, 255, 255, 6);
  for (let r = 0; r < SZ; r++) for (let c = 0; c < SZ; c++) p.rect(ox + c * cs + 2, oy + r * cs + 2, cs - 4, cs - 4, 8);
  for (let r = 0; r < SZ; r++)
    for (let c = 0; c < SZ; c++) {
      const m = layout[r][c], on = !!lit[r][c];
      const cx = ox + c * cs + cs / 2, cy = oy + r * cs + cs / 2;
      for (const d of [Nd, Ed, Sd, Wd]) {
        if (!(m & d)) continue;
        const nr = r + DY[d], nc = c + DX[d];
        const touch = nr >= 0 && nr < SZ && nc >= 0 && nc < SZ && (layout[nr][nc] & OPP[d]);
        const len = touch ? cs / 2 : cs * 0.43;
        p.strokeCap(touch ? p.SQUARE : p.ROUND);
        if (on) { p.stroke(...PAL.aqua, 45); p.strokeWeight(cs * 0.36); p.line(cx, cy, cx + DX[d] * len, cy + DY[d] * len); }
        p.stroke(...(on ? PAL.aqua : PAL.dim)); p.strokeWeight(cs * 0.19);
        p.line(cx, cy, cx + DX[d] * len, cy + DY[d] * len);
      }
      p.noStroke(); p.fill(...(on ? PAL.aquaHi : PAL.dim)); p.circle(cx, cy, cs * 0.22);
    }
  const sx = ox + src.c * cs + cs / 2, sy = oy + src.r * cs + cs / 2;
  p.fill(...PAL.sun, 40); p.circle(sx, sy, cs * 0.66);
  p.fill(...PAL.sun); p.circle(sx, sy, cs * 0.4);
  p.noFill(); p.stroke(...PAL.dim); p.strokeWeight(2); p.circle(ox + 0.5 * cs, oy + 1.5 * cs, cs * 0.5);
}

function drawBlackjack(p, w, h) {
  // 90s casino: carpet, brass-framed felt
  p.background(34, 10, 44);
  p.noStroke();
  for (let k = 0; k < 14; k++) for (let m = 0; m < 9; m++) { p.fill(236, 86, 170, 38); p.quad(k * 48 + 24, m * 48 - 6, k * 48 + 30, m * 48, k * 48 + 24, m * 48 + 6, k * 48 + 18, m * 48); }
  p.fill(244, 200, 92); p.rect(18, 14, w - 36, h - 28, 22);
  p.fill(160, 112, 28); p.rect(21, 17, w - 42, h - 34, 20);
  for (let k = 12; k >= 0; k--) { p.fill(14 + k * 2, 100 + k * 5, 66 + k * 3); p.rect(26 + k * 6, 22 + k * 4, w - 52 - k * 12, h - 44 - k * 8, 16); }
  const cw = 70, ch = 98;
  const RANK = [null, "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suit = (s, cx, cy, z, col) => {
    p.noStroke(); p.fill(...col);
    if (s === 0) {
      p.circle(cx - z * 0.24, cy + z * 0.1, z * 0.52); p.circle(cx + z * 0.24, cy + z * 0.1, z * 0.52);
      p.triangle(cx - z * 0.49, cy + z * 0.04, cx + z * 0.49, cy + z * 0.04, cx, cy - z * 0.52);
      p.triangle(cx, cy + z * 0.1, cx - z * 0.2, cy + z * 0.5, cx + z * 0.2, cy + z * 0.5);
    } else if (s === 1) {
      p.circle(cx - z * 0.24, cy - z * 0.14, z * 0.52); p.circle(cx + z * 0.24, cy - z * 0.14, z * 0.52);
      p.triangle(cx - z * 0.49, cy - z * 0.06, cx + z * 0.49, cy - z * 0.06, cx, cy + z * 0.5);
    } else if (s === 2) {
      p.quad(cx, cy - z * 0.52, cx + z * 0.38, cy, cx, cy + z * 0.52, cx - z * 0.38, cy);
    } else {
      p.circle(cx, cy - z * 0.2, z * 0.44); p.circle(cx - z * 0.23, cy + z * 0.1, z * 0.44); p.circle(cx + z * 0.23, cy + z * 0.1, z * 0.44);
      p.triangle(cx, cy, cx - z * 0.2, cy + z * 0.5, cx + z * 0.2, cy + z * 0.5);
    }
  };
  const face = (x, y, r, s) => {
    p.fill(0, 0, 0, 40); p.noStroke(); p.rect(x + 1, y + 4, cw, ch, 9);
    PlayingCards.face(p.drawingContext, x, y, cw, ch, r, s);
  };
  const back = (x, y) => PlayingCards.back(p.drawingContext, x, y, cw, ch);
  const chip = (cx, cy, rad, v, col) => {
    p.noStroke(); p.fill(0, 0, 0, 40); p.circle(cx + 1, cy + 3, rad * 2);
    p.fill(...col); p.circle(cx, cy, rad * 2);
    p.stroke(250, 248, 240, 230); p.strokeWeight(rad * 0.2); p.strokeCap(p.SQUARE);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; p.line(cx + Math.cos(a) * rad * 0.82, cy + Math.sin(a) * rad * 0.82, cx + Math.cos(a) * rad * 0.98, cy + Math.sin(a) * rad * 0.98); }
    p.noFill(); p.stroke(250, 248, 240, 220); p.strokeWeight(1.2); p.circle(cx, cy, rad * 1.3);
    p.noStroke(); p.fill(250, 248, 240); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(rad * (v >= 100 ? 0.62 : 0.72)); p.text(v, cx, cy + 1);
  };
  const badge = (cx, cy, txt, col, ink) => {
    p.textSize(15); p.textStyle(p.BOLD);
    const bw = p.textWidth(txt) + 20;
    p.noStroke(); p.fill(...col); p.rect(cx - bw / 2, cy - 12, bw, 24, 12);
    p.fill(...ink); p.textAlign(p.CENTER, p.CENTER); p.text(txt, cx, cy + 0.5);
  };
  // dealer: 9 + hole card, you: K + A (blackjack); drawn in a 1.15× scaled frame around the centre
  p.push(); p.translate(w / 2, h / 2); p.scale(1.15); p.translate(-w / 2, -h / 2);
  const dx = w / 2 - cw - 6, dy = 62, py = 188;
  face(dx, dy, 9, 2); back(dx + cw + 12, dy);
  face(dx - 6, py, 13, 0); face(dx + cw + 6, py - 4, 1, 1);
  badge(dx - 40, dy + 14, "9", [10, 10, 12], [255, 176, 40]);
  badge(dx - 40, py + 14, "21", [10, 10, 12], [120, 255, 160]);
  // chip stack bottom-left, shoe top-right
  chip(150, 270, 24, 100, [36, 36, 44]); chip(150, 261, 24, 50, [200, 32, 46]); chip(150, 252, 24, 10, [40, 100, 214]);
  back(430, 62); back(432, 64);
  p.pop();
}

function drawSolitaire(p, w, h) {
  // static Klondike snapshot: stock + waste + foundations on top, a few tableau columns below
  previewBg(p, w, h);
  const cw = 48, ch = 68, gap = 8;
  const ox = (w - (7 * cw + 6 * gap)) / 2;
  const colX = (i) => ox + i * (cw + gap);
  const card = (x, y, r, s) => {
    p.noStroke(); p.fill(0, 0, 0, 50); p.rect(x + 2, y + 3, cw, ch, 6);
    PlayingCards.face(p.drawingContext, x, y, cw, ch, r, s);
  };
  const back = (x, y) => {
    p.noStroke(); p.fill(0, 0, 0, 50); p.rect(x + 2, y + 3, cw, ch, 6);
    PlayingCards.back(p.drawingContext, x, y, cw, ch);
  };
  const slot = (x, y) => { p.noFill(); p.stroke(...PAL.lineHi); p.strokeWeight(1.2); p.rect(x, y, cw, ch, 6); p.noStroke(); };
  const top = 26;
  back(colX(0), top);
  card(colX(1), top, 7, 1);
  card(colX(3), top, 1, 0);
  card(colX(4), top, 2, 1);
  slot(colX(5), top); slot(colX(6), top);
  // tableau: "d" = face-down, [rank, suit] = face-up (top of each column last)
  const T = [
    ["d", "d", "d", [13, 2]],
    ["d", "d", [12, 3], [11, 1], [10, 0]],
    ["d", "d", "d", "d", [6, 2]],
    ["d", [9, 2], [8, 3]],
    ["d", "d", [5, 0], [4, 1]],
    ["d", "d", "d", [3, 3]],
    ["d", "d", "d", "d", [12, 0], [11, 2]],
  ];
  const y0 = top + ch + 26;
  T.forEach((col, c) => {
    let y = y0;
    col.forEach((e) => {
      if (e === "d") { back(colX(c), y); y += 11; }
      else { card(colX(c), y, e[0], e[1]); y += 19; }
    });
  });
}

function drawKniffel(p, w, h) {
  // wooden table, felt tray with a rack of held dice, hand-written score card
  const ctx = p.drawingContext;
  p.background(58, 36, 20);
  p.noStroke();
  for (let i = 0; i < 12; i++) { p.fill(i % 2 ? 80 : 46, i % 2 ? 50 : 28, i % 2 ? 28 : 15, 150); p.rect(0, i * 31 - 4, w, 15 + (i * 7) % 9); }
  // tray
  p.fill(0, 0, 0, 70); p.rect(26, 66, 322, 206, 22);
  p.fill(120, 62, 32); p.rect(22, 58, 322, 206, 22);
  p.fill(176, 98, 52); p.rect(22, 58, 322, 12, 22, 22, 0, 0);
  p.fill(30, 98, 64); p.rect(36, 72, 294, 178, 12);
  for (let i = 0; i < 500; i++) { p.fill(60 + (i * 37) % 30, 140, 96, 60); p.rect(40 + (i * 53) % 286, 76 + (i * 29) % 170, 1.5, 1.5); }
  // rack
  p.fill(0, 0, 0, 60); p.rect(70, 284, 240, 56, 10);
  p.fill(112, 58, 30); p.rect(66, 278, 240, 56, 10);
  p.noFill(); p.stroke(20, 8, 2, 130); p.strokeWeight(1.4);
  for (let i = 0; i < 5; i++) p.rect(78 + i * 45, 290, 36, 36, 6);
  const PIP = { 1: [[.5, .5]], 2: [[.28, .28], [.72, .72]], 3: [[.28, .28], [.5, .5], [.72, .72]], 4: [[.28, .28], [.72, .28], [.28, .72], [.72, .72]], 5: [[.28, .28], [.72, .28], [.5, .5], [.28, .72], [.72, .72]], 6: [[.28, .28], [.28, .5], [.28, .72], [.72, .28], [.72, .5], [.72, .72]] };
  const die = (x, y, s, n, rot, col, pip) => {
    p.push(); p.translate(x, y); p.rotate(rot);
    const d = s * 0.22;
    p.noStroke(); p.fill(0, 0, 0, 70); p.rect(-s / 2 + 5, -s / 2 + 8, s, s, s * 0.2);
    p.fill(col[0] * 0.72, col[1] * 0.72, col[2] * 0.72); p.quad(s / 2, -s / 2 + 3, s / 2 + d, -s / 2 - d * 0.6, s / 2 + d, s / 2 - d * 1.1, s / 2, s / 2 - 2);
    p.fill(Math.min(255, col[0] * 1.06), Math.min(255, col[1] * 1.06), Math.min(255, col[2] * 1.06)); p.quad(-s / 2 + 3, -s / 2, -s / 2 + 3 + d, -s / 2 - d * 0.6, s / 2 + d, -s / 2 - d * 0.6, s / 2, -s / 2);
    p.fill(...col); p.rect(-s / 2, -s / 2, s, s, s * 0.18);
    p.fill(...pip);
    for (const [px, py] of PIP[n]) p.circle((px - 0.5) * s, (py - 0.5) * s, s * 0.17);
    p.pop();
  };
  const W = [248, 243, 228], K = [24, 24, 30];
  die(104, 140, 50, 5, -0.18, W, K); die(176, 176, 50, 3, 0.22, W, K); die(246, 128, 50, 5, 0.1, W, K);
  die(214, 214, 50, 6, -0.3, W, K); die(142, 222, 50, 2, 0.4, W, K);
  die(98 + 45 * 0, 308, 30, 4, 0, W, K); die(98 + 45 * 3, 308, 30, 4, 0, W, K);
  // the card
  p.push(); p.translate(470, 180); p.rotate(0.03);
  p.fill(0, 0, 0, 80); p.rect(-102, -150, 210, 312, 4);
  p.fill(236, 230, 214); p.rect(-108, -154, 210, 312, 3);
  p.fill(252, 253, 255); p.rect(-104, -158, 210, 312, 3);
  p.fill(21, 151, 191); p.textStyle(p.BOLD); p.textAlign(p.LEFT, p.CENTER); p.textSize(26); p.text("Kniffel", -92, -134);
  p.stroke(29, 147, 184); p.strokeWeight(1.2);
  p.line(-92, -112, 94, -112);
  const x0 = -94, x1 = 94, cols = [-14.5, 16.5, 47.5, 78.5];          // centres of the four game columns
  for (let r = 0; r < 14; r++) p.line(x0, -98 + r * 17.2, x1, -98 + r * 17.2);
  for (const x of [x0, -30, 1, 32, 63, x1]) p.line(x, -98, x, -98 + 14 * 17.2);
  p.noStroke(); p.fill(29, 147, 184, 140);
  for (let r = 0; r < 13; r++) p.rect(x0 + 5, -98 + r * 17.2 + 7, 24 + (r * 11) % 12, 2.4, 1.2);
  // handwritten numbers
  const DIG = { 0: "M3.2.5C1.4.3.5 2.8.5 5c0 2.4 1 4.9 2.6 4.9 1.8 0 2.8-2.5 2.8-4.9C5.9 2.6 5 .6 3.3.4", 1: "M1.2 2.6 3.6.6 3.5 9.9", 2: "M.8 2.5C1 1.2 2 .4 3.1.4c1.5 0 2.4 1 2.3 2.4-.1 1.4-1.8 2.8-3 4.3C1.7 8 1 8.8.6 9.8L5.9 9.6", 3: "M.8 1.7C1.4.7 2.2.4 3 .4c1.4 0 2.2.9 2.2 2.1 0 1.4-1.2 2.2-2.7 2.3 1.8 0 3.1.9 3.1 2.5 0 1.6-1.2 2.6-2.7 2.6C1.8 9.9 1 9.4.4 8.6", 4: "M4.3.4.4 6.6h5.4M4.5 2.6V9.9", 5: "M5.2.5H1.3L.9 4.6C1.7 4 2.6 3.8 3.3 3.8c1.6 0 2.5 1.3 2.5 2.9 0 1.9-1.2 3.1-2.8 3.1C1.8 9.8.9 9.3.4 8.5", 6: "M5 1C4.1.4 3.3.3 2.7.5 1.3 1.1.6 3.6.6 6.2.6 8.4 1.5 9.9 3.1 9.9c1.6 0 2.5-1.2 2.5-2.8 0-1.7-1-2.7-2.4-2.7C2 4.4 1 5.2.7 6.4", 8: "M3.1 4.7C1.6 4.5.9 3.5.9 2.5.9 1.3 1.8.4 3.1.4c1.3 0 2.1.9 2.1 2.1 0 1.1-.8 2-2.1 2.2C1.5 5 .5 6.1.5 7.4c0 1.5 1.1 2.5 2.6 2.5 1.5 0 2.7-1 2.7-2.5 0-1.3-1.1-2.4-2.7-2.7", 9: "M5.6 4.1C5.4 2 4.5.5 3.1.5 1.6.5.6 1.6.6 3.2c0 1.5 1.1 2.5 2.5 2.5 1.4 0 2.4-1 2.5-2.4C5.6 5.7 5.4 8.3 3.9 9.4c-.6.4-1.5.5-2.3.2" };
  const write = (txt, col, row, tint) => {
    let x = cols[col] - txt.length * 4 + 0.6;
    for (const ch of txt) {
      ctx.save(); ctx.translate(x, -98 + row * 17.2 + 3.4); ctx.scale(1.15, 1.15); ctx.lineWidth = 1.1; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = tint; ctx.stroke(new Path2D(DIG[ch])); ctx.restore(); x += 8;
    }
  };
  const ink = "#1a36a6";
  [["3", 0], ["6", 1], ["9", 2], ["12", 3], ["15", 4], ["18", 5], ["63", 6], ["35", 7], ["98", 8]].forEach(([n, r]) => write(n, 0, r, ink));
  [["2", 0], ["8", 1], ["6", 2], ["8", 3], ["20", 4], ["12", 5]].forEach(([n, r]) => write(n, 1, r, ink));
  write("25", 0, 10, ink); write("30", 0, 11, ink); write("24", 0, 12, ink); write("0", 1, 9, ink);
  p.pop();
}

// Mäxchen (hub only): the pub table — covered cups, one open claim, chalk marks
function drawMaexchen(p, w, h) {
  previewBg(p, w, h);
  const CLR = {
    woodLo: [64, 41, 27], wood: [98, 63, 41], woodHi: [128, 85, 55],
    feltLo: [19, 53, 41], feltHi: [43, 95, 72], chalk: [238, 232, 212],
    red: [198, 62, 50], brass: [214, 176, 104], die: [246, 237, 213], dieLo: [212, 197, 166], pip: [56, 46, 38],
  };
  p.textAlign(p.CENTER, p.CENTER);
  const die = (x, y, s, v, ang) => {
    p.push(); p.translate(x, y); p.rotate(ang); p.noStroke();
    p.fill(0, 0, 0, 26); p.rect(-s / 2 + 2, -s / 2 + 4, s, s, s * 0.22);
    p.fill(...CLR.dieLo); p.rect(-s / 2, -s / 2 + 2, s, s, s * 0.22);
    p.fill(...CLR.die); p.rect(-s / 2, -s / 2, s, s, s * 0.22);
    p.fill(255, 255, 255, 20); p.rect(-s / 2, -s / 2, s, s * 0.42, s * 0.22, s * 0.22, 0, 0);
    const PIPS = { 1: [[0, 0]], 2: [[-.27, -.27], [.27, .27]], 3: [[-.27, -.27], [0, 0], [.27, .27]], 4: [[-.27, -.27], [.27, -.27], [-.27, .27], [.27, .27]], 5: [[-.27, -.27], [.27, -.27], [0, 0], [-.27, .27], [.27, .27]], 6: [[-.27, -.27], [.27, -.27], [-.27, 0], [.27, 0], [-.27, .27], [.27, .27]] };
    p.fill(v === 1 ? CLR.red[0] : CLR.pip[0], v === 1 ? CLR.red[1] : CLR.pip[1], v === 1 ? CLR.red[2] : CLR.pip[2]);
    for (const [fx, fy] of PIPS[v] || []) p.circle(fx * s, fy * s, s * 0.13);
    p.pop();
  };
  const cup = (x, y, s) => {
    p.push(); p.translate(x, y); p.noStroke();
    p.fill(0, 0, 0, 18); p.ellipse(0, s * 0.46, s * 1.0, s * 0.24);
    p.fill(...CLR.dieLo); p.rect(-s * 0.36, -s * 0.42, s * 0.72, s * 0.84, s * 0.15);
    p.fill(...CLR.die); p.rect(-s * 0.36, -s * 0.46, s * 0.72, s * 0.84, s * 0.15);
    p.fill(...CLR.red); p.rect(-s * 0.36, s * 0.06, s * 0.72, s * 0.15);
    p.fill(255, 255, 255, 26); p.rect(-s * 0.36, -s * 0.46, s * 0.72, s * 0.28, s * 0.15, s * 0.15, 0, 0);
    p.fill(...CLR.chalk); p.textSize(s * 0.42); p.textStyle(p.BOLD); p.text("?", 0, s * 0.05);
    p.pop();
  };
  // the table
  for (let i = 8; i >= 0; i--) {
    const t = 1 - i / 8;
    p.fill(CLR.woodLo[0] + (CLR.woodHi[0] - CLR.woodLo[0]) * t, CLR.woodLo[1] + (CLR.woodHi[1] - CLR.woodLo[1]) * t, CLR.woodLo[2] + (CLR.woodHi[2] - CLR.woodLo[2]) * t);
    p.rect(20 + i, 26 + i, w - 40 - i * 2, h - 52 - i * 2, 20 - i * 1.2);
  }
  for (let i = 6; i >= 0; i--) {
    const t = 1 - i / 6;
    p.fill(CLR.feltLo[0] + (CLR.feltHi[0] - CLR.feltLo[0]) * t, CLR.feltLo[1] + (CLR.feltHi[1] - CLR.feltLo[1]) * t, CLR.feltLo[2] + (CLR.feltHi[2] - CLR.feltLo[2]) * t);
    p.rect(28 + i, 34 + i, w - 56 - i * 2, h - 68 - i * 2, 13 - i * 0.9);
  }
  p.noStroke(); p.textStyle(p.BOLD);
  // top: the opponent's covered cups
  cup(w / 2 - 46, 92, 62); cup(w / 2 + 46, 92, 62);
  p.fill(...CLR.chalk, 170); p.textSize(12); p.text("MIA · 2 STRICHE", w / 2, 58);
  // centre: the plaque with the live claim
  p.fill(0, 0, 0, 55); p.rect(w / 2 - 128, 152, 256, 74, 14);
  p.fill(...CLR.wood); p.rect(w / 2 - 132, 148, 256, 74, 14);
  p.fill(...CLR.woodHi); p.rect(w / 2 - 132, 148, 256, 38, 14, 14, 10, 10);
  p.noFill(); p.stroke(...CLR.brass, 180); p.strokeWeight(2); p.rect(w / 2 - 127, 153, 246, 64, 11);
  p.noStroke(); p.fill(...CLR.chalk); p.textSize(30); p.text("5·5", w / 2, 174);
  p.textSize(12); p.fill(...CLR.chalk, 190); p.text("PASCH 5ER · VON BEN", w / 2, 200);
  p.stroke(...CLR.brass, 110); p.strokeWeight(4); p.strokeCap(p.ROUND);
  p.line(w / 2 - 96, 214, w / 2 + 96, 214);
  p.stroke(...(CLR.red)); p.line(w / 2 - 96, 214, w / 2 - 96 + 0.6 * 192, 214);
  p.noStroke();
  // bottom: my dice, one #pip in red
  die(w / 2 - 46, 272, 62, 5, -0.04); die(w / 2 + 46, 272, 62, 3, 0.04);
  p.fill(...CLR.chalk, 170); p.textSize(12); p.text("DU · 1 STRICH", w / 2, 318);
  // strike chips
  for (let k = 0; k < 2; k++) { p.fill(...CLR.red, 220); p.circle(w / 2 + 130 + k * 16, 58, 12); }
  p.fill(...PAL.sky, 220); p.circle(w / 2 + 130, 318, 12);
}

// Kritzel-Revier: crayons scribbling territory on a sheet of drawing paper
function drawKritzel(p, w, h) {
  const PAPER = [246, 235, 210], PAPER_HI = [252, 245, 228], INK = [62, 47, 32], LINE = [214, 197, 160];
  const RED = [226, 84, 62], RED_D = [150, 42, 30], TEAL = [32, 156, 142], TEAL_D = [16, 100, 92];
  const STAR = [243, 192, 44], STAR_D = [166, 116, 18];
  const rnd = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

  p.background(...PAPER);
  p.noStroke();
  for (let k = 0; k < 130; k++) { p.fill(120, 96, 60, 14); p.circle(rnd(k + 1) * w, rnd(k + 51) * h, 1.6 + rnd(k + 101) * 2); }
  // the sheet
  p.fill(60, 42, 20, 35); p.rect(56, 62, w - 112, h - 122, 14);
  p.fill(...PAPER_HI, 170); p.stroke(...INK, 220); p.strokeWeight(3); p.rect(50, 56, w - 112, h - 122, 14);
  p.noStroke();
  // faint grid
  p.stroke(...LINE, 160); p.strokeWeight(1);
  const cs = 30, gx = 60, gy = 66, GC = 16, GR = 7;
  for (let i = 1; i < GC; i++) p.line(gx + i * cs, gy, gx + i * cs, gy + GR * cs);
  for (let j = 1; j < GR; j++) p.line(gx, gy + j * cs, gx + GC * cs, gy + j * cs);
  p.noStroke();
  // scribbled territory (red bottom-left, teal top-right)
  const scribble = (c, r, col, dark) => {
    const x = gx + c * cs, y = gy + r * cs, j = (c * 7 + r * 13) % 9 - 4;
    p.push(); p.translate(x + cs / 2 + j * 0.5, y + cs / 2 + ((c * 3 + r * 11) % 5 - 2) * 0.5);
    p.rotate((((c * 5 + r * 7) % 9) - 4) * 0.014);
    p.fill(...col, 225); p.rect(-cs / 2 - 2, -cs / 2 - 2, cs + 4, cs + 4, 4);
    p.stroke(...dark, 90); p.strokeWeight(2); p.strokeCap(p.ROUND);
    p.line(-cs * 0.3, -cs * 0.25, cs * 0.28, cs * 0.05);
    p.line(-cs * 0.2, cs * 0.22, cs * 0.32, -cs * 0.3);
    p.noStroke(); p.pop();
  };
  [[0, 4], [1, 4], [2, 4], [1, 5], [2, 5], [3, 5], [2, 6], [3, 6], [4, 6], [1, 3], [0, 5], [2, 3]].forEach(([c, r]) => scribble(c, r, RED, RED_D));
  [[11, 0], [12, 0], [13, 0], [12, 1], [13, 1], [14, 1], [13, 2], [14, 0], [10, 1], [14, 2]].forEach(([c, r]) => scribble(c, r, TEAL, TEAL_D));
  // coffee stain
  p.push(); p.translate(gx + 8.5 * cs, gy + 4.4 * cs);
  p.fill(150, 104, 58, 46); p.ellipse(0, 0, 52, 46);
  p.noFill(); p.stroke(122, 80, 42, 130); p.strokeWeight(3); p.ellipse(0, 0, 56, 50);
  p.noStroke(); p.fill(140, 96, 54, 90); p.circle(34, 16, 7); p.pop();
  // glitter star
  p.push(); p.translate(gx + 7.5 * cs, gy + 2.5 * cs); p.rotate(-0.1);
  p.fill(...STAR, 70); p.beginShape();
  for (let k = 0; k < 10; k++) { const a = -p.PI / 2 + k * p.PI / 5, rr = k % 2 ? 11 : 24; p.vertex(p.cos(a) * rr, p.sin(a) * rr); }
  p.endShape(p.CLOSE);
  p.fill(...STAR); p.stroke(...STAR_D); p.strokeWeight(2); p.beginShape();
  for (let k = 0; k < 10; k++) { const a = -p.PI / 2 + k * p.PI / 5, rr = k % 2 ? 5.5 : 13; p.vertex(p.cos(a) * rr, p.sin(a) * rr); }
  p.endShape(p.CLOSE); p.noStroke(); p.pop();
  // crayons with faces + name tags
  const crayon = (x, y, col, dark, tilt) => {
    p.push(); p.translate(x, y); p.rotate(tilt);
    p.noStroke(); p.fill(60, 42, 20, 40); p.ellipse(0, 17, 24, 8);
    p.stroke(...dark); p.strokeWeight(2); p.fill(...col); p.rect(-8, -21, 16, 34, 5, 5, 2, 2);
    p.noStroke(); p.fill(...col); p.triangle(-8, 13, 8, 13, 0, 24);
    p.fill(240, 226, 196); p.rect(-8, 9, 16, 5);
    p.fill(...col.map((v) => Math.min(255, v + 40))); p.rect(-8, -7, 16, 9, 2);
    p.fill(255, 252, 246); p.circle(-3.2, -15, 5.4); p.circle(3.2, -15, 5.4);
    p.fill(48, 34, 22); p.circle(-2.6, -15, 2.6); p.circle(3.8, -15, 2.6);
    p.pop();
  };
  const tag = (x, y, txt) => {
    p.textFont("Comic Sans MS"); p.textStyle(p.BOLD); p.textSize(11);
    const tw = p.textWidth(txt) + 14;
    p.noStroke(); p.fill(252, 246, 232, 230); p.stroke(...INK, 90); p.strokeWeight(1.2);
    p.rect(x - tw / 2, y - 9, tw, 17, 8);
    p.noStroke(); p.fill(...INK); p.textAlign(p.CENTER, p.CENTER); p.text(txt, x, y + 0.5);
  };
  crayon(gx + 5.5 * cs, gy + 4.6 * cs, RED, RED_D, -0.18); tag(gx + 5.5 * cs, gy + 4.6 * cs - 37, "Du");
  crayon(gx + 10.5 * cs, gy + 5.5 * cs, TEAL, TEAL_D, 0.22); tag(gx + 10.5 * cs, gy + 5.5 * cs - 37, "Mia");
  // clock + score chips
  p.textFont("Comic Sans MS"); p.textStyle(p.BOLD); p.textAlign(p.CENTER, p.CENTER);
  p.fill(...INK); p.textSize(24); p.text("0:21", gx + GC * cs / 2, gy - 22);
  p.fill(...LINE, 220); p.rect(gx + GC * cs / 2 - 70, gy - 10, 140, 5, 2.5);
  p.fill(...RED); p.rect(gx + GC * cs / 2 - 70, gy - 10, 140 * 0.3, 5, 2.5);
  p.textSize(15);
  p.textAlign(p.RIGHT, p.CENTER);
  p.fill(...RED); p.circle(gx + GC * cs - 66, gy + GR * cs + 22, 14);
  p.fill(...INK); p.text("38", gx + GC * cs - 22, gy + GR * cs + 22);
  p.textAlign(p.LEFT, p.CENTER);
  p.fill(...TEAL); p.circle(gx + 66, gy + GR * cs + 22, 14);
  p.fill(...INK); p.text("31", gx + 78, gy + GR * cs + 22);
}

// Mau-Mau (hub only): the wooden parlour table — striped card backs fanned
// along the edges, a slumping discard pile, sticker-style hand cards
function drawMaumau(p, w, h) {
  p.background(141, 63, 46);
  p.noStroke();
  // wooden planks
  for (let i = 0; i < 8; i++) {
    p.fill(120 + (i % 2) * 14, 50 + (i % 2) * 10, 34 + (i % 2) * 8, 200);
    p.rect(0, i * 45, w, 45);
    p.fill(60, 22, 12, 120); p.rect(0, i * 45, w, 2);
  }
  for (let k = 0; k < 200; k++) {                       // wood grain
    const a = ((k * 197 + 31) % 97) / 97, b = ((k * 283 + 59) % 89) / 89;
    p.fill(70, 26, 14, 30);
    p.rect(a * w, b * h, 10 + (k % 5) * 6, 1.2);
  }
  p.fill(0, 0, 0, 50);
  for (let i = 6; i >= 0; i--) { p.fill(40, 10, 4, 14); p.rect(14 - i, 10 - i, w - 28 + i * 2, h - 20 + i * 2, 20); }
  p.textAlign(p.CENTER, p.CENTER);
  const SUIT = { r: [217, 58, 43], y: [231, 156, 15], g: [47, 145, 71], b: [43, 111, 190], w: [42, 45, 52] };
  const SYM = { 10: "⊘", 11: "⇄", 12: "+2", 14: "+4" };
  const backCard = (x, y, s, rot) => {                  // striped back with MAU tag
    p.push(); p.translate(x, y); p.rotate(rot);
    const cw = s, ch = s / 0.66;
    p.fill(0, 0, 0, 60); p.rect(-cw / 2 + 2, -ch / 2 + 4, cw, ch, 7);
    for (let i = -5; i < 7; i++) {
      const STRIPE = [[232, 77, 138], [245, 166, 35], [53, 182, 176], [123, 92, 214]][((i % 4) + 4) % 4];
      p.fill(...STRIPE);
      p.quad(-cw / 2 + i * cw / 4, -ch / 2, -cw / 2 + (i + 1) * cw / 4, -ch / 2, -cw / 2 + (i + 1) * cw / 4 - 6, ch / 2, -cw / 2 + i * cw / 4 - 6, ch / 2);
    }
    p.noFill(); p.stroke(255); p.strokeWeight(2.5); p.rect(-cw / 2, -ch / 2, cw, ch, 7); p.noStroke();
    p.fill(38, 33, 42); p.rect(-cw * 0.32, -7, cw * 0.64, 14, 5);
    p.fill(255, 217, 77); p.textStyle(p.BOLD); p.textSize(cw * 0.2); p.text("MAU", 0, 0.5);
    p.pop();
  };
  const card = (x, y, s, suit, sym, rot, ring) => {     // sticker-style face
    p.push(); p.translate(x, y); p.rotate(rot);
    const cw = s, ch = s / 0.66;
    p.fill(0, 0, 0, 55); p.rect(-cw / 2 + 2, -ch / 2 + 4, cw, ch, 7);
    p.fill(...SUIT[suit]); p.rect(-cw / 2, -ch / 2, cw, ch, 7);
    p.fill(255, 255, 255, 55); p.rect(-cw / 2, -ch / 2, cw, ch * 0.5, 7, 7, 12, 12);
    p.textStyle(p.BOLD);
    p.fill(253, 246, 232);
    p.textSize(cw * 0.17); p.text(sym, -cw * 0.34, -ch * 0.4);
    p.push(); p.rotate(p.PI); p.text(sym, -cw * 0.34, -ch * 0.4); p.pop();
    p.push(); p.rotate(-0.05); p.textSize(cw * (sym.length > 1 ? 0.4 : 0.58));
    p.fill(60, 20, 8, 90); p.text(sym, 1.5, cw * 0.04 + 1.5);
    p.fill(253, 246, 232); p.text(sym, 0, cw * 0.04); p.pop();
    p.noFill(); p.stroke(255); p.strokeWeight(2.5); p.rect(-cw / 2, -ch / 2, cw, ch, 7); p.noStroke();
    if (ring) { p.stroke(255, 217, 77); p.strokeWeight(4); p.rect(-cw / 2 - 4, -ch / 2 - 4, cw + 8, ch + 8, 10); p.noStroke(); }
    p.pop();
  };
  // opponent fans: top row + left edge, chips like name tags
  const chip = (x, y, label, n) => {
    p.fill(0, 0, 0, 50); p.rect(x - 52, y - 12, 104, 24, 12);
    p.fill(253, 246, 232); p.rect(x - 54, y - 14, 104, 24, 12);
    p.fill(91, 42, 22); p.textStyle(p.BOLD); p.textSize(12); p.text(label, x - 8, y - 2);
    p.fill(253, 246, 232); p.textSize(11); p.fill(91, 42, 22);
    p.fill(91, 42, 22); p.circle(x + 38, y - 2, 16);
    p.fill(253, 246, 232); p.text(String(n), x + 38, y - 1.5);
  };
  for (let i = 0; i < 6; i++) backCard(178 + i * 44 + Math.sin(i * 2.1) * 2, 44 + Math.abs(2.5 - i) * 3, 40, (i - 2.5) * 0.075);
  chip(298, 96, "MIA", 6);
  p.push(); p.translate(38, 170); p.rotate(p.PI / 2);
  for (let i = 0; i < 4; i++) backCard(i * 30 + i * 1.5, Math.abs(1.5 - i) * 3, 34, (i - 1.5) * 0.1);
  p.pop();
  chip(40, 96, "BEN", 4);
  p.fill(238, 164, 28); p.circle(96, 84, 26);
  p.fill(60, 42, 5); p.textStyle(p.BOLD); p.textSize(11); p.text("UNO!", 96, 84);
  // direction + discard pile (red 5 slumping on ghosts)
  p.stroke(255, 244, 226, 130); p.strokeWeight(3.5); p.strokeCap(p.ROUND); p.noFill();
  p.arc(280, 172, 30, 30, -0.5, 3.4);
  p.line(288, 154, 280, 161); p.line(280, 161, 289, 164);
  p.noStroke();
  p.push(); p.translate(352, 176); p.rotate(0.16); p.fill(46, 18, 9); p.rect(-24, -37, 48, 74, 7); p.pop();
  p.push(); p.translate(350, 178); p.rotate(-0.12); p.fill(46, 18, 9); p.rect(-24, -37, 48, 74, 7); p.pop();
  card(352, 178, 50, "r", "5", 0.03, false);
  // deck with count
  backCard(216, 172, 52, -0.04);
  p.fill(253, 246, 232); p.circle(246, 210, 22); p.fill(91, 42, 22); p.textSize(11); p.text("34", 246, 210.5);
  // my fanned hand, the yellow 4 raised
  card(150, 296, 48, "g", "7", -0.14);
  card(198, 302, 48, "b", "3", -0.07);
  card(246, 306, 48, "y", "4", 0, true);
  card(294, 306, 48, "r", "⇄", 0.07);
  card(342, 302, 48, "g", "+2", 0.14);
  card(392, 296, 48, "w", "", 0.2);
  // my name tag
  p.fill(245, 188, 68); p.circle(66, 306, 26); p.stroke(255); p.strokeWeight(2.5); p.noFill(); p.circle(66, 306, 26); p.noStroke();
  p.fill(91, 42, 22); p.textStyle(p.BOLD); p.textSize(13); p.text("D", 66, 306);
  p.fill(255, 233, 184); p.rect(84, 294, 96, 24, 12); p.stroke(255); p.strokeWeight(2); p.noFill(); p.rect(84, 294, 96, 24, 12); p.noStroke();
  p.fill(91, 42, 22); p.textSize(12); p.text("DU", 108, 306); p.text("5", 166, 306);
  // "play" buttons like the app
  p.push(); p.translate(452, 240); p.rotate(-0.1);
  p.fill(53, 182, 176); p.rect(-42, -14, 84, 28, 14); p.stroke(255); p.strokeWeight(2.5); p.noFill(); p.rect(-42, -14, 84, 28, 14); p.noStroke();
  p.fill(255); p.textStyle(p.BOLD); p.textSize(13); p.text("MAU!", 0, 0.5); p.pop();
}

// Battleship (Schiffe versenken): zwei Seekarten mit Schiffen, Treffern, Wasserringen und Fadenkreuz
function drawBattleship(p, w, h) {
  p.background(12, 30, 56);
  p.noStroke();
  for (let i = 0; i < 9; i++) { p.fill(255, 255, 255, 7); p.rect(0, 14 + i * 34, w, 6); }
  const cs = 17, bs = cs * 10, gap = 34, ox = (w - (bs * 2 + gap)) / 2, oy = (h - bs) / 2 - 8;
  const ship = (bx, by, x, y, len, horiz, c) => {
    const sw = horiz ? len * cs - 3 : cs - 5, sh = horiz ? cs - 5 : len * cs - 3;
    const sx = bx + x * cs + 1.5 + (horiz ? 0 : 1), sy = by + y * cs + 1.5 + (horiz ? 1 : 0);
    p.fill(0, 0, 0, 70); p.rect(sx + 2, sy + 3, sw, sh, 6);
    p.fill(c[0], c[1], c[2]); p.rect(sx, sy, sw, sh, 6);
    p.fill(255, 255, 255, 70); p.rect(sx + (horiz ? 4 : 2), sy + (horiz ? 2 : 4), horiz ? sw - 8 : 2, horiz ? 2 : sh - 8, 1);
    p.fill(60, 70, 84);
    for (let k = 0; k < Math.max(1, len - 1); k++) p.circle(horiz ? sx + 9 + k * 13 : sx + sw / 2, horiz ? sy + sh / 2 : sy + 9 + k * 13, 4.5);
  };
  const board = (bx, by, label, ships, marks, hot) => {
    p.fill(0, 0, 0, 70); p.rect(bx - 8, by - 8, bs + 16, bs + 16, 12);
    p.fill(30, 36, 62); p.rect(bx - 6, by - 6, bs + 12, bs + 12, 10);
    p.fill(24, 96, 150); p.rect(bx, by, bs, bs, 6);
    p.fill(255, 255, 255, 18);
    for (let i = 1; i < 10; i++) { p.rect(bx + i * cs, by, 1, bs); p.rect(bx, by + i * cs, bs, 1); }
    for (const s of ships) ship(bx, by, s[0], s[1], s[2], s[3], s[4]);
    for (const [x, y, hit] of marks) {
      const cx = bx + x * cs + cs / 2, cy = by + y * cs + cs / 2;
      if (hit) { p.fill(255, 150, 50, 90); p.circle(cx, cy, cs * 1.5); p.fill(255, 110, 30); p.circle(cx, cy + 1, cs * 0.6); p.fill(255, 230, 120); p.circle(cx, cy + 2, cs * 0.28); }
      else { p.noFill(); p.stroke(235, 247, 255, 200); p.strokeWeight(1.4); p.circle(cx, cy, cs * 0.62); p.noStroke(); p.fill(235, 247, 255); p.circle(cx, cy, 3); }
    }
    if (hot) {
      const cx = bx + hot[0] * cs + cs / 2, cy = by + hot[1] * cs + cs / 2;
      p.noFill(); p.stroke(255, 84, 112); p.strokeWeight(1.8); p.circle(cx, cy, cs * 0.95);
      p.line(cx - cs * 0.8, cy, cx + cs * 0.8, cy); p.line(cx, cy - cs * 0.8, cx, cy + cs * 0.8); p.noStroke();
    }
    p.fill(205, 220, 240); p.textStyle(p.BOLD); p.textSize(12); p.textAlign(p.CENTER, p.CENTER);
    p.text(label, bx + bs / 2, by - 17);
  };
  const hull = [150, 162, 178], wood = [176, 132, 82], dark = [74, 86, 98];
  board(ox, oy, "DEINE FLOTTE", [[1, 1, 5, true, [110, 122, 138]], [2, 4, 4, false, wood], [6, 3, 3, true, wood], [8, 6, 3, false, dark], [4, 8, 2, true, hull]], [[3, 1, true], [4, 1, true], [8, 7, true], [6, 6, false], [0, 6, false], [7, 0, false]]);
  board(ox + bs + gap, oy, "GEGNER", [[1, 6, 2, false, wood]], [[1, 6, true], [1, 7, true], [4, 2, false], [6, 5, false], [3, 8, false], [8, 3, false], [7, 7, true]], [5, 4]);
  p.fill(116, 226, 178); p.rect(w / 2 - 66, h - 36, 132, 26, 13);
  p.fill(14, 40, 40); p.textStyle(p.BOLD); p.textSize(13); p.text("DU BIST DRAN", w / 2, h - 23);
}

// Poker (hub only): green felt oval on a wooden rim, five community cards,
// a pot pill with chip piles, a face-down opponent hand with a name chip and
// two face-up hole cards (A♥ A♠). Static, centred, nothing cropped.
function pokerLerp(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

function pokerChip(p, x, y, r, col) {
  const ctx = p.drawingContext;
  p.noStroke();
  p.fill(0, 0, 0, 90); p.circle(x + 1, y + 2.5, r * 2);     // contact shadow
  p.fill(...col); p.circle(x, y, r * 2);
  p.noFill(); p.stroke(250, 248, 240); p.strokeWeight(Math.max(1, r * 0.16));
  ctx.setLineDash([r * 0.28, r * 0.22]);                      // white dashed edge ring
  p.circle(x, y, r * 1.7);
  ctx.setLineDash([]);
  p.noStroke(); p.fill(255, 255, 255, 40); p.circle(x, y, r * 0.9);
}

function pokerCard(p, cx, cy, cw, ch, rank, suit, rot) {
  const red = suit === "♥" || suit === "♦";
  const INK = red ? [200, 32, 40] : [28, 28, 34];
  p.push(); p.translate(cx, cy); p.rotate(rot ?? 0);
  p.noStroke();
  p.fill(0, 0, 0, 80); p.rect(-cw / 2 + 2, -ch / 2 + 4, cw, ch, 6);      // drop shadow
  p.fill(252, 251, 246); p.stroke(190, 186, 176); p.strokeWeight(1);
  p.rect(-cw / 2, -ch / 2, cw, ch, 6);
  p.noStroke();
  p.fill(...INK); p.textStyle(p.BOLD);
  p.textAlign(p.LEFT, p.TOP);
  p.textSize(cw * 0.26); p.text(rank, -cw / 2 + 5, -ch / 2 + 4);
  p.textSize(cw * 0.22); p.text(suit, -cw / 2 + 5, -ch / 2 + 4 + cw * 0.3);
  p.textAlign(p.RIGHT, p.BOTTOM);
  p.textSize(cw * 0.26); p.text(rank, cw / 2 - 5, ch / 2 - 4);
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(cw * 0.55); p.text(suit, 0, cw * 0.05);
  p.pop();
}

function pokerBack(p, cx, cy, cw, ch, rot) {
  const ctx = p.drawingContext;
  p.push(); p.translate(cx, cy); p.rotate(rot ?? 0);
  p.noStroke();
  p.fill(0, 0, 0, 80); p.rect(-cw / 2 + 2, -ch / 2 + 4, cw, ch, 6);      // drop shadow
  p.fill(30, 64, 150); p.rect(-cw / 2, -ch / 2, cw, ch, 6);
  ctx.save();                                                           // crosshatch, clipped to the inset
  ctx.beginPath(); ctx.roundRect(-cw / 2 + 4, -ch / 2 + 4, cw - 8, ch - 8, 4); ctx.clip();
  p.stroke(130, 170, 235, 150); p.strokeWeight(1);
  for (let k = -ch - cw; k < cw + ch; k += 5) {
    p.line(k, -ch / 2, k + ch, ch / 2);
    p.line(k, ch / 2, k + ch, -ch / 2);
  }
  ctx.restore();
  p.noStroke(); p.noFill(); p.stroke(235, 240, 255, 220); p.strokeWeight(1.2);
  p.rect(-cw / 2 + 4, -ch / 2 + 4, cw - 8, ch - 8, 4);
  p.pop();
}

function drawPoker(p, w, h) {
  p.background(24, 22, 28);
  const cx = w / 2, cy = h / 2;
  p.noStroke();
  p.textAlign(p.CENTER, p.CENTER);

  // table shadow, wooden rim (lighter outside, darker towards the felt)
  p.fill(0, 0, 0, 110); p.ellipse(cx + 6, cy + 12, 548, 314);
  for (let k = 0; k <= 11; k++) {
    const t = k / 11;
    p.fill(...pokerLerp([150, 90, 46], [92, 50, 24], t));
    p.ellipse(cx, cy, 540 - k * 4, 308 - k * 2.4);
  }
  // felt: layered ellipses shrinking towards a lit centre
  for (let k = 0; k <= 15; k++) {
    const t = k / 15, s = 1 - t * 0.72;
    p.fill(...pokerLerp([8, 50, 32], [46, 140, 90], t));
    p.ellipse(cx, cy, 456 * s, 248 * s);
  }
  p.fill(255, 255, 255, 14); p.ellipse(cx - 10, cy - 18, 220, 80);     // sheen
  p.noFill(); p.stroke(6, 34, 20, 220); p.strokeWeight(3); p.ellipse(cx, cy, 456, 248); p.noStroke();

  // opponent: two face-down backs fanned at the top, name chip beside them
  pokerBack(p, 244, 82, 32, 46, -0.16);
  pokerBack(p, 278, 78, 32, 46, 0.12);
  p.fill(0, 0, 0, 60); p.rect(304, 76, 88, 24, 12);
  p.fill(253, 246, 232); p.rect(302, 74, 88, 24, 12);
  p.fill(245, 188, 68); p.circle(316, 86, 16);
  p.fill(91, 42, 22); p.textStyle(p.BOLD); p.textSize(12);
  p.text("JULE", 354, 86.5);

  // pot: pill label with a small chip pile to its left
  p.fill(0, 0, 0, 120); p.rect(262, 118, 76, 20, 10);
  p.fill(253, 246, 232); p.textStyle(p.BOLD); p.textSize(11);
  p.text("POT  1,240", 300, 128.5);
  const RED = [196, 36, 44], BLUE = [40, 96, 196], BLACK = [34, 34, 40], GREEN = [42, 150, 84];
  [RED, BLUE, RED].forEach((c, i) => pokerChip(p, 236, 134 - i * 3, 7, c));

  // bottom-left chip stack (four chips)
  const stack = [RED, BLUE, BLACK, GREEN];
  stack.forEach((c, i) => pokerChip(p, 150 + (i % 2 ? 1 : -1), 262 - i * 5, 15, c));

  // five community cards, face-up
  const board = [["A", "♠"], ["K", "♠"], ["Q", "♥"], ["10", "♦"], ["7", "♣"]];
  board.forEach(([r, s], i) => pokerCard(p, cx + (i - 2) * 50, cy, 42, 60, r, s, 0));

  // my hole cards, fanned at the bottom: A♥ A♠
  pokerCard(p, 268, 286, 44, 62, "A", "♥", -0.12);
  pokerCard(p, 332, 286, 44, 62, "A", "♠", 0.12);
}

// Kart-Rennen (Solo + Hub): Sonnenwiese aus der Fahrersicht – Berge, Straße in Perspektive mit Randsteinen,
// ein blaues Kart voraus, eigenes rotes Kart von hinten, Item-Box und Boost-Pad. Statisch, einmal gezeichnet.
function drawKart(p, w, h) {
  const ctx = p.drawingContext;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  sky.addColorStop(0, "#5db6ff"); sky.addColorStop(1, "#cdeaff");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.52);
  p.noStroke();
  p.fill(255, 255, 255, 230);                                   // Wolken
  [[90, 60, 1], [420, 44, 0.8], [520, 86, 0.6]].forEach(([x, y, s]) => { p.ellipse(x, y, 90 * s, 28 * s); p.ellipse(x + 26 * s, y - 8 * s, 56 * s, 26 * s); p.ellipse(x - 28 * s, y + 3 * s, 52 * s, 20 * s); });
  const hy = h * 0.5;
  p.fill(111, 159, 208); p.triangle(-20, hy, 110, hy - 96, 250, hy); p.triangle(150, hy, 330, hy - 128, 500, hy); p.triangle(400, hy, 520, hy - 80, 660, hy);
  p.fill(255); p.triangle(330 - 28, hy - 128 + 40, 330, hy - 128, 330 + 28, hy - 128 + 40); p.triangle(110 - 20, hy - 96 + 30, 110, hy - 96, 110 + 20, hy - 96 + 30);
  p.fill(98, 178, 76); p.rect(0, hy, w, h - hy);                // Gras
  p.fill(79, 154, 61); p.quad(0, hy, w, hy, w, hy + 20, 0, hy + 14);
  // Straße: Fluchtpunkt leicht rechts, Linkskurve nach hinten
  const vx = w * 0.56;
  const road = (t0, t1, c) => {                                 // t = 0 Horizont, 1 unten
    const lx = (t) => vx + (w * 0.1 - vx) * t * t * 1.0 - 8 * (1 - t), rx = (t) => vx + (w * 0.97 - vx) * t * t + 8 * (1 - t);
    const y = (t) => hy + (h - hy) * t * t;
    p.fill(...c); p.quad(lx(t0), y(t0), rx(t0), y(t0), rx(t1), y(t1), lx(t1), y(t1));
  };
  for (let i = 0; i < 14; i++) {
    const t0 = i / 14, t1 = (i + 1) / 14;
    road(Math.max(0.02, t0), t1, i % 2 ? [84, 87, 97] : [74, 77, 87]);
  }
  // Randsteine
  for (let i = 0; i < 14; i++) {
    const t0 = Math.max(0.02, i / 14), t1 = (i + 1) / 14, c = i % 2 ? [226, 59, 59] : [246, 246, 242];
    const y0 = hy + (h - hy) * t0 * t0, y1 = hy + (h - hy) * t1 * t1;
    const lx0 = vx + (w * 0.1 - vx) * t0 * t0 - 8 * (1 - t0), lx1 = vx + (w * 0.1 - vx) * t1 * t1 - 8 * (1 - t1);
    const rx0 = vx + (w * 0.97 - vx) * t0 * t0 + 8 * (1 - t0), rx1 = vx + (w * 0.97 - vx) * t1 * t1 + 8 * (1 - t1);
    const bw0 = 3 + 22 * t0 * t0, bw1 = 3 + 22 * t1 * t1;
    p.fill(...c); p.quad(lx0 - bw0, y0, lx0, y0, lx1, y1, lx1 - bw1, y1); p.quad(rx0, y0, rx0 + bw0, y0, rx1 + bw1, y1, rx1, y1);
  }
  // Mittelstrich + Boost-Pad
  p.fill(244, 244, 238);
  for (let i = 1; i < 14; i += 2) {
    const t0 = i / 14, t1 = (i + 0.9) / 14, y0 = hy + (h - hy) * t0 * t0, y1 = hy + (h - hy) * t1 * t1, cx0 = vx + (w * 0.53 - vx) * t0 * t0, cx1 = vx + (w * 0.53 - vx) * t1 * t1;
    p.quad(cx0 - 1 - 6 * t0 * t0, y0, cx0 + 1 + 6 * t0 * t0, y0, cx1 + 1 + 6 * t1 * t1, y1, cx1 - 1 - 6 * t1 * t1, y1);
  }
  p.fill(11, 42, 107); p.quad(w * 0.5, h * 0.64, w * 0.63, h * 0.64, w * 0.7, h * 0.76, w * 0.47, h * 0.76);
  p.fill(255, 183, 3); [0.655, 0.7].forEach((y) => p.triangle(w * 0.565, h * y - 6, w * 0.6, h * y + 8, w * 0.53, h * y + 8));
  // Gegner (blau) voraus
  const kart = (cx, cy, s, col, driver) => {
    p.fill(0, 0, 0, 70); p.ellipse(cx, cy + 22 * s, 96 * s, 16 * s);
    p.fill(28, 30, 38); p.rect(cx - 52 * s, cy + 2 * s, 18 * s, 26 * s, 4 * s); p.rect(cx + 34 * s, cy + 2 * s, 18 * s, 26 * s, 4 * s);
    p.fill(...col.map((v) => v * 0.6)); p.rect(cx - 46 * s, cy - 14 * s, 92 * s, 24 * s, 6 * s);
    p.fill(...col); p.rect(cx - 42 * s, cy - 24 * s, 84 * s, 26 * s, 8 * s);
    p.fill(244, 244, 240); p.rect(cx - 40 * s, cy - 8 * s, 80 * s, 6 * s, 3 * s);
    p.fill(...col); p.rect(cx - 56 * s, cy - 40 * s, 112 * s, 9 * s, 3 * s); p.fill(28, 30, 38); p.rect(cx - 30 * s, cy - 33 * s, 6 * s, 14 * s); p.rect(cx + 24 * s, cy - 33 * s, 6 * s, 14 * s);
    p.fill(241, 197, 154); p.circle(cx, cy - 36 * s, 24 * s);
    p.fill(...col); p.arc(cx, cy - 39 * s, 30 * s, 28 * s, p.PI, p.TWO_PI);
    p.fill(28, 30, 38); p.rect(cx - 12 * s, cy - 36 * s, 24 * s, 6 * s, 2 * s);
    if (driver) { p.fill(255, 150, 20, 220); p.triangle(cx - 22 * s, cy + 6 * s, cx - 12 * s, cy + 6 * s, cx - 17 * s, cy + 34 * s); p.triangle(cx + 12 * s, cy + 6 * s, cx + 22 * s, cy + 6 * s, cx + 17 * s, cy + 34 * s); }
  };
  kart(w * 0.46, h * 0.585, 0.34, [47, 125, 246], false);
  // Item-Boxen
  [[0.52, 0.56], [0.56, 0.563]].forEach(([x, y], i) => { p.fill(255, 210, 63); p.rect(w * x - 7, h * y - 7, 14, 14, 2); p.fill(255, 255, 255, 220); p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(11); p.text("?", w * x, h * y + 1); });
  // Funken + eigenes Kart
  p.fill(77, 184, 255);
  for (let i = 0; i < 12; i++) p.circle(w * 0.36 + (i % 6) * 6 - (i > 5 ? 14 : 0), h * 0.9 - i * 2.5, 4 - i * 0.1);
  kart(w * 0.4, h * 0.82, 1.35, [226, 56, 61], true);
  // HUD
  p.fill(10, 14, 30, 150); p.rect(14, 14, 54, 54, 12); p.rect(w - 74, 14, 60, 60, 12);
  p.fill(226, 59, 59); p.ellipse(41, 46, 32, 24); p.fill(255); [[34, 42], [47, 40]].forEach(([x, y]) => p.circle(x, y, 7));
  p.fill(255); p.textAlign(p.LEFT, p.CENTER); p.textStyle(p.BOLDITALIC); p.textSize(48); p.text("2", 20, 100); p.textSize(20); p.text("/4", 50, 108);
  p.noFill(); p.stroke(255, 255, 255, 230); p.strokeWeight(3.5); p.beginShape(); [[w - 62, 58], [w - 60, 36], [w - 40, 28], [w - 26, 40], [w - 32, 60], [w - 52, 64]].forEach(([x, y]) => p.vertex(x, y)); p.endShape(p.CLOSE);
  p.noStroke(); p.fill(226, 56, 61); p.circle(w - 32, 52, 8);
}
