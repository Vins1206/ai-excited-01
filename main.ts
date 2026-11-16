// The First Dawn — v3
// A colossal fire phoenix erupts across a star-drowned night sky, wings
// stretched to the very edges of the frame, its head turned toward a huge
// haloed full moon. Far below, on a black cliff above a shining sea, a tiny
// lantern-bearing explorer witnesses the first dawn that ever burned.
// Pure Node 22 standard library. Deterministic: one fixed seed, no clock,
// no randomness beyond a seeded generator, so two runs are byte-identical.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- utilities

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

type RGB = [number, number, number];

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Multi-stop gradient: stops are [position 0..1, colour] sorted by position.
function gradient(stops: Array<[number, RGB]>, t: number): RGB {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const p0 = stops[i - 1][0];
      const p1 = stops[i][0];
      const f = p1 > p0 ? (x - p0) / (p1 - p0) : 0;
      return mix(stops[i - 1][1], stops[i][1], f);
    }
  }
  return stops[stops.length - 1][1];
}

// Seeded generator (mulberry32) — the single source of variation.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261117);

// Deterministic value noise with bilinear interpolation, plus fbm.
function hash2(ix: number, iy: number): number {
  let n = (ix * 374761393 + iy * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x: number, y: number, oct: number): number {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(fx, fy);
    fx *= 2.03;
    fy *= 1.97;
    amp *= 0.5;
  }
  return v;
}

// ------------------------------------------------------------- frame buffer
// Float RGB buffer, values nominally 0..255, with headroom for glow.

const buf = new Float32Array(W * H * 3);

function addAt(idx: number, c: RGB, a: number): void {
  buf[idx] += c[0] * a;
  buf[idx + 1] += c[1] * a;
  buf[idx + 2] += c[2] * a;
}
function blendAt(idx: number, c: RGB, a: number): void {
  buf[idx] = lerp(buf[idx], c[0], a);
  buf[idx + 1] = lerp(buf[idx + 1], c[1], a);
  buf[idx + 2] = lerp(buf[idx + 2], c[2], a);
}

// Fill a region using a signed-distance function (negative inside) and a
// colour function. Soft one-pixel edge, plus an optional additive halo that
// bleeds light outside the silhouette — the fire look comes from this halo.
type SdFn = (x: number, y: number) => number;
type ColFn = (x: number, y: number) => { c: RGB; a: number };

function paint(
  x0: number, y0: number, x1: number, y1: number,
  sd: SdFn, col: ColFn,
  glow: { dist: number; c: RGB; strength: number } | null,
): void {
  const gx0 = Math.max(0, Math.floor(x0 - (glow ? glow.dist : 0)));
  const gy0 = Math.max(0, Math.floor(y0 - (glow ? glow.dist : 0)));
  const gx1 = Math.min(W - 1, Math.ceil(x1 + (glow ? glow.dist : 0)));
  const gy1 = Math.min(H - 1, Math.ceil(y1 + (glow ? glow.dist : 0)));
  for (let y = gy0; y <= gy1; y++) {
    for (let x = gx0; x <= gx1; x++) {
      const d = sd(x + 0.5, y + 0.5);
      const idx = (y * W + x) * 3;
      if (glow && d > 0) {
        const g = Math.exp(-d / (glow.dist * 0.42)) * glow.strength;
        if (g > 0.004) addAt(idx, glow.c, g);
      }
      if (d < 1.2) {
        const cover = clamp(0.6 - d, 0, 1);
        if (cover <= 0) continue;
        const { c, a } = col(x + 0.5, y + 0.5);
        blendAt(idx, c, a * cover);
      }
    }
  }
}

function discSd(cx: number, cy: number, r: number): SdFn {
  return (x, y) => Math.hypot(x - cx, y - cy) - r;
}
function ellipseSd(cx: number, cy: number, rx: number, ry: number, rot: number): SdFn {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const lx = Math.abs(dx * cr + dy * sr);
    const ly = Math.abs(-dx * sr + dy * cr);
    // proper ellipse distance (iq approximation) — a max() of the two axes
    // would give a rounded rectangle, not an ellipse
    const k0 = Math.hypot(lx / rx, ly / ry);
    const k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry));
    return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry);
  };
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
function polySd(pts: Array<[number, number]>): SdFn {
  return (x, y) => {
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      best = Math.min(best, segDist(x, y, xj, yj, xi, yi));
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside ? -best : best;
  };
}

