// Kart-Rennen — die 3D-Welt (Three.js r128 aus vendor/three.min.js, global THREE), alles low poly:
// Straße, Randsteine, Bande, Kulisse je Thema, Item-Boxen, Boost-Pads, Karts, Partikel.

import { HALF, CURB, WALL, SHOULDER, POST_LAT, THEMES, rng, pointAt } from "./track.js";

let threeP = null;
export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (threeP) return threeP;
  threeP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = new URL("vendor/three.min.js", document.baseURI).href;
    s.onload = () => res(window.THREE);
    s.onerror = () => { threeP = null; rej(new Error("three.min.js konnte nicht geladen werden")); };
    document.head.appendChild(s);
  });
  return threeP;
}

// ---------- kleine Helfer ----------

function mtx(T, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
}

// mehrere Formen mit Farben zu einer Geometrie (flach schattiert, Vertex-Farben)
function merged(T, parts) {
  const pos = [], col = [], c = new T.Color();
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (p.m) g.applyMatrix4(p.m);
    const a = g.attributes.position.array;
    c.setHex(p.c);
    for (let i = 0; i < a.length; i += 3) { pos.push(a[i], a[i + 1], a[i + 2]); col.push(c.r, c.g, c.b); }
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  out.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

function canvasTex(T, w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new T.CanvasTexture(c);
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// Streifen aus Geometrie-Daten: verts = [[x,y,z,r,g,b], …] paarweise (links, rechts), N Paare
function strip(T, pairs, closed, normalUp = true) {
  const n = pairs.length, pos = [], col = [], nor = [], idx = [];
  for (const [a, b] of pairs) {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    col.push(a[3], a[4], a[5], b[3], b[4], b[5]);
    nor.push(0, 1, 0, 0, 1, 0);
  }
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = i * 2, b = i * 2 + 1, c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  if (!normalUp) g.computeVertexNormals();
  return g;
}

const hexRGB = (T, h) => { const c = new T.Color(h); return [c.r, c.g, c.b]; };

// ---------- Streckenmodell ----------

function buildRoad(T, track, th, scene) {
  const N = track.N, sp = track.sp;
  const road = hexRGB(T, th.road), roadAlt = hexRGB(T, th.roadAlt), cA = hexRGB(T, th.curbA), cB = hexRGB(T, th.curbB);
  const sh = hexRGB(T, th.shoulder), wl = hexRGB(T, th.wall), wl2 = hexRGB(T, th.wallAlt);
  const P = (i, lat, y, c) => [track.cx[i % N] + track.rx[i % N] * lat, y, track.cz[i % N] + track.rz[i % N] * lat, c[0], c[1], c[2]];
  const mats = {
    base: new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }),
    deco: new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const add = (g, m) => { const mesh = new T.Mesh(g, m); scene.add(mesh); return mesh; };

  // Straße mit leichten Querbändern (gibt Geschwindigkeitsgefühl)
  const rp = [];
  for (let i = 0; i <= N; i++) { const c = Math.floor(i / 5) % 2 ? roadAlt : road; rp.push([P(i, -HALF, 0.03, c), P(i, HALF, 0.03, c)]); }
  add(strip(T, rp, false), mats.base);

  // Schulter (Gras / Sand), bis zur Bande
  for (const side of [-1, 1]) {
    const pp = [];
    for (let i = 0; i <= N; i++) pp.push(side < 0 ? [P(i, -WALL - 1, 0.0, sh), P(i, -HALF, 0.0, sh)] : [P(i, HALF, 0.0, sh), P(i, WALL + 1, 0.0, sh)]);
    add(strip(T, pp, false), mats.base);
  }

  // Randsteine rot/weiß
  for (const side of [-1, 1]) {
    const pp = [];
    for (let i = 0; i <= N; i++) {
      const c = Math.floor(i / 2) % 2 ? cA : cB;
      pp.push(side < 0 ? [P(i, -HALF - CURB, 0.05, c), P(i, -HALF, 0.05, c)] : [P(i, HALF, 0.05, c), P(i, HALF + CURB, 0.05, c)]);
    }
    add(strip(T, pp, false), mats.deco);
  }

  // Mittelstrich (gestrichelt)
  {
    const pos = [], col = [], nor = [], idx = [];
    let v = 0;
    for (let i = 0; i < N; i += 6) {
      const j = i + 3;
      const a = P(i, -0.22, 0.055, [1, 1, 1]), b = P(i, 0.22, 0.055, [1, 1, 1]), c = P(j, -0.22, 0.055, [1, 1, 1]), d = P(j, 0.22, 0.055, [1, 1, 1]);
      for (const q of [a, b, c, d]) { pos.push(q[0], q[1], q[2]); col.push(0.95, 0.95, 0.9); nor.push(0, 1, 0); }
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); v += 4;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
    add(g, mats.deco);
  }

  // Ziellinie (Schachbrett) bei s = 0
  {
    const rows = 3, cols = 18, pos = [], col = [], nor = [], idx = [];
    let v = 0;
    const w = (HALF * 2) / cols, depth = 1.1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const black = (r + c) % 2 === 0;
      const lat0 = -HALF + c * w, lat1 = lat0 + w, s0 = (r - rows / 2) * depth, s1 = s0 + depth;
      const q = [pointAt(track, s0, lat0), pointAt(track, s0, lat1), pointAt(track, s1, lat0), pointAt(track, s1, lat1)];
      for (const p of q) { pos.push(p.x, 0.058, p.z); col.push(black ? 0.05 : 0.97, black ? 0.05 : 0.97, black ? 0.06 : 0.95); nor.push(0, 1, 0); }
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); v += 4;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
    add(g, mats.deco);
  }

  // Bande: senkrechte Streifen, wechselnd gefärbt
  for (const side of [-1, 1]) {
    const pp = [];
    for (let i = 0; i <= N; i++) {
      const c = Math.floor(i / 3) % 2 ? wl : wl2;
      pp.push([P(i, side * WALL, 0, c), P(i, side * WALL, 1.15, c)]);
    }
    add(strip(T, pp, false, false), mats.base);
    // Oberkante (schmaler Deckel)
    const cap = [];
    for (let i = 0; i <= N; i++) { const c = Math.floor(i / 3) % 2 ? wl : wl2; cap.push([P(i, side * WALL, 1.15, c), P(i, side * (WALL + 0.9), 1.15, c)]); }
    add(strip(T, cap, false), mats.base);
  }
}

