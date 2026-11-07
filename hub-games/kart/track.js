// Kart-Rennen — Strecken: aus einem Seed wird eine geschlossene Rundstrecke (auf allen Geräten identisch).
//
// Die Mittellinie ist eine „sternförmige“ Kurve r(θ) aus ein paar Oberwellen, gleichmäßig in ~2 m Schritten
// neu abgetastet. So kreuzt sich die Strecke nie selbst, und die engste Kurve lässt sich prüfen und
// notfalls abschwächen. Alles Weitere (Straße, Bande, Kulisse) baut world.js aus diesen Arrays.
//
// Koordinaten: x/z in der Ebene, y nach oben. Fahrtrichtung (Heading ψ): vorwärts = (sin ψ, cos ψ),
// rechts = (−fz, fx), d. h. die Rechtsdrehung verkleinert ψ.

export const HALF = 9;        // halbe Straßenbreite (m)
export const CURB = 1.4;      // Randsteine daneben
export const WALL = 17;       // Abstand der Bande zur Mittellinie
export const POST_LAT = HALF + 2.2;   // Pfosten des Zielbogens
export const SHOULDER = HALF + CURB;   // ab hier: Gras / Sand, bremst

export function hashStr(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Themen ----
// Farben als 0xRRGGBB; world.js leitet daraus Licht, Nebel und Kulisse ab.
export const THEMES = {
  wiese: {
    name: "Sonnenwiese", sky: 0x7cc8ff, fog: 0xcdeaff, ground: 0x62b24c, shoulder: 0x4f9a3d, road: 0x4b4e57, roadAlt: 0x545761,
    curbA: 0xe23b3b, curbB: 0xf6f6f2, wall: 0xf2f2ee, wallAlt: 0x3b6fe0, hemiSky: 0xffffff, hemiGround: 0x6fae5a, hemi: 0.85, sun: 0xfff1d0, sunI: 0.85,
    far: 0x6f9fd0, props: "wiese",
  },
  wueste: {
    name: "Kaktus-Canyon", sky: 0xffb870, fog: 0xffdcaa, ground: 0xe6bb6c, shoulder: 0xd2a557, road: 0x58504f, roadAlt: 0x625958,
    curbA: 0xd2552a, curbB: 0xf8e9c8, wall: 0xf3dfb4, wallAlt: 0xc4572b, hemiSky: 0xfff0d8, hemiGround: 0xd9a95c, hemi: 0.9, sun: 0xffe0a8, sunI: 0.9,
    far: 0xc9794a, props: "wueste",
  },
  schnee: {
    name: "Eisgipfel", sky: 0x9fd0ff, fog: 0xe4f1ff, ground: 0xf2f7ff, shoulder: 0xd7e6f6, road: 0x5a6271, roadAlt: 0x646c7b,
    curbA: 0x2b7fe0, curbB: 0xffffff, wall: 0xffffff, wallAlt: 0x2b7fe0, hemiSky: 0xffffff, hemiGround: 0xbcd4ee, hemi: 0.95, sun: 0xffffff, sunI: 0.7,
    far: 0x9bb6d8, props: "schnee",
  },
  nacht: {
    name: "Neon-Nacht", sky: 0x0a0e2c, fog: 0x151a4a, ground: 0x1b2440, shoulder: 0x16203a, road: 0x2b2d40, roadAlt: 0x333650,
    curbA: 0xff2d95, curbB: 0x16e0ff, wall: 0x16e0ff, wallAlt: 0xff2d95, hemiSky: 0x6a74ff, hemiGround: 0x20284a, hemi: 0.75, sun: 0xb9c4ff, sunI: 0.55,
    far: 0x252a66, props: "nacht",
  },
};

// feste Strecken; der Rest (Seed, Thema) bestimmt Form und Aussehen
export const TRACKS = [
  { id: "wiese",  name: "Sonnenwiese",   theme: "wiese",  seed: 1101, blurb: "Breite Kurven, ideal zum Einfahren" },
  { id: "wueste", name: "Kaktus-Canyon", theme: "wueste", seed: 2207, blurb: "Schnelle Geraden und enge Haken" },
  { id: "schnee", name: "Eisgipfel",     theme: "schnee", seed: 3313, blurb: "Viele Kurven hintereinander" },
  { id: "nacht",  name: "Neon-Nacht",    theme: "nacht",  seed: 4421, blurb: "Leuchtende Schikanen im Dunkeln" },
];

const KS = [2, 3, 4, 5, 6];
const AMP = [0.2, 0.16, 0.11, 0.075, 0.045];

function resample(poly, spacing) {
  // poly: geschlossene Punktliste [x,z]; gibt gleichmäßig verteilte Punkte zurück
  const n = poly.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const L = cum[n];
  const N = Math.max(60, Math.round(L / spacing));
  const step = L / N;
  const out = [];
  let seg = 0;
  for (let k = 0; k < N; k++) {
    const target = k * step;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const a = poly[seg], b = poly[(seg + 1) % n];
    const t = (target - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { pts: out, L: step * N, step };
}

function minRadius(pts, stride = 4) {
  const n = pts.length;
  let m = 1e9;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - stride + n) % n], b = pts[i], c = pts[(i + stride) % n];
    const abx = b[0] - a[0], abz = b[1] - a[1], bcx = c[0] - b[0], bcz = c[1] - b[1], cax = a[0] - c[0], caz = a[1] - c[1];
    const cr = Math.abs(abx * bcz - abz * bcx);
    if (cr < 1e-6) continue;
    const r = (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(cax, caz)) / (2 * cr);
    if (r < m) m = r;
  }
  return m;
}