// ------------------------------------------------------------------ the sky
// Deep indigo zenith melting into teal at the horizon, a diagonal milky way,
// vivid aurora curtains, a huge haloed moon, and a dense field of stars.

const MOON_X = 776;
const MOON_Y = 192;
const MOON_R = 92;

const skyTop: RGB = [4, 6, 22];
const skyMid: RGB = [10, 14, 44];
const skyLow: RGB = [13, 38, 62];
const skyHorizon: RGB = [24, 62, 74];

function paintSky(): void {
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      let c: RGB;
      if (v < 0.45) c = mix(skyTop, skyMid, v / 0.45);
      else if (v < 0.78) c = mix(skyMid, skyLow, (v - 0.45) / 0.33);
      else c = mix(skyLow, skyHorizon, (v - 0.78) / 0.22);

      // Milky way: a soft diagonal river of pale light.
      const band = Math.abs((x * 0.62 + y * 1.0) - 560) / 190;
      const way = Math.exp(-band * band * 2.2) * (0.35 + 0.65 * fbm(x * 0.012, y * 0.012, 3));
      c = mix(c, [96, 110, 150], clamp(way * 0.34, 0, 0.4));

      // Aurora curtains: two overlapping ribbons with vertical ray streaks.
      const ray = 0.55 + 0.45 * Math.sin(x * 0.045 + fbm(x * 0.01, y * 0.01, 2) * 9.0);
      const cen1 = 148 + 74 * Math.sin(x * 0.0038 + 1.2) + 26 * Math.sin(x * 0.013);
      const d1 = Math.abs(y - cen1) / 118;
      const aur1 = Math.exp(-d1 * d1 * 1.9) * ray;
      const cen2 = 268 + 88 * Math.sin(x * 0.0031 + 3.6) + 30 * Math.sin(x * 0.009 + 2.0);
      const d2 = Math.abs(y - cen2) / 150;
      const aur2 = Math.exp(-d2 * d2 * 2.1) * (0.5 + 0.5 * Math.sin(x * 0.03 + 4.0));
      const aurCol1 = mix([38, 255, 148], [64, 190, 255], clamp(y / 420, 0, 1));
      const aurCol2 = mix([150, 70, 255], [255, 84, 190], clamp(x / W, 0, 1));
      c = [
        c[0] + aurCol1[0] * aur1 * 0.50 + aurCol2[0] * aur2 * 0.38,
        c[1] + aurCol1[1] * aur1 * 0.50 + aurCol2[1] * aur2 * 0.38,
        c[2] + aurCol1[2] * aur1 * 0.50 + aurCol2[2] * aur2 * 0.38,
      ];

      // Moon halo: broad warm-white bloom around the moon disc.
      const md = Math.hypot(x - MOON_X, y - MOON_Y);
      const halo = Math.exp(-Math.max(0, md - MOON_R) / 150);
      c = [
        c[0] + 235 * halo * 0.30,
        c[1] + 228 * halo * 0.29,
        c[2] + 200 * halo * 0.25,
      ];

      const idx = (y * W + x) * 3;
      buf[idx] = c[0];
      buf[idx + 1] = c[1];
      buf[idx + 2] = c[2];
    }
  }

  // Moon disc: bright cream, gentle limb shading, soft crater mottling.
  const craters: Array<[number, number, number]> = [
    [-30, -18, 20], [18, 26, 15], [34, -30, 12], [-8, 38, 10], [-44, 22, 9], [8, -44, 8],
  ];
  paint(MOON_X - MOON_R, MOON_Y - MOON_R, MOON_X + MOON_R, MOON_Y + MOON_R,
    discSd(MOON_X, MOON_Y, MOON_R),
    (x, y) => {
      const dx = (x - MOON_X) / MOON_R;
      const dy = (y - MOON_Y) / MOON_R;
      const limb = clamp(1 - (dx * dx + dy * dy) * 0.22, 0.8, 1);
      let shade = 0;
      for (const [cx, cy, cr] of craters) {
        const dd = Math.hypot(x - (MOON_X + cx), y - (MOON_Y + cy));
        shade += Math.exp(-(dd * dd) / (cr * cr)) * 0.10;
      }
      const base = mix([238, 232, 205], [252, 248, 228], clamp(1 - Math.hypot(dx, dy), 0, 1));
      const m = limb * (1 - shade);
      return { c: [base[0] * m, base[1] * m, base[2] * m] as RGB, a: 1 };
    },
    { dist: 60, c: [255, 244, 205], strength: 0.35 });

  // Stars: a dense but fine field — small and dim enough that they read as
  // depth behind the phoenix, never as confetti competing with it.
  for (let i = 0; i < 640; i++) {
    const sx = rng() * W;
    const sy = Math.pow(rng(), 1.5) * H * 0.9;
    const inWay = Math.exp(-Math.pow(((sx * 0.62 + sy) - 560) / 210, 2));
    if (sy > 120 && rng() > 0.3 + inWay * 0.7 && rng() > 0.35) continue;
    const bright = 0.3 + rng() * 0.55;
    const r = rng() < 0.05 ? 2.0 : 0.6 + rng() * 0.8;
    const tint: RGB = rng() < 0.18 ? [178, 205, 255] : rng() < 0.3 ? [255, 232, 190] : [240, 244, 255];
    paint(sx - 3, sy - 3, sx + 3, sy + 3, discSd(sx, sy, r),
      () => ({ c: tint, a: bright }),
      { dist: 7, c: tint, strength: bright * 0.4 });
    if (r > 2.2) {
      for (const [ex, ey] of [[-5, 0], [5, 0], [0, -5], [0, 5]] as Array<[number, number]>) {
        paint(sx + ex - 1, sy + ey - 1, sx + ex + 1, sy + ey + 1, discSd(sx + ex, sy + ey, 1.1),
          () => ({ c: tint, a: bright * 0.5 }), null);
      }
    }
  }
}