// Zielbogen
function buildStartArch(T, track, th, scene) {
  const p = pointAt(track, 0, 0);
  const g = new T.Group();
  const pm = new T.MeshLambertMaterial({ color: 0x2a2d38, flatShading: true });
  for (const s of [-1, 1]) {
    const post = new T.Mesh(new T.BoxGeometry(1.1, 9, 1.1), pm);
    post.position.set(s * POST_LAT, 4.5, 0); g.add(post);
  }
  const tex = canvasTex(T, 512, 128, (c, w, h) => {
    const s = 32;
    for (let y = 0; y < 4; y++) for (let x = 0; x < w / s; x++) { c.fillStyle = (x + y) % 2 ? "#fff" : "#111"; c.fillRect(x * s, y * s, s, s); }
  });
  const banner = new T.Mesh(new T.BoxGeometry((HALF + 2.2) * 2 + 1.1, 2.6, 0.6), new T.MeshBasicMaterial({ map: tex }));
  banner.position.set(0, 9.4, 0); g.add(banner);
  const label = canvasTex(T, 512, 128, (c, w, h) => {
    c.fillStyle = "#e23b3b"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#fff"; c.font = "900 italic 84px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("START · ZIEL", w / 2, h / 2 + 4);
  });
  const sign = new T.Mesh(new T.BoxGeometry(14, 2.6, 0.5), new T.MeshBasicMaterial({ map: label }));
  sign.position.set(0, 12.3, 0); g.add(sign);
  const bar = new T.Mesh(new T.BoxGeometry(1, 3.2, 0.5), pm); bar.position.set(-6, 10.8, 0); g.add(bar);
  const bar2 = bar.clone(); bar2.position.x = 6; g.add(bar2);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.yaw;
  scene.add(g);
}

function buildPads(T, track, scene) {
  const tex = canvasTex(T, 128, 192, (c, w, h) => {
    c.fillStyle = "#0b2a6b"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#ffb703";
    for (let k = 0; k < 3; k++) {
      const y = 20 + k * 58;
      c.beginPath(); c.moveTo(14, y + 36); c.lineTo(w / 2, y); c.lineTo(w - 14, y + 36); c.lineTo(w - 14, y + 54); c.lineTo(w / 2, y + 18); c.lineTo(14, y + 54); c.closePath(); c.fill();
    }
    c.strokeStyle = "#fff"; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
  });
  const mat = new T.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const meshes = [];
  for (const pad of track.pads) {
    const s = pad.i * track.sp;
    const q = [pointAt(track, s - 5, pad.lat - 3.2), pointAt(track, s - 5, pad.lat + 3.2), pointAt(track, s + 5, pad.lat - 3.2), pointAt(track, s + 5, pad.lat + 3.2)];
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(q.flatMap((p) => [p.x, 0.07, p.z]), 3));
    g.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setAttribute("normal", new T.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    const m = new T.Mesh(g, mat); m.material.side = T.DoubleSide; scene.add(m); meshes.push(m);
  }
  return meshes;
}

// ---------- Kulisse ----------

