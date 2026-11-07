// Kart-Rennen — Fahrmodell (Arcade, wie Mario Kart): Gas, Bremse, Lenken, Driften mit Mini-Turbo,
// Boost, Drehen nach Treffern, Bande und Gras. Läuft mit festem Schritt (1/60 s) auf jedem Client für das eigene Kart.

import { HALF, WALL, SHOULDER, locate } from "./track.js";

export const DT = 1 / 60;
export const MAXV = 34;               // m/s auf der Geraden (Anzeige: ×3.9 → ~130 km/h)
export const BOOST_V = 1.36;          // Boost hebt die Höchstgeschwindigkeit auf dieses Vielfache
export const KMH = 3.9;
export const DRIFT_LEVELS = [0.9, 1.9, 3.1];       // Sekunden bis Stufe 1 / 2 / 3
export const DRIFT_BOOST = [0.65, 1.1, 1.6];       // Boost-Dauer je Stufe

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, to, k) => v + (to - v) * Math.min(1, k);

export function newKart(x, z, yaw) {
  return {
    x, z, yaw, vx: 0, vz: 0,
    along: 0, lat: 0,                    // Geschwindigkeit längs / quer zum Kart (aus vx, vz)
    steer: 0,                            // geglätteter Lenkausschlag −1..1 (rechts +)
    drift: 0, driftT: 0, driftLvl: 0,    // Drift-Richtung (−1 links, +1 rechts), Dauer, Stufe 0..3
    boostT: 0, slideT: 0, starT: 0, spinT: 0, spinDir: 1, spinVis: 0,
    offroad: false, hop: 0, hopV: 0, grip: 1,
    prog: 0, lap: 0, lastS: 0, idx: -1, d: 0, s: 0,
    wheel: 0, bump: 0, inv: 0,
    events: [],                          // Ereignisse für Ton / Partikel dieses Schritts
  };
}

export function hit(k, kind) {
  // kind: "spin" (Banane, Panzer)
  if (k.starT > 0 || k.inv > 0 || k.spinT > 0) return false;
  k.spinT = 1.35; k.spinDir = Math.random() < 0.5 ? -1 : 1; k.spinVis = 0;
  k.drift = 0; k.driftT = 0; k.driftLvl = 0;
  k.boostT = 0; k.slideT = 0;
  k.hopV = 6.5;
  k.events.push("hit");
  return true;
}

export function boost(k, secs) {
  k.boostT = Math.max(k.boostT, secs);
  k.events.push("boost");
}