// -------------------------------------------------------------- fire palette

const FIRE: Array<[number, RGB]> = [
  [0.0, [255, 246, 205]],
  [0.22, [255, 214, 92]],
  [0.48, [255, 146, 32]],
  [0.74, [244, 74, 12]],
  [1.0, [196, 26, 6]],
];
const FIRE_DEEP: Array<[number, RGB]> = [
  [0.0, [255, 196, 84]],
  [0.4, [250, 110, 22]],
  [0.75, [214, 44, 8]],
  [1.0, [148, 14, 4]],
];

// A single feather, defined by its curved spine. Signed distance is measured
// against the spine's width profile, which swells then tapers to a point —
// cheap, smooth, and layered feathers read as real plumage.
interface Feather {
  ox: number; oy: number;
  dx: number; dy: number;
  px: number; py: number;
  len: number;
  wid: number;
  bend: number;
  palette: Array<[number, RGB]>;
  alpha: number;
}

function featherWidth(f: Feather, t: number): number {
  const swell = Math.pow(Math.sin(Math.PI * clamp(0.10 + 0.90 * t, 0, 1)), 0.72);
  return f.wid * swell * (1 - t * 0.38);
}

function paintFeather(f: Feather): void {
  const spine = (t: number): [number, number] => {
    const bow = f.bend * Math.sin(Math.PI * t * 0.72);
    return [f.ox + f.dx * f.len * t + f.px * bow, f.oy + f.dy * f.len * t + f.py * bow];
  };
  // Distance is measured to the spine SEGMENTS, not to discrete sample
  // points — point sampling makes the vane break into a row of discs.
  const SP = 14;
  const spinePts: Array<[number, number]> = [];
  for (let i = 0; i <= SP; i++) spinePts.push(spine(i / SP));
  const sample = (x: number, y: number): { t: number; d: number; side: number } => {
    let bt = 0;
    let bd = Infinity;
    let bs = 0;
    for (let i = 0; i < SP; i++) {
      const [ax, ay] = spinePts[i];
      const [bx, by] = spinePts[i + 1];
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      let u = len2 > 0 ? ((x - ax) * abx + (y - ay) * aby) / len2 : 0;
      u = clamp(u, 0, 1);
      const qx = ax + abx * u;
      const qy = ay + aby * u;
      const d = Math.hypot(x - qx, y - qy);
      if (d < bd) {
        bd = d;
        bt = (i + u) / SP;
        bs = (x - qx) * f.px + (y - qy) * f.py;
      }
    }
    return { t: bt, d: bd, side: bs };
  };
  const sd: SdFn = (x, y) => {
    const s = sample(x, y);
    return s.d - featherWidth(f, s.t);
  };
  // Tight bounding box from the actual spine extent — a square box around a
  // long diagonal feather would waste a million pixels per feather.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i <= 14; i++) {
    const [sx, sy] = spine(i / 14);
    bx0 = Math.min(bx0, sx); by0 = Math.min(by0, sy);
    bx1 = Math.max(bx1, sx); by1 = Math.max(by1, sy);
  }
  const pad = f.wid + 4;
  paint(bx0 - pad, by0 - pad, bx1 + pad, by1 + pad, sd,
    (x, y) => {
      const s = sample(x, y);
      const t = s.t;
      const w = Math.max(1, featherWidth(f, t));
      const u = clamp(Math.abs(s.side) / w, 0, 1);
      let c = gradient(f.palette, t);
      const shaft = Math.exp(-u * u * 9) * 0.5;
      const rim = smooth(0.62, 1.0, u) * 0.34;
      c = [
        clamp(c[0] + 255 * shaft - c[0] * rim, 0, 300),
        clamp(c[1] + 225 * shaft - c[1] * rim, 0, 300),
        clamp(c[2] + 170 * shaft - c[2] * rim, 0, 300),
      ];
      const barb = 0.97 + 0.03 * Math.sin(t * f.len * 0.23 - u * 2.0);
      return { c: [c[0] * barb, c[1] * barb, c[2] * barb] as RGB, a: f.alpha };
    },
    { dist: 30, c: [255, 110, 18], strength: 0.30 });
}