function propGeoms(T, kind, rnd) {
  const cyl = (rt, rb, h, seg = 6) => new T.CylinderGeometry(rt, rb, h, seg);
  const cone = (r, h, seg = 7) => new T.ConeGeometry(r, h, seg);
  const ico = (r, d = 0) => new T.IcosahedronGeometry(r, d);
  const box = (x, y, z) => new T.BoxGeometry(x, y, z);
  const defs = [];
  if (kind === "wiese") {
    defs.push({ w: 5, s: [0.9, 1.5], g: merged(T, [
      { g: cyl(0.35, 0.5, 2.4), c: 0x7a4a26, m: mtx(T, 0, 1.2, 0) },
      { g: cone(2.4, 3.6), c: 0x2f8f3a, m: mtx(T, 0, 3.8, 0) },
      { g: cone(1.9, 3.2), c: 0x3aa84a, m: mtx(T, 0, 5.7, 0) },
      { g: cone(1.2, 2.6), c: 0x4dc05c, m: mtx(T, 0, 7.4, 0) },
    ]) });
    defs.push({ w: 3, s: [0.8, 1.3], g: merged(T, [
      { g: cyl(0.4, 0.55, 2.6), c: 0x8a5a2e, m: mtx(T, 0, 1.3, 0) },
      { g: ico(2.5, 0), c: 0x58b947, m: mtx(T, 0, 4.4, 0, 0, 0.4, 0, 1, 0.9, 1) },
      { g: ico(1.5, 0), c: 0x6ccd5a, m: mtx(T, 1.3, 5.4, 0.6) },
    ]) });
    defs.push({ w: 4, s: [0.7, 1.4], g: merged(T, [{ g: ico(1.1, 0), c: 0x3d9d3f, m: mtx(T, 0, 0.7, 0, 0, 0, 0, 1, 0.8, 1) }, { g: ico(0.7, 0), c: 0x57b84f, m: mtx(T, 0.9, 0.5, 0.3) }]) });
    defs.push({ w: 2, s: [0.8, 1.6], g: merged(T, [{ g: ico(1.3, 0), c: 0x9aa0a8, m: mtx(T, 0, 0.7, 0, 0, 0.6, 0, 1.2, 0.8, 1) }]) });
    defs.push({ w: 2, s: [0.9, 1.1], g: merged(T, [   // Blumeninsel
      { g: ico(0.6, 0), c: 0x3d9d3f, m: mtx(T, 0, 0.3, 0) },
      { g: ico(0.28, 0), c: 0xff5d8f, m: mtx(T, 0.5, 0.8, 0.2) }, { g: ico(0.28, 0), c: 0xffd23f, m: mtx(T, -0.4, 0.8, 0.3) }, { g: ico(0.28, 0), c: 0xffffff, m: mtx(T, 0.1, 0.9, -0.5) },
    ]) });
  } else if (kind === "wueste") {
    defs.push({ w: 5, s: [0.8, 1.5], g: merged(T, [
      { g: cyl(0.55, 0.6, 5, 6), c: 0x4c9a4f, m: mtx(T, 0, 2.5, 0) },
      { g: cyl(0.35, 0.35, 1.6, 6), c: 0x58ab5a, m: mtx(T, 1.0, 2.4, 0, 0, 0, Math.PI / 2) },
      { g: cyl(0.35, 0.4, 2.2, 6), c: 0x58ab5a, m: mtx(T, 1.7, 3.3, 0) },
      { g: cyl(0.3, 0.3, 1.4, 6), c: 0x58ab5a, m: mtx(T, -0.9, 3.0, 0, 0, 0, Math.PI / 2) },
      { g: cyl(0.3, 0.35, 1.8, 6), c: 0x58ab5a, m: mtx(T, -1.55, 3.8, 0) },
    ]) });
    defs.push({ w: 3, s: [0.8, 1.8], g: merged(T, [{ g: ico(1.5, 0), c: 0xb5683a, m: mtx(T, 0, 0.9, 0, 0, 0.5, 0, 1.2, 0.8, 1) }, { g: ico(0.9, 0), c: 0xc77a47, m: mtx(T, 1.4, 0.5, 0.5) }]) });
    defs.push({ w: 2, s: [0.9, 1.2], g: merged(T, [{ g: cyl(0.25, 0.4, 1.6, 5), c: 0xe9d9b8, m: mtx(T, 0, 0.8, 0) }, { g: ico(0.6, 0), c: 0xf2e6c9, m: mtx(T, 0, 1.8, 0) }]) });   // Knochen/Steinsäule
    defs.push({ w: 2, s: [2.5, 4.5], g: merged(T, [
      { g: cyl(3.2, 4.2, 5.5, 7), c: 0xc2693b, m: mtx(T, 0, 2.7, 0) },
      { g: cyl(2.6, 3.2, 2.6, 7), c: 0xd47a47, m: mtx(T, 0, 6.8, 0) },
      { g: cyl(2.6, 2.6, 0.5, 7), c: 0xe8a55c, m: mtx(T, 0, 8.3, 0) },
    ]) });
  } else if (kind === "schnee") {
    defs.push({ w: 6, s: [0.9, 1.6], g: merged(T, [
      { g: cyl(0.35, 0.45, 2.2), c: 0x6b4a2e, m: mtx(T, 0, 1.1, 0) },
      { g: cone(2.3, 3.4, 7), c: 0x2d6f4a, m: mtx(T, 0, 3.6, 0) },
      { g: cone(1.9, 2.6, 7), c: 0xffffff, m: mtx(T, 0, 4.2, 0) },
      { g: cone(1.8, 3.0, 7), c: 0x347d55, m: mtx(T, 0, 5.8, 0) },
      { g: cone(1.4, 2.2, 7), c: 0xffffff, m: mtx(T, 0, 6.4, 0) },
      { g: cone(0.9, 2.2, 7), c: 0xffffff, m: mtx(T, 0, 7.9, 0) },
    ]) });
    defs.push({ w: 3, s: [0.8, 1.6], g: merged(T, [{ g: ico(1.4, 0), c: 0xa8d4f5, m: mtx(T, 0, 0.9, 0, 0, 0.5, 0, 1, 1.3, 1) }, { g: ico(0.8, 0), c: 0xc9e6ff, m: mtx(T, 1.2, 0.5, 0.4) }]) });
    defs.push({ w: 1.2, s: [1, 1.2], g: merged(T, [   // Schneemann
      { g: ico(1.2, 1), c: 0xffffff, m: mtx(T, 0, 1.1, 0) }, { g: ico(0.9, 1), c: 0xffffff, m: mtx(T, 0, 2.5, 0) }, { g: ico(0.65, 1), c: 0xffffff, m: mtx(T, 0, 3.5, 0) },
      { g: cone(0.12, 0.7, 5), c: 0xff7a1a, m: mtx(T, 0, 3.55, 0.7, Math.PI / 2) },
      { g: cyl(0.45, 0.45, 0.5, 6), c: 0x222222, m: mtx(T, 0, 4.2, 0) }, { g: cyl(0.65, 0.65, 0.08, 6), c: 0x222222, m: mtx(T, 0, 3.95, 0) },
    ]) });
    defs.push({ w: 2, s: [0.8, 1.3], g: merged(T, [{ g: ico(0.9, 0), c: 0xffffff, m: mtx(T, 0, 0.45, 0, 0, 0, 0, 1.3, 0.7, 1.1) }]) });
  } else {   // nacht
    defs.push({ w: 5, s: [0.8, 1.4], g: merged(T, [
      { g: cyl(0.3, 0.4, 2, 5), c: 0x3a2a55, m: mtx(T, 0, 1, 0) },
      { g: cone(2.0, 3.2, 6), c: 0x5b3fa0, m: mtx(T, 0, 3.4, 0) }, { g: cone(1.4, 2.6, 6), c: 0x7a55d6, m: mtx(T, 0, 5.2, 0) },
    ]) });
    defs.push({ w: 3, s: [0.8, 1.4], g: merged(T, [{ g: ico(1.3, 0), c: 0x2d3a66, m: mtx(T, 0, 0.7, 0, 0, 0.5, 0, 1.2, 0.8, 1) }, { g: ico(0.7, 0), c: 0x3d4d88, m: mtx(T, 1.2, 0.4, 0.4) }]) });
    defs.push({ w: 2, s: [0.9, 1.3], g: merged(T, [{ g: box(0.4, 3.2, 0.4), c: 0x1a1d38, m: mtx(T, 0, 1.6, 0) }, { g: box(2.2, 1.4, 0.2), c: 0xff2d95, m: mtx(T, 0, 3.6, 0) }]) });
  }
  return defs;
}