// inp: { gas 0..1, brake 0..1, steer −1..1, drift bool }
export function step(k, inp, dt, track, others) {
  const sin = Math.sin(k.yaw), cos = Math.cos(k.yaw);
  const fx = sin, fz = cos, rx = -cos, rz = sin;
  k.along = k.vx * fx + k.vz * fz;
  k.lat = k.vx * rx + k.vz * rz;

  const spinning = k.spinT > 0;
  const gas = spinning ? 0 : inp.gas, brake = spinning ? 0 : inp.brake;

  // Lenkung glätten (Tastatur springt zwischen −1/0/1)
  const want = spinning ? 0 : inp.steer;
  k.steer = approach(k.steer, want, dt * (Math.abs(want) > Math.abs(k.steer) ? 9 : 12));

  // Drift: Taste + Lenken, ab ordentlichem Tempo
  if (!spinning && inp.drift && !k.drift && k.along > 14 && Math.abs(inp.steer) > 0.25 && k.hop <= 0.01) {
    k.drift = inp.steer > 0 ? 1 : -1; k.driftT = 0; k.driftLvl = 0;
    k.hopV = 4.2; k.events.push("driftStart");
  }
  if (k.drift && (!inp.drift || k.along < 9 || spinning)) {
    if (k.driftLvl > 0 && !spinning) { boost(k, DRIFT_BOOST[k.driftLvl - 1]); k.events.push("miniturbo"); }
    k.drift = 0; k.driftT = 0; k.driftLvl = 0;
    k.slideT = 0.7;      // Ausfahren: Seitenhalt kommt nur langsam zurück, Kart behält die Driftrichtung
  }
  if (k.drift) {
    k.driftT += dt;
    // Gegenlenken verlangsamt das Aufladen nicht, aber ohne Einschlag (< 0.15) lädt es nicht
    const lvl = k.driftT >= DRIFT_LEVELS[2] ? 3 : k.driftT >= DRIFT_LEVELS[1] ? 2 : k.driftT >= DRIFT_LEVELS[0] ? 1 : 0;
    if (lvl !== k.driftLvl) { k.driftLvl = lvl; k.events.push("driftLvl"); }
  }

  // Höchstgeschwindigkeit
  const boosting = k.boostT > 0;
  let cap = MAXV * (boosting ? BOOST_V : 1);
  if (k.starT > 0) cap = Math.max(cap, MAXV * 1.22);
  const off = k.offroad && k.starT <= 0 && !boosting;     // Pilz / Turbo ignoriert das Gras
  if (off) cap = MAXV * 0.46;
  if (k.drift) cap *= 0.97;

  // Längsbeschleunigung
  let a = k.along;
  if (boosting) a += (cap - a) * Math.min(1, dt * 5) + 26 * dt;
  else if (gas > 0 && a < cap) a += (36 - 30 * Math.max(0, a / cap)) * gas * dt * (off ? 0.8 : 1);
  if (brake > 0) a += (a > 0.5 ? -46 : -16) * brake * dt;
  if (gas <= 0 && brake <= 0 && !boosting) a -= a * 0.42 * dt + Math.sign(a) * 1.5 * dt;
  if (a > cap) a -= (a - cap) * Math.min(1, dt * (off ? 3 : 1.2));
  a = clamp(a, -11, MAXV * 1.5);
  if (Math.abs(a) < 0.15 && gas <= 0 && brake <= 0) a = 0;

  // Seitenhalt: normal fest, im Drift rutscht es, im Gras mittel
  const gripTarget = k.drift ? 2.2 : off ? 5 : spinning ? 1.2 : 11;
  k.grip = approach(k.grip, gripTarget, dt * (k.slideT > 0 && !k.drift ? 2.2 : 12));
  if (k.slideT > 0) k.slideT = Math.max(0, k.slideT - dt);
  const lat = k.lat * Math.exp(-k.grip * dt);

  // Lenkung
  const sf = clamp(Math.abs(a) / 9, 0, 1) * (1 - 0.28 * clamp(Math.abs(a) / MAXV, 0, 1));
  let yawRate;
  if (k.drift) {
    // Radius per Lenkung: Gegenlenken (−1) = weiter Bogen, Reinlenken (+1) = enger, wie bei Mario Kart
    const aligned = k.steer * k.drift;
    const t = (aligned + 1) / 2;
    yawRate = -k.drift * (0.32 + 0.8 * t) * clamp(Math.pow(20 / Math.max(Math.abs(a), 10), 0.7), 0.6, 1.5);   // schneller = weiterer Bogen, langsamer = enger
  } else {
    yawRate = -k.steer * 2.15 * sf * (a < -0.5 ? -1 : 1);
  }
  if (spinning) yawRate = 0;
  k.yaw += yawRate * dt;

  // neue Geschwindigkeit in Weltkoordinaten (mit dem gerade gedrehten Heading, damit Kurven „greifen“)
  const sin2 = Math.sin(k.yaw), cos2 = Math.cos(k.yaw);
  k.vx = sin2 * a + -cos2 * lat;
  k.vz = cos2 * a + sin2 * lat;
  if (spinning) { k.vx *= Math.exp(-1.8 * dt); k.vz *= Math.exp(-1.8 * dt); }

  k.x += k.vx * dt;
  k.z += k.vz * dt;

  // Timer
  if (k.boostT > 0) k.boostT = Math.max(0, k.boostT - dt);
  if (k.starT > 0) k.starT = Math.max(0, k.starT - dt);
  if (k.inv > 0) k.inv = Math.max(0, k.inv - dt);
  if (k.spinT > 0) {
    k.spinT -= dt;
    k.spinVis += (Math.PI * 2 * k.spinDir / 1.35) * dt;
    if (k.spinT <= 0) { k.spinT = 0; k.spinVis = 0; k.inv = 1.2; }
  }

  // Hüpfen (Drift-Start, Treffer)
  if (k.hopV !== 0 || k.hop > 0) {
    k.hopV -= 24 * dt; k.hop += k.hopV * dt;
    if (k.hop <= 0) { k.hop = 0; k.hopV = 0; }
  }

  // Position auf der Strecke, Bande, Gras
  const L = track.L;
  const loc = locate(track, k.x, k.z, k.idx, k._loc || (k._loc = {}));
  k.idx = loc.i; k.d = loc.d;
  const ad = Math.abs(loc.d);
  k.offroad = ad > SHOULDER - 0.2;
  if (ad > WALL) {
    const side = loc.d > 0 ? 1 : -1;
    const nx = track.rx[loc.i] * side, nz = track.rz[loc.i] * side;           // zeigt nach außen
    const over = ad - WALL;
    k.x -= nx * over; k.z -= nz * over;
    const vn = k.vx * nx + k.vz * nz;
    if (vn > 0) {
      k.vx -= nx * vn * 1.4; k.vz -= nz * vn * 1.4;
      const keep = vn > 6 ? 0.82 : 0.94;
      k.vx *= keep; k.vz *= keep;
      if (vn > 5) k.events.push("bump");
      k.bump = Math.min(1, vn / 14);
    }
  }
  k.bump = Math.max(0, k.bump - dt * 3);

  // Pfosten des Zielbogens (Kreis, Radius ~0.55 + Kart ~1.1)
  if (track.posts) for (const p of track.posts) {
    const dx = k.x - p.x, dz = k.z - p.z, d2 = dx * dx + dz * dz, R = 1.7;
    if (d2 < R * R && d2 > 1e-6) {
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      k.x = p.x + nx * R; k.z = p.z + nz * R;
      const vn = k.vx * nx + k.vz * nz;
      if (vn < 0) {
        k.vx -= nx * vn * 1.4; k.vz -= nz * vn * 1.4;
        k.vx *= 0.8; k.vz *= 0.8;
        if (-vn > 5) k.events.push("bump");
        k.bump = Math.min(1, -vn / 14);
      }
    }
  }

  // Kart gegen Kart (nur das eigene wird bewegt, der andere rechnet bei sich selbst dasselbe)
  if (others) for (const o of others) {
    const dx = k.x - o.x, dz = k.z - o.z, d2 = dx * dx + dz * dz;
    if (d2 < 2.5 * 2.5 && d2 > 1e-4) {
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = 2.5 - d;
      k.x += nx * push * 0.55; k.z += nz * push * 0.55;
      const vn = k.vx * nx + k.vz * nz;
      if (vn < 0) { k.vx -= nx * vn * 0.9; k.vz -= nz * vn * 0.9; k.vx *= 0.985; k.vz *= 0.985; }
      if (-vn > 6) k.events.push("bump");
    }
  }

  // Fortschritt (monoton, rückwärts zählt ab)
  let ds = loc.s - k.lastS;
  if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
  k.lastS = loc.s;
  k.s = loc.s;
  k.prog += ds;
  k.wheel += k.along * dt / 0.42;
}

// Zurück auf die Strecke (Taste R oder festgefahren)
export function respawn(k, track, pointAt) {
  const loc = locate(track, k.x, k.z, -1, {});
  const p = pointAt(track, loc.s + 1, Math.max(-5, Math.min(5, loc.d)));
  k.x = p.x; k.z = p.z; k.yaw = p.yaw; k.vx = 0; k.vz = 0; k.along = 0; k.lat = 0;
  k.steer = 0; k.drift = 0; k.driftT = 0; k.driftLvl = 0; k.boostT = 0; k.spinT = 0; k.spinVis = 0;
  k.inv = 1.5; k.idx = loc.i; k.lastS = loc.s; k.s = loc.s;
}