function makeFeather(
  ox: number, oy: number, angleDeg: number, len: number, wid: number,
  bend: number, palette: Array<[number, RGB]>, alpha: number,
): Feather {
  const a = (angleDeg * Math.PI) / 180;
  return {
    ox, oy,
    dx: Math.cos(a), dy: Math.sin(a),
    px: -Math.sin(a), py: Math.cos(a),
    len, wid, bend, palette, alpha,
  };
}

// ---------------------------------------------------------------- the phoenix
// Wings span the full canvas. Three plumage layers per wing: deep secondaries
// behind, long bright primaries, then pale coverts hugging the shoulder.
// The neck rises in an S toward the moon; five tail ribbons pour downward.

const BODY_X = 502;
const BODY_Y = 478;

function paintPhoenixGlow(): void {
  paint(BODY_X - 470, BODY_Y - 470, BODY_X + 470, BODY_Y + 470,
    discSd(BODY_X, BODY_Y, 60),
    () => ({ c: [255, 150, 40] as RGB, a: 0 }),
    { dist: 430, c: [255, 132, 26], strength: 0.42 });
}

function paintWing(side: 1 | -1): void {
  const shX = BODY_X + side * 42;
  const shY = BODY_Y - 52;
  // Right wing angles are negative (up and to the right); the left wing
  // mirrors them through the vertical axis: angle -> 180 - angle.
  const ang = (a: number): number => (side === 1 ? a : 180 - a);

  // Secondaries — shorter, deeper red, tucked behind the primaries.
  // A deterministic per-feather jitter keeps the fan organic, never machined.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const jit = hash2(i * 7 + (side > 0 ? 3 : 11), 42) - 0.5;
    const a = ang(-78 + t * 58 + jit * 3);
    const len = (235 + Math.sin(t * Math.PI) * 95 - t * 30) * (1 + jit * 0.13);
    paintFeather(makeFeather(shX, shY + 16, a, len, 30 + jit * 5, side * -16, FIRE_DEEP, 0.96));
  }
  // Primaries — the long flight feathers that carry the wingspan.
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const jit = hash2(i * 13 + (side > 0 ? 5 : 23), 77) - 0.5;
    const a = ang(-86 + t * 70 + jit * 2.6);
    const arc = Math.sin(Math.pow(t, 0.8) * Math.PI);
    const len = ((side === 1 ? 296 : 348) + arc * (side === 1 ? 104 : 132) - Math.pow(Math.abs(t - 0.45), 2) * 120) * (1 + jit * 0.11);
    paintFeather(makeFeather(shX, shY + t * 14, a, len, 34 - t * 5 + jit * 5, side * -(10 + t * 22), FIRE, 0.98));
  }
  // Coverts — pale gold scallops layered over the shoulder.
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const a = ang(-80 + t * 62);
    const len = 128 + Math.sin(t * Math.PI) * 52;
    paintFeather(makeFeather(shX - side * 6, shY - 8, a, len, 27, side * -8, FIRE, 1));
  }
}