function pickDef(defs, r) {
  const tot = defs.reduce((a, d) => a + d.w, 0);
  let x = r() * tot;
  for (const d of defs) { x -= d.w; if (x <= 0) return d; }
  return defs[0];
}

function buildScenery(T, track, th, scene, seed, low) {
  const R = rng(seed ^ 0xabcdef);
  const defs = propGeoms(T, th.props, R);
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
  const N = track.N;
  const place = [];
  const farFromTrack = (x, z, min) => {
    for (let i = 0; i < N; i += 2) { const dx = x - track.cx[i], dz = z - track.cz[i]; if (dx * dx + dz * dz < min * min) return false; }
    return true;
  };
  const tries = low ? 520 : 900;
  for (let k = 0; k < tries; k++) {
    let x, z;
    if (k % 3 !== 2) {                                  // an der Strecke entlang
      const i = Math.floor(R() * N), side = R() < 0.5 ? -1 : 1, off = WALL + 4 + R() * R() * 70;
      x = track.cx[i] + track.rx[i] * side * off; z = track.cz[i] + track.rz[i] * side * off;
    } else {                                            // weiter draußen / Innenfeld
      x = minX - 80 + R() * (maxX - minX + 160); z = minZ - 80 + R() * (maxZ - minZ + 160);
    }
    if (!farFromTrack(x, z, WALL + 5)) continue;
    const d = pickDef(defs, R);
    place.push({ d, x, z, ry: R() * Math.PI * 2, s: d.s[0] + R() * (d.s[1] - d.s[0]) });
  }
  const mat = new T.MeshLambertMaterial({ vertexColors: true });
  const dummy = new T.Object3D();
  defs.forEach((d, di) => {
    const list = place.filter((p) => p.d === d);
    if (!list.length) return;
    const im = new T.InstancedMesh(d.g, mat, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z); dummy.rotation.set(0, p.ry, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  });

  // ferne Berge (Nebel gilt nicht, sie sollen bis zum Horizont sichtbar bleiben)
  const farMat = new T.MeshLambertMaterial({ color: th.far, flatShading: true, fog: false });
  const mount = new T.Group();
  const R3 = rng(seed ^ 0x5151);
  const cnt = 22;
  const radius = Math.max(maxX - minX, maxZ - minZ) * 0.5 + 560;
  for (let i = 0; i < cnt; i++) {
    const a = (i / cnt) * Math.PI * 2 + R3() * 0.2, r = radius + R3() * 160;
    const h = 110 + R3() * 170, w = 120 + R3() * 120;
    const m = new T.Mesh(new T.ConeGeometry(w, h, 5 + Math.floor(R3() * 3)), farMat);
    m.position.set(cxm + Math.cos(a) * r, h / 2 - 4, czm + Math.sin(a) * r);
    m.rotation.y = R3() * 3;
    mount.add(m);
    if (th.props === "schnee" || (th.props === "wiese" && h > 200)) {
      const cap = new T.Mesh(new T.ConeGeometry(w * 0.34, h * 0.32, 5), new T.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false }));
      cap.position.set(m.position.x, h - h * 0.16 - 4, m.position.z); mount.add(cap);
    }
  }
  scene.add(mount);

  // Wolken (wiese/schnee/wueste) oder Sterne + Skyline (nacht)
  const extra = { clouds: [], stars: null };
  if (th.props === "nacht") {
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = R3() * Math.PI * 2, e = 0.15 + R3() * 1.2, r = 1300;
      pos[i * 3] = cxm + Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r * 0.9; pos[i * 3 + 2] = czm + Math.sin(a) * Math.cos(e) * r;
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3));
    scene.add(new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 3.2, sizeAttenuation: false, fog: false })));
    // Skyline mit leuchtenden Fenstern
    const bparts = [], wparts = [];
    const wcol = [0xffe08a, 0x7be8ff, 0xff8bd0];
    for (let i = 0; i < 38; i++) {
      const a = R3() * Math.PI * 2, r = radius * 0.62 + R3() * 120;
      const w = 22 + R3() * 28, h = 40 + R3() * 120, x = cxm + Math.cos(a) * r, z = czm + Math.sin(a) * r;
      if (!farFromTrack(x, z, WALL + 40)) continue;
      const ry = R3() * Math.PI;
      bparts.push({ g: new T.BoxGeometry(w, h, w), c: 0x141a40 + Math.floor(R3() * 4) * 0x040404, m: mtx(T, x, h / 2, z, 0, ry, 0) });
      for (let f = 0; f < 4; f++) {
        const fa = ry + f * Math.PI / 2, nx = Math.sin(fa), nz = Math.cos(fa);
        for (let row = 4; row < h - 3; row += 6) for (let c = -w / 2 + 4; c < w / 2 - 2; c += 5.5) {
          if (R3() < 0.45) continue;
          const px = x + nx * (w / 2 + 0.15) + nz * c, pz = z + nz * (w / 2 + 0.15) - nx * c;
          wparts.push({ g: new T.PlaneGeometry(2.4, 3), c: wcol[Math.floor(R3() * 3)], m: mtx(T, px, row, pz, 0, fa, 0) });
        }
      }
    }
    if (bparts.length) scene.add(new T.Mesh(merged(T, bparts), new T.MeshLambertMaterial({ vertexColors: true })));
    if (wparts.length) scene.add(new T.Mesh(merged(T, wparts), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide })));
    // Laternen am Rand
    const lampPole = [], lampGlow = [];
    for (let i = 0; i < N; i += 24) for (const side of [-1, 1]) {
      const x = track.cx[i] + track.rx[i] * side * (WALL + 2.2), z = track.cz[i] + track.rz[i] * side * (WALL + 2.2);
      lampPole.push({ g: new T.CylinderGeometry(0.18, 0.24, 7, 5), c: 0x2a2f55, m: mtx(T, x, 3.5, z) });
      lampGlow.push({ g: new T.IcosahedronGeometry(0.75, 0), c: side < 0 ? 0xff2d95 : 0x16e0ff, m: mtx(T, x, 7.4, z) });
    }
    scene.add(new T.Mesh(merged(T, lampPole), new T.MeshLambertMaterial({ vertexColors: true })));
    scene.add(new T.Mesh(merged(T, lampGlow), new T.MeshBasicMaterial({ vertexColors: true })));
  } else {
    const cm = new T.MeshLambertMaterial({ color: th.props === "wueste" ? 0xfff0dc : 0xffffff, flatShading: true, fog: false, transparent: true, opacity: 0.95 });
    for (let i = 0; i < 16; i++) {
      const g = new T.Group();
      const n = 3 + Math.floor(R3() * 3);
      for (let k = 0; k < n; k++) {
        const m = new T.Mesh(new T.IcosahedronGeometry(9 + R3() * 8, 0), cm);
        m.position.set(k * 11 - n * 5.5, R3() * 4, R3() * 6); m.scale.set(1.3, 0.62, 1);
        g.add(m);
      }
      const a = R3() * Math.PI * 2, r = R3() * 800;
      g.position.set(cxm + Math.cos(a) * r, 120 + R3() * 70, czm + Math.sin(a) * r);
      g.userData.speed = 1.2 + R3() * 2;
      scene.add(g); extra.clouds.push(g);
    }
  }
  return extra;
}