export function buildTrack(seed) {
  const R = rng(seed);
  const phase = KS.map(() => R() * Math.PI * 2);
  const jit = KS.map(() => 0.55 + R() * 0.9);
  const squash = 0.6 + R() * 0.3;
  const mirror = R() < 0.5 ? 1 : -1;
  const rot = R() * Math.PI * 2;
  const base = 225;

  let scale = 1, res = null;
  for (let tries = 0; tries < 16; tries++) {
    const poly = [];
    const M = 960;
    for (let i = 0; i < M; i++) {
      const th = (i / M) * Math.PI * 2;
      let r = 1;
      for (let k = 0; k < KS.length; k++) r += AMP[k] * jit[k] * scale * Math.cos(KS[k] * th + phase[k]);
      r *= base;
      const x = r * Math.cos(th), z = r * Math.sin(th) * squash * mirror;
      poly.push([x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
    }
    res = resample(poly, 2.2);
    if (minRadius(res.pts) >= 30) break;
    scale *= 0.86;
  }

  const N = res.pts.length, sp = res.step, L = res.L;
  const cx = new Float32Array(N), cz = new Float32Array(N), fx = new Float32Array(N), fz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = res.pts[(i - 1 + N) % N], b = res.pts[i], c = res.pts[(i + 1) % N];
    let tx = c[0] - a[0], tz = c[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    cx[i] = b[0]; cz[i] = b[1]; fx[i] = tx / l; fz[i] = tz / l;
  }
  const rx = new Float32Array(N), rz = new Float32Array(N);
  for (let i = 0; i < N; i++) { rx[i] = -fz[i]; rz[i] = fx[i]; }

  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, cx[i]); maxX = Math.max(maxX, cx[i]); minZ = Math.min(minZ, cz[i]); maxZ = Math.max(maxZ, cz[i]); }

  const track = { seed, N, sp, L, cx, cz, fx, fz, rx, rz, bounds: { minX, maxX, minZ, maxZ }, pads: [], boxes: [], start: 0 };

  // Boost-Pads: etwa alle Viertel einmal, leicht versetzt
  const R2 = rng(seed ^ 0x9e3779b9);
  for (let k = 0; k < 4; k++) {
    const i = Math.floor(((k + 0.25 + R2() * 0.5) / 4) * N) % N;
    track.pads.push({ i, lat: (R2() - 0.5) * 8 });
  }
  // Item-Boxen: 5 Reihen à 4
  const rows = [0.1, 0.3, 0.5, 0.68, 0.86];
  rows.forEach((f, r) => {
    const i = Math.floor((f + (R2() - 0.5) * 0.03) * N) % N;
    [-6, -2, 2, 6].forEach((lat, c) => track.boxes.push({ id: r * 4 + c, i, lat }));
  });
  track.posts = [-1, 1].map((sd) => { const p = pointAt(track, 0, sd * POST_LAT); return { x: p.x, z: p.z }; });
  return track;
}

// Ort + Abstand zur Mittellinie. hint = letzter Index (schnell, ±W) oder -1 (alles absuchen).
export function locate(t, x, z, hint = -1, out = {}) {
  const N = t.N;
  let best = 0, bd = Infinity;
  if (hint < 0) {
    for (let i = 0; i < N; i++) {
      const dx = x - t.cx[i], dz = z - t.cz[i], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
  } else {
    for (let k = -40; k <= 40; k++) {
      const i = (hint + k + N) % N;
      const dx = x - t.cx[i], dz = z - t.cz[i], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
  }
  const dx = x - t.cx[best], dz = z - t.cz[best];
  const along = dx * t.fx[best] + dz * t.fz[best];
  out.i = best;
  out.d = dx * t.rx[best] + dz * t.rz[best];              // rechts positiv
  out.s = (((best * t.sp + along) % t.L) + t.L) % t.L;    // Meter ab Start
  out.dist = Math.sqrt(bd);
  return out;
}

// Punkt auf der Strecke: Index (auch gebrochen), seitlicher Versatz
export function pointAt(t, s, lat = 0, out = {}) {
  const N = t.N;
  let f = (s / t.sp) % N; if (f < 0) f += N;
  const i = Math.floor(f), j = (i + 1) % N, u = f - i;
  const px = t.cx[i] + (t.cx[j] - t.cx[i]) * u, pz = t.cz[i] + (t.cz[j] - t.cz[i]) * u;
  let fx = t.fx[i] + (t.fx[j] - t.fx[i]) * u, fz = t.fz[i] + (t.fz[j] - t.fz[i]) * u;
  const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
  out.x = px + -fz * lat; out.z = pz + fx * lat;
  out.fx = fx; out.fz = fz;
  out.yaw = Math.atan2(fx, fz);
  return out;
}

// Startaufstellung: zwei Reihen hinter der Ziellinie
export function gridSlot(t, k) {
  const row = Math.floor(k / 2), side = k % 2 ? 1 : -1;
  return pointAt(t, -(7 + row * 6.5), side * 3.2 + (k % 2 ? 0 : 0));
}