function paintTail(): void {
  // Behind everything, three broad flame tongues give the tail its fire
  // volume — deep palette, soft alpha, no hard cores.
  const tongues: Array<{ ex: number; ey: number; sway: number }> = [
    { ex: 250, ey: 940, sway: -52 },
    { ex: 420, ey: 968, sway: -6 },
    { ex: 545, ey: 922, sway: 26 },
  ];
  for (const r of tongues) {
    const steps = 90;
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      const cx = lerp(BODY_X - 12, r.ex, t) + Math.sin(t * Math.PI * 1.25) * r.sway * t;
      const cy = lerp(BODY_Y + 66, r.ey, Math.pow(t, 0.92));
      const rad = lerp(27, 6, Math.pow(t, 0.8));
      const c = gradient(FIRE_DEEP, clamp(0.15 + t * 0.8, 0, 1));
      paint(cx - rad - 22, cy - rad - 22, cx + rad + 22, cy + rad + 22,
        discSd(cx, cy, rad),
        () => ({ c, a: 0.55 }),
        { dist: 22, c: [255, 104, 16], strength: 0.22 });
    }
  }
  // On top, seven true tail feathers — the same plumage language as the
  // wings — fanning down and outward with separated, pointed vanes.
  const tailFan: Array<{ ang: number; len: number; bend: number }> = [
    { ang: 122, len: 330, bend: -34 },
    { ang: 110, len: 386, bend: -26 },
    { ang: 99, len: 424, bend: -16 },
    { ang: 90, len: 438, bend: -4 },
    { ang: 80, len: 420, bend: 12 },
    { ang: 69, len: 384, bend: 24 },
    { ang: 58, len: 322, bend: 32 },
  ];
  for (let i = 0; i < tailFan.length; i++) {
    const tf = tailFan[i];
    const ox = BODY_X - 34 + i * 12;
    paintFeather(makeFeather(ox, BODY_Y + 58, tf.ang, tf.len, 33, tf.bend, i % 2 ? FIRE : FIRE_DEEP, 0.97));
  }
}