// ---------- Karts ----------

export function makeKartModel(T, color, name, opts = {}) {
  const root = new T.Group();            // Position + Gieren
  const tilt = new T.Group();            // Neigung / Hüpfen
  root.add(tilt);
  const body = new T.Color(color);
  const dark = body.clone().multiplyScalar(0.55);
  const mats = [];
  const mk = (c, extra = {}) => { const m = new T.MeshLambertMaterial({ color: c, flatShading: true, ...extra }); mats.push(m); return m; };
  const mBody = mk(body), mDark = mk(dark), mWhite = mk(0xf4f4f0), mBlack = mk(0x1d1f26), mMetal = mk(0x9aa1ad), mSkin = mk(0xf1c59a);
  const add = (g, m, x, y, z, rx = 0, ry = 0, rz = 0, par = tilt) => { const me = new T.Mesh(g, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); par.add(me); return me; };

  add(new T.BoxGeometry(1.7, 0.42, 2.9), mBody, 0, 0.62, -0.1);                         // Wanne
  add(new T.BoxGeometry(1.2, 0.36, 1.2), mBody, 0, 0.6, 1.45, 0.25);                    // Nase
  add(new T.CylinderGeometry(0.16, 0.5, 0.9, 4), mWhite, 0, 0.62, 2.3, Math.PI / 2, Math.PI / 4);   // Nasenspitze
  add(new T.BoxGeometry(2.3, 0.22, 0.7), mBlack, 0, 0.42, 2.05);                        // Frontflügel
  add(new T.BoxGeometry(0.2, 0.34, 0.8), mDark, -1.1, 0.5, 2.05); add(new T.BoxGeometry(0.2, 0.34, 0.8), mDark, 1.1, 0.5, 2.05);
  add(new T.BoxGeometry(0.5, 0.45, 2.2), mDark, -1.0, 0.7, -0.1); add(new T.BoxGeometry(0.5, 0.45, 2.2), mDark, 1.0, 0.7, -0.1);   // Seitenkästen
  add(new T.BoxGeometry(0.5, 0.2, 2.0), mWhite, -1.0, 0.97, -0.1); add(new T.BoxGeometry(0.5, 0.2, 2.0), mWhite, 1.0, 0.97, -0.1);
  add(new T.BoxGeometry(2.1, 0.14, 0.7), mBody, 0, 1.55, -1.75);                        // Heckflügel
  add(new T.BoxGeometry(0.12, 0.8, 0.12), mBlack, -0.55, 1.15, -1.7); add(new T.BoxGeometry(0.12, 0.8, 0.12), mBlack, 0.55, 1.15, -1.7);
  add(new T.BoxGeometry(0.16, 0.5, 0.5), mDark, -1.05, 1.55, -1.75); add(new T.BoxGeometry(0.16, 0.5, 0.5), mDark, 1.05, 1.55, -1.75);
  add(new T.CylinderGeometry(0.17, 0.2, 0.7, 6), mMetal, -0.45, 0.62, -1.6, Math.PI / 2); add(new T.CylinderGeometry(0.17, 0.2, 0.7, 6), mMetal, 0.45, 0.62, -1.6, Math.PI / 2);
  // Sitz + Fahrer
  add(new T.BoxGeometry(1.0, 0.7, 0.35), mDark, 0, 1.1, -0.65);
  add(new T.BoxGeometry(0.78, 0.7, 0.5), mWhite, 0, 1.15, -0.2);                        // Oberkörper
  add(new T.BoxGeometry(0.78, 0.18, 0.52), mBody, 0, 0.88, -0.2);
  const head = new T.Group(); head.position.set(0, 1.78, -0.15); tilt.add(head);
  add(new T.SphereGeometry(0.36, 8, 6), mSkin, 0, 0, 0, 0, 0, 0, head);
  add(new T.SphereGeometry(0.43, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), mBody, 0, 0.04, -0.03, -0.18, 0, 0, head);       // Helm
  add(new T.BoxGeometry(0.62, 0.17, 0.1), mBlack, 0, 0.06, 0.34, 0, 0, 0, head);                                          // Brille
  add(new T.BoxGeometry(0.18, 0.3, 0.2), mDark, 0, 0.42, -0.28, 0, 0, 0, head);                                           // Helmkamm
  const wheelRig = new T.Group(); wheelRig.position.set(0, 1.1, 0.5); tilt.add(wheelRig);
  add(new T.TorusGeometry(0.22, 0.05, 5, 8), mBlack, 0, 0, 0, -0.9, 0, 0, wheelRig);
  add(new T.BoxGeometry(0.12, 0.12, 0.75), mDark, -0.4, 1.12, 0.15, 0.15, 0, 0); add(new T.BoxGeometry(0.12, 0.12, 0.75), mDark, 0.4, 1.12, 0.15, 0.15, 0, 0);

  // Räder
  const wheels = [], fronts = [];
  const wg = new T.CylinderGeometry(0.46, 0.46, 0.42, 9); wg.rotateZ(Math.PI / 2);
  const hg = new T.CylinderGeometry(0.22, 0.22, 0.46, 6); hg.rotateZ(Math.PI / 2);
  for (const [x, z, front] of [[-1.0, 1.1, true], [1.0, 1.1, true], [-1.05, -1.2, false], [1.05, -1.2, false]]) {
    const pivot = new T.Group(); pivot.position.set(x, 0.46, z); tilt.add(pivot);
    const w = new T.Group(); pivot.add(w);
    w.add(new T.Mesh(wg, mBlack)); w.add(new T.Mesh(hg, mMetal));
    wheels.push(w); if (front) fronts.push(pivot);
  }
  // Flammen
  const flameM = new T.MeshBasicMaterial({ color: 0xffa21a, transparent: true, opacity: 0.9 });
  const flames = [-0.45, 0.45].map((x) => {
    const f = new T.Mesh(new T.ConeGeometry(0.22, 1.5, 6), flameM);
    f.rotation.x = -Math.PI / 2; f.position.set(x, 0.62, -2.35); f.visible = false; tilt.add(f); return f;
  });
  // Schatten
  const shadow = new T.Mesh(new T.CircleGeometry(1, 14), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.35, 2.2, 1); shadow.position.y = 0.075;
  root.add(shadow);

  let tag = null;
  if (name && !opts.local) {
    const tex = canvasTex(T, 256, 64, (c, w, h) => {
      c.fillStyle = "rgba(10,12,24,.72)"; c.beginPath(); c.roundRect ? c.roundRect(2, 8, w - 4, h - 16, 24) : c.rect(2, 8, w - 4, h - 16); c.fill();
      c.fillStyle = "#" + body.getHexString(); c.beginPath(); c.arc(30, h / 2, 12, 0, 7); c.fill();
      c.fillStyle = "#fff"; c.font = "700 30px system-ui, sans-serif"; c.textBaseline = "middle"; c.textAlign = "left";
      c.fillText(name.length > 10 ? name.slice(0, 9) + "…" : name, 52, h / 2 + 2);
    });
    tag = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    tag.scale.set(5, 1.25, 1); tag.position.set(0, 3.9, 0); tag.renderOrder = 10; root.add(tag);
  }

  const hue = new T.Color();
  let wasStar = false, dv = 0, lastT = 0;
  return {
    root,
    set(st, t) {
      root.position.set(st.x, 0, st.z);
      root.rotation.y = st.yaw + (st.spinVis || 0);
      const dts = Math.min(0.05, Math.max(0, t - lastT)); lastT = t;
      dv += ((st.drift || 0) - dv) * Math.min(1, dts * 9);        // weich ein- und ausblenden statt Sprung
      const lean = (st.steer || 0) * 0.06 + dv * 0.1;
      tilt.position.y = st.hop || 0;
      tilt.rotation.z = lean;
      tilt.rotation.y = -dv * 0.3;       // Karosserie quer zur Fahrtrichtung beim Driften
      tilt.rotation.x = (st.hop || 0) * -0.06;
      fronts.forEach((f) => { f.rotation.y = -(st.steer || 0) * 0.5 + dv * 0.25; });
      wheels.forEach((w) => { w.rotation.x = st.wheel || 0; });
      wheelRig.rotation.z = (st.steer || 0) * 1.1;
      head.rotation.y = -(st.steer || 0) * 0.35; head.rotation.z = -(st.steer || 0) * 0.12;
      const fl = st.boost ? 0.7 + 0.5 * Math.sin(t * 60) ** 2 : 0;
      flames.forEach((f) => { f.visible = !!st.boost; f.scale.set(1, fl + 0.4, 1); f.position.z = -2.2 - fl * 0.6; });
      const s = Math.max(0.55, 1 - (st.hop || 0) * 0.25);
      shadow.scale.set(1.35 * s, 2.2 * s, 1);
      if (st.star) {
        hue.setHSL((t * 2.2) % 1, 0.9, 0.55);
        for (const m of mats) { m.emissive = m.emissive || new T.Color(); m.emissive.copy(hue).multiplyScalar(0.55); }
      } else if (wasStar) for (const m of mats) m.emissive.setHex(0);
      wasStar = !!st.star;
      root.visible = st.visible !== false;
      if (st.ghost) for (const m of mats) { m.transparent = true; m.opacity = 0.45; }
    },
    dispose() { root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}


// ---------- Lakitu: Wolke + Schildkröte mit Zielflagge, trägt Karts zurück auf die Strecke ----------

export function makeLakitu(T) {
  const root = new T.Group();
  const mk = (c, e = 0) => new T.MeshLambertMaterial({ color: c, flatShading: true, emissive: e });
  const white = mk(0xffffff, 0x303038), yellow = mk(0xffc928), green = mk(0x3fae4f), dark = mk(0x23262e), lens = new T.MeshBasicMaterial({ color: 0x9fe3ff });
  const add = (g, m, x, y, z, sx = 1, sy = sx, sz = sx) => { const me = new T.Mesh(g, m); me.position.set(x, y, z); me.scale.set(sx, sy, sz); root.add(me); return me; };
  const ico = (r, d = 0) => new T.IcosahedronGeometry(r, d);
  // Wolke
  add(ico(1.15), white, 0, 0, 0, 1.2, 0.85, 1.05);
  [[-1.15, -0.1, 0.1, 0.7], [1.15, -0.1, 0.1, 0.7], [-0.6, 0.45, 0.2, 0.6], [0.6, 0.45, 0.2, 0.6], [0, -0.45, 0.5, 0.6], [-0.7, -0.4, 0.3, 0.5], [0.7, -0.4, 0.3, 0.5]].forEach(([x, y, z, r]) => add(ico(r), white, x, y, z));
  add(new T.SphereGeometry(0.11, 6, 5), dark, -0.34, 0.1, 1.05, 1, 1.5, 0.6); add(new T.SphereGeometry(0.11, 6, 5), dark, 0.34, 0.1, 1.05, 1, 1.5, 0.6);
  // Schildkröte
  add(ico(0.8, 1), green, 0, 1.55, -0.45, 1.05, 0.85, 0.8);
  add(new T.SphereGeometry(0.5, 8, 6), yellow, 0, 1.4, 0.05, 1, 1, 0.9);
  const head = new T.Group(); head.position.set(0, 2.15, 0.2); root.add(head);
  const hadd = (g, m, x, y, z, rx = 0) => { const me = new T.Mesh(g, m); me.position.set(x, y, z); me.rotation.x = rx; head.add(me); return me; };
  hadd(new T.SphereGeometry(0.44, 8, 6), yellow, 0, 0, 0);
  hadd(new T.SphereGeometry(0.2, 6, 5), yellow, 0, -0.1, 0.42);
  for (const x of [-0.2, 0.2]) { hadd(new T.CylinderGeometry(0.19, 0.19, 0.14, 8), dark, x, 0.08, 0.38, Math.PI / 2); hadd(new T.CylinderGeometry(0.13, 0.13, 0.16, 8), lens, x, 0.08, 0.4, Math.PI / 2); }
  hadd(new T.TorusGeometry(0.45, 0.04, 4, 10), dark, 0, 0.08, 0.02, 0).rotation.x = Math.PI / 2;
  for (let i = -1; i <= 1; i++) hadd(new T.ConeGeometry(0.05, 0.3, 4), dark, i * 0.1, 0.47, -0.02);
  // Arm + Fahne
  add(new T.BoxGeometry(0.2, 0.2, 0.7), yellow, 0.55, 1.65, 0.45).rotation.set(-0.5, -0.4, 0);
  const pole = add(new T.CylinderGeometry(0.04, 0.04, 2.6, 5), mk(0x8a6a3a), 0.9, 2.55, 0.7);
  const flagTex = (() => {
    const c = document.createElement("canvas"); c.width = 128; c.height = 96; const g = c.getContext("2d");
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) { g.fillStyle = (x + y) % 2 ? "#fff" : "#111"; g.fillRect(x * 21.4, y * 24, 22, 24); }
    return new T.CanvasTexture(c);
  })();
  const flag = new T.Mesh(new T.PlaneGeometry(1.5, 1.1, 6, 1), new T.MeshBasicMaterial({ map: flagTex, side: T.DoubleSide }));
  flag.position.set(1.65, 3.4, 0.7); root.add(flag);
  const fpos = flag.geometry.attributes.position, base = Array.from(fpos.array);
  root.visible = false;
  return {
    root,
    set(x, y, z, cx, cz, t) {
      root.visible = true;
      root.position.set(x, y + Math.sin(t * 5) * 0.15, z);
      root.rotation.y = Math.atan2(cx - x, cz - z);              // schaut zur Kamera
      for (let i = 0; i < fpos.count; i++) fpos.setZ(i, Math.sin(t * 9 + base[i * 3] * 3) * 0.12 * (base[i * 3] + 0.75));
      fpos.needsUpdate = true;
    },
    hide() { root.visible = false; },
  };
}

// ---------- Partikel ----------

function makeParticles(T, scene, cap = 900) {
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3);
  const vel = new Float32Array(cap * 3), life = new Float32Array(cap), max = new Float32Array(cap), base = new Float32Array(cap * 3), grav = new Float32Array(cap);
  pos.fill(-9999);
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(pos, 3));
  g.setAttribute("color", new T.BufferAttribute(col, 3));
  const tex = canvasTex(T, 32, 32, (c) => {
    const gr = c.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
  });
  const pts = new T.Points(g, new T.PointsMaterial({ size: 0.9, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
  pts.frustumCulled = false;
  scene.add(pts);
  let n = 0;
  const c = new T.Color();
  return {
    emit(x, y, z, vx, vy, vz, l, hex, gr = -9) {
      const i = n; n = (n + 1) % cap;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = max[i] = l; grav[i] = gr;
      c.setHex(hex); base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b;
    },
    update(dt) {
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
        vel[i * 3 + 1] += grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.05) { pos[i * 3 + 1] = 0.05; vel[i * 3 + 1] *= -0.3; }
        const f = life[i] / max[i];
        col[i * 3] = base[i * 3] * f; col[i * 3 + 1] = base[i * 3 + 1] * f; col[i * 3 + 2] = base[i * 3 + 2] * f;
      }
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    },
  };
}