function paintBodyAndHead(): void {
  // Neck: a tapering S of finely-stepped discs rising toward the moon —
  // many small steps, faint glow, so it reads as one smooth throat.
  const neckPts: Array<[number, number, number]> = [];
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    const x = lerp(BODY_X + 38, 614, t) + Math.sin(t * Math.PI * 0.9) * 20;
    const y = lerp(BODY_Y - 66, 282, Math.pow(t, 0.94));
    neckPts.push([x, y, lerp(47, 23, t)]);
  }
  for (let i = neckPts.length - 1; i >= 0; i--) {
    const [x, y, r] = neckPts[i];
    const t = i / (neckPts.length - 1);
    const c = gradient(FIRE, 0.12 + t * 0.3);
    paint(x - r - 14, y - r - 14, x + r + 14, y + r + 14, discSd(x, y, r),
      () => ({ c, a: 0.97 }), { dist: 14, c: [255, 120, 20], strength: 0.12 });
  }

  // Torso: a tilted form with a hot bright breast.
  paint(BODY_X - 120, BODY_Y - 150, BODY_X + 120, BODY_Y + 160,
    ellipseSd(BODY_X, BODY_Y, 70, 120, -0.30),
    (x, y) => {
      const d = Math.hypot((x - BODY_X) / 70, (y - (BODY_Y - 18)) / 120);
      const c = gradient(FIRE, clamp(d * 0.85, 0, 1));
      return { c, a: 1 };
    },
    { dist: 44, c: [255, 118, 18], strength: 0.4 });
  // scallop rows on the breast and belly — kept faint and small so they
  // read as feather texture woven into the torso, never as spots
  for (let row = 0; row < 6; row++) {
    const ry = BODY_Y - 62 + row * 32;
    const cols = 5 - Math.floor(Math.abs(row - 2.4));
    for (let k = 0; k < cols; k++) {
      const cx = BODY_X - (cols - 1) * 17 + k * 34 + (row % 2) * 8 - 6;
      const c = gradient(FIRE, 0.20 + row * 0.10 + (k % 2) * 0.04);
      paint(cx - 18, ry - 12, cx + 18, ry + 12, ellipseSd(cx, ry, 16, 10, -0.3),
        () => ({ c, a: 0.22 }), null);
    }
  }
  // hip feathers: two clusters fanning down and outward from the torso's
  // flanks, drawn in the deep palette so they break the oval silhouette
  // and stitch the body into the tail plumage below
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = s < 0 ? 138 - i * 14 : 42 + i * 14;
      paintFeather(makeFeather(BODY_X + s * 48, BODY_Y + 12, a, 138 - i * 10, 20, s * -13, FIRE_DEEP, 0.96));
    }
  }
  // hot heart-glow at the breast
  paint(BODY_X - 70, BODY_Y - 110, BODY_X + 70, BODY_Y + 30,
    discSd(BODY_X + 6, BODY_Y - 42, 11),
    () => ({ c: [255, 244, 200] as RGB, a: 0.5 }),
    { dist: 62, c: [255, 196, 80], strength: 0.4 });

  // Head, turned up toward the moon: crest plumes, keen eye, golden beak.
  const HX = 626;
  const HY = 262;
  for (let i = 0; i < 5; i++) {
    const a = 168 + i * 17;
    paintFeather(makeFeather(HX - 8, HY - 14, a, 98 - Math.abs(i - 2) * 11, 11, -16, FIRE, 1));
  }
  paint(HX - 40, HY - 40, HX + 42, HY + 42, discSd(HX, HY, 33),
    (x, y) => {
      const d = Math.hypot(x - HX, y - HY) / 33;
      return { c: gradient(FIRE, 0.16 + d * 0.3), a: 1 };
    },
    { dist: 26, c: [255, 140, 30], strength: 0.35 });
  paint(HX - 16, HY - 6, HX + 22, HY + 26, discSd(HX + 4, HY + 9, 13),
    () => ({ c: [255, 232, 160] as RGB, a: 0.45 }), null);
  // beak: two tapered triangles reaching toward the moonlight
  const beakTop: Array<[number, number]> = [[HX + 16, HY - 12], [HX + 88, HY + 3], [HX + 20, HY + 6]];
  const beakLow: Array<[number, number]> = [[HX + 18, HY + 7], [HX + 74, HY + 9], [HX + 22, HY + 17]];
  paint(HX, HY - 16, HX + 92, HY + 12, polySd(beakTop),
    () => ({ c: [255, 196, 64] as RGB, a: 1 }), null);
  paint(HX, HY + 2, HX + 78, HY + 20, polySd(beakLow),
    () => ({ c: [214, 118, 22] as RGB, a: 1 }), null);
  // eye: dark jewel with a cyan spark — a cool note inside all that fire
  paint(HX + 2, HY - 16, HX + 18, HY + 2, discSd(HX + 10, HY - 7, 5.2),
    () => ({ c: [16, 10, 8] as RGB, a: 1 }), null);
  paint(HX + 4, HY - 14, HX + 13, HY - 5, discSd(HX + 8.4, HY - 9.4, 2.1),
    () => ({ c: [190, 246, 255] as RGB, a: 1 }), { dist: 8, c: [140, 230, 255], strength: 0.7 });
}

// ------------------------------------------------------------- sea and cliff

function paintSea(): void {
  // A calm night sea in the lower band, carrying two trembling reflections:
  // the phoenix's fire column and the moon's silver path.
  for (let y = 838; y < H; y++) {
    const v = (y - 838) / (H - 838);
    for (let x = 0; x < W; x++) {
      let c = mix([10, 22, 44], [5, 10, 24], v);
      const shimmer = fbm(x * 0.05, y * 0.16, 2);
      const fireCol = Math.exp(-Math.pow((x - 500) / 120, 2)) * (0.4 + 0.6 * shimmer);
      const moonCol = Math.exp(-Math.pow((x - 776) / 52, 2)) * (0.35 + 0.65 * fbm(x * 0.07 + 9, y * 0.2, 2));
      const streak = 0.72 + 0.28 * Math.sin(y * 0.55 + shimmer * 14);
      c = [
        c[0] + 255 * fireCol * 0.24 * streak + 226 * moonCol * 0.17 * streak,
        c[1] + 128 * fireCol * 0.24 * streak + 224 * moonCol * 0.17 * streak,
        c[2] + 30 * fireCol * 0.24 * streak + 198 * moonCol * 0.17 * streak,
      ];
      const idx = (y * W + x) * 3;
      blendAt(idx, c, 0.92);
    }
  }
  // low cloud-sea: soft lit banks drifting across the horizon line
  for (let i = 0; i < 26; i++) {
    const cx = rng() * W;
    const cy = 806 + rng() * 74;
    const rx = 60 + rng() * 130;
    const ry = 13 + rng() * 8;
    const warm = rng();
    const col: RGB = warm < 0.5 ? [150, 168, 205] : [196, 150, 110];
    const alpha = 0.10 + rng() * 0.05;
    paint(cx - rx, cy - 24, cx + rx, cy + 24, ellipseSd(cx, cy, rx, ry, 0),
      () => ({ c: col, a: alpha }), null);
  }
}

function paintCliffAndExplorer(): void {
  // Jagged black headland rising from the lower left, rim-lit by phoenix fire.
  const cliff: Array<[number, number]> = [
    [0, 780], [64, 762], [118, 776], [158, 752], [214, 782], [268, 806],
    [318, 852], [352, 918], [372, 1024], [0, 1024],
  ];
  paint(0, 736, 380, 1024, polySd(cliff),
    (x, y) => {
      const n = fbm(x * 0.03, y * 0.03, 2) * 9;
      return { c: [7 + n, 8 + n, 15 + n] as RGB, a: 1 };
    }, null);
  // rim light along the top edge
  for (let i = 0; i < cliff.length - 3; i++) {
    const [ax, ay] = cliff[i];
    const [bx, by] = cliff[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 7);
    for (let s = 0; s <= steps; s++) {
      const x = lerp(ax, bx, s / steps);
      const y = lerp(ay, by, s / steps);
      paint(x - 5, y - 5, x + 5, y + 5, discSd(x, y, 2.2),
        () => ({ c: [255, 148, 52] as RGB, a: 0.5 }), { dist: 7, c: [255, 120, 30], strength: 0.3 });
    }
  }
  // a second, smaller rock at lower right to balance the frame
  const rock: Array<[number, number]> = [
    [836, 1024], [872, 944], [928, 922], [984, 950], [1010, 1024],
  ];
  paint(830, 916, 1016, 1024, polySd(rock),
    (x, y) => {
      const n = fbm(x * 0.03, y * 0.03, 2) * 8;
      return { c: [6 + n, 7 + n, 13 + n] as RGB, a: 1 };
    }, null);

  // The explorer: a speck of a figure on the perch at (158, 752), cloak,
  // staff, and one warm lantern — humanity's tiny answer to the phoenix.
  const EX = 158;
  const EY = 752;
  const cloak: Array<[number, number]> = [
    [EX - 3, EY - 30], [EX + 5, EY - 30], [EX + 10, EY], [EX - 8, EY],
  ];
  paint(EX - 12, EY - 34, EX + 12, EY + 2, polySd(cloak),
    () => ({ c: [3, 3, 6] as RGB, a: 1 }), null);
  paint(EX - 6, EY - 40, EX + 8, EY - 26, discSd(EX + 1, EY - 33, 6.4),
    () => ({ c: [3, 3, 6] as RGB, a: 1 }), null);
  for (let s = 0; s <= 8; s++) {
    const x = EX + 9 + s * 0.4;
    const y = EY - 26 + s * 3.4;
    paint(x - 2, y - 2, x + 2, y + 2, discSd(x, y, 1.5),
      () => ({ c: [2, 2, 4] as RGB, a: 1 }), null);
  }
  // lantern glow first (it lights the rock), then its bright heart
  paint(EX - 44, EY - 44, EX + 48, EY + 30, discSd(EX + 15, EY - 12, 5),
    () => ({ c: [255, 190, 92] as RGB, a: 0.9 }),
    { dist: 40, c: [255, 172, 64], strength: 0.85 });
  paint(EX + 9, EY - 19, EX + 21, EY - 5, discSd(EX + 15, EY - 12, 3.4),
    () => ({ c: [255, 246, 205] as RGB, a: 1 }), null);
}

// ------------------------------------------------------------------- embers