// ---------- Item-Objekte ----------

function makeItemBox(T) {
  const tex = canvasTex(T, 128, 128, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h);
    ["#ff5d5d", "#ffd23f", "#4be37a", "#3fa9ff", "#b05dff"].forEach((col, i, a) => gr.addColorStop(i / (a.length - 1), col));
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(255,255,255,.28)"; c.fillRect(0, 0, w, h / 2);
    c.fillStyle = "#fff"; c.font = "900 92px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 6; c.fillText("?", w / 2, h / 2 + 6);
  });
  const mat = new T.MeshLambertMaterial({ map: tex, emissive: 0x333333, transparent: true, opacity: 0.93 });
  return new T.Mesh(new T.BoxGeometry(1.7, 1.7, 1.7), mat);
}

function makeBanana(T) {
  const g = new T.Group();
  const m = new T.MeshLambertMaterial({ color: 0xffd21f, flatShading: true });
  const a = new T.Mesh(new T.TorusGeometry(0.75, 0.24, 5, 8, Math.PI * 0.95), m);
  a.rotation.set(Math.PI / 2, 0, Math.PI * 0.03); a.position.y = 0.65; g.add(a);
  const tip = new T.Mesh(new T.BoxGeometry(0.16, 0.16, 0.3), new T.MeshLambertMaterial({ color: 0x6b4a1a, flatShading: true }));
  tip.position.set(-0.7, 0.7, 0.2); g.add(tip);
  g.userData.spin = true;
  return g;
}