function paintEmbers(): void {
  // Bara beterbangan: hundreds of sparks streaming off the wings and tail,
  // drifting on the dawn wind, a few with short motion streaks.
  for (let i = 0; i < 280; i++) {
    const zone = rng();
    let ex: number;
    let ey: number;
    if (zone < 0.55) {
      ex = 60 + rng() * 900;
      ey = 150 + Math.pow(rng(), 1.4) * 420;
    } else if (zone < 0.85) {
      ex = 180 + rng() * 420;
      ey = 540 + rng() * 400;
    } else {
      ex = rng() * W;
      ey = rng() * H * 0.8;
    }
    const r = 0.7 + Math.pow(rng(), 2.2) * 3.4;
    const heat = rng();
    const c: RGB = heat < 0.3 ? [255, 232, 160] : heat < 0.75 ? [255, 158, 44] : [244, 84, 16];
    const a = 0.35 + rng() * 0.6;
    paint(ex - r - 8, ey - r - 8, ex + r + 8, ey + r + 8, discSd(ex, ey, r),
      () => ({ c, a }), { dist: 9, c, strength: a * 0.5 });
    if (r > 2.6) {
      for (let s = 1; s <= 4; s++) {
        const sx = ex + s * 3.4;
        const sy = ey + s * 2.1;
        paint(sx - 2, sy - 2, sx + 2, sy + 2, discSd(sx, sy, r * (1 - s * 0.18)),
          () => ({ c, a: a * (0.4 - s * 0.07) }), null);
      }
    }
  }
  // distant birds: three tiny silhouettes fleeing the light, upper left
  for (const [bx, by, s] of [[120, 150, 1], [168, 128, 0.7], [84, 188, 0.55]] as Array<[number, number, number]>) {
    for (const dir of [-1, 1]) {
      for (let k = 0; k <= 6; k++) {
        const x = bx + dir * k * 2.6 * s;
        const y = by - Math.sin((k / 6) * Math.PI * 0.6) * 5 * s + k * 0.7 * s;
        paint(x - 2, y - 2, x + 2, y + 2, discSd(x, y, 1.4 * s),
          () => ({ c: [5, 6, 12] as RGB, a: 0.85 }), null);
      }
    }
  }
}

// ------------------------------------------------------------ final grading

function finish(): Uint8Array {
  // Gentle filmic curve, a whisper of saturation, and a vignette that
  // throws every lumen toward the phoenix at the centre of the frame.
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      let r = buf[idx];
      let g = buf[idx + 1];
      let b = buf[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = 1.10;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const vig = 1 - 0.26 * Math.pow(clamp(Math.hypot(dx, dy) / 1.42, 0, 1), 2.4);
      const tone = (v: number): number => {
        const n = clamp(v / 255, 0, 1);
        return clamp(Math.pow(n, 0.94), 0, 1);
      };
      out[idx] = Math.round(clamp(tone(r) * vig, 0, 1) * 255);
      out[idx + 1] = Math.round(clamp(tone(g) * vig, 0, 1) * 255);
      out[idx + 2] = Math.round(clamp(tone(b) * vig, 0, 1) * 255);
    }
  }
  return out;
}

// --------------------------------------------------------------- PNG writer
// Smallest honest encoder: CRC32, IHDR/IDAT/IEND, per-row adaptive filters
// chosen by minimum sum of absolute signed filtered bytes, zlib level 9.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8), 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return out;
}
function encodePng(rgb: Uint8Array): Uint8Array {
  const bpp = 3;
  const stride = W * bpp;
  const raw = new Uint8Array((stride + 1) * H);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < H; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let bestType = 0;
    let bestScore = Infinity;
    let bestRow: Uint8Array | null = null;
    for (let type = 0; type <= 4; type++) {
      const filtered = new Uint8Array(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const cc = i >= bpp ? prev[i - bpp] : 0;
        let pred = 0;
        if (type === 1) pred = a;
        else if (type === 2) pred = b;
        else if (type === 3) pred = (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (row[i] - pred) & 0xff;
        filtered[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        bestRow = filtered;
      }
    }
    const off = y * (stride + 1);
    raw[off] = bestType;
    raw.set(bestRow as Uint8Array, off + 1);
    prev.set(row);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W);
  hv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(idat)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

// --------------------------------------------------------------------- main

paintSky();
paintPhoenixGlow();
paintWing(-1);
paintWing(1);
paintTail();
paintBodyAndHead();
paintSea();
paintCliffAndExplorer();
paintEmbers();

const rgb = finish();
const png = encodePng(rgb);
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), png);
console.log(`entry.png ${png.length} bytes`);