function makeShell(T) {
  const g = new T.Group();
  g.add(new T.Mesh(new T.IcosahedronGeometry(0.85, 1), new T.MeshLambertMaterial({ color: 0xe23b3b, flatShading: true })));
  const rim = new T.Mesh(new T.TorusGeometry(0.86, 0.12, 4, 10), new T.MeshLambertMaterial({ color: 0xfff6dd, flatShading: true }));
  rim.rotation.x = Math.PI / 2; g.add(rim);
  g.position.y = 0.9;
  return g;
}

// ---------- Welt ----------

export function createWorld(T, host, track, themeKey, opts = {}) {
  const th = THEMES[themeKey] || THEMES.wiese;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const renderer = new T.WebGLRenderer({ antialias: !coarse, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.setClearColor(th.sky);
  renderer.domElement.className = "kt-canvas";
  host.appendChild(renderer.domElement);

  const scene = new T.Scene();
  scene.background = new T.Color(th.sky);
  scene.fog = new T.Fog(th.fog, 90, 520);
  scene.add(new T.HemisphereLight(th.hemiSky, th.hemiGround, th.hemi));
  const sun = new T.DirectionalLight(th.sun, th.sunI);
  sun.position.set(-60, 120, 40); scene.add(sun);

  const camera = new T.PerspectiveCamera(66, 1, 0.5, 2400);

  // Boden
  const gm = new T.Mesh(new T.PlaneGeometry(6000, 6000), new T.MeshLambertMaterial({ color: th.ground }));
  gm.rotation.x = -Math.PI / 2; gm.position.set((track.bounds.minX + track.bounds.maxX) / 2, -0.06, (track.bounds.minZ + track.bounds.maxZ) / 2);
  scene.add(gm);

  buildRoad(T, track, th, scene);
  buildStartArch(T, track, th, scene);
  buildPads(T, track, scene);
  const extra = buildScenery(T, track, th, scene, track.seed, coarse);

  // Item-Boxen
  const boxes = track.boxes.map((b) => {
    const p = pointAt(track, b.i * track.sp, b.lat);
    const m = makeItemBox(T); m.position.set(p.x, 1.5, p.z); scene.add(m);
    return { id: b.id, mesh: m, x: p.x, z: p.z, active: true, back: 0, pop: 1 };
  });

  const particles = makeParticles(T, scene, coarse ? 500 : 900);
  const dyn = new Map();          // Bananen / Panzer: id → { mesh, … }

  const size = () => {
    const w = host.clientWidth || 640, h = host.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // im Hochformat weiter herausziehen, damit die Strecke zu sehen bleibt
    camera.fov = w / h < 1 ? 70 : 64;
    camera.updateProjectionMatrix();
  };
  size();

  return {
    T, scene, camera, renderer, particles, boxes, dyn, theme: th, size, coarse,
    update(dt, t) {
      for (const b of boxes) {
        if (b.active) { b.mesh.visible = true; b.pop = Math.min(1, b.pop + dt * 3); }
        else { b.mesh.visible = b.pop > 0.01; b.pop = Math.max(0, b.pop - dt * 6); if (b.back > 0) { b.back -= dt; if (b.back <= 0) { b.active = true; b.pop = 0; } } }
        b.mesh.rotation.y = t * 1.6; b.mesh.rotation.x = 0.4 + Math.sin(t * 1.1 + b.id) * 0.15;
        b.mesh.position.y = 1.5 + Math.sin(t * 2.2 + b.id * 0.7) * 0.25;
        b.mesh.scale.setScalar(Math.max(0.001, b.pop));
      }
      for (const o of dyn.values()) if (o.mesh.userData.spin) o.mesh.rotation.y += dt * 4;
      for (const c of extra.clouds) { c.position.x += c.userData.speed * dt; }
      particles.update(dt);
    },
    takeBox(id, secs = 5) { const b = boxes.find((x) => x.id === id); if (b && b.active) { b.active = false; b.back = secs; } return b; },
    addItem(id, kind, x, z) {
      this.removeItem(id);
      const mesh = kind === "banana" ? makeBanana(T) : makeShell(T);
      mesh.position.set(x, kind === "banana" ? 0 : 0.9, z);
      scene.add(mesh);
      const o = { id, kind, mesh }; dyn.set(id, o); return o;
    },
    removeItem(id) { const o = dyn.get(id); if (o) { scene.remove(o.mesh); dyn.delete(id); } },
    clearItems() { for (const id of [...dyn.keys()]) this.removeItem(id); },
    makeKart: (color, name, o) => makeKartModel(T, color, name, o),
    makeLakitu: () => { const l = makeLakitu(T); scene.add(l.root); return l; },
    render() { renderer.render(scene, camera); },
    dispose() {
      renderer.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const m of [].concat(o.material)) { if (m.map) m.map.dispose(); m.dispose(); } } });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      try { renderer.forceContextLoss(); } catch {}
    },
  };
}
