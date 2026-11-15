// ai-excited-01 — "The First Dawn" (Node 22, standard library only).
//
// A lone explorer with a lantern stands on a cliff edge, dwarfed by a
// colossal phoenix of living fire rising through the aurora. The scale
// shock is the whole idea: one tiny human, one impossible bird, one
// moment of ignition. Everything is drawn procedurally, pixel by pixel,
// from a fixed seed — no network, no copied image, no randomness outside
// the seeded generator, so two runs write byte-identical PNGs.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Output: /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png),
//         1024 x 1024 RGB PNG, well under 1 MiB.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- constants
const W = 1024;
const H = 1024;
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Deterministic generator: mulberry32, fixed seed. The ONLY source of
// pseudo-randomness in the program; nothing else varies between runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ------------------------------------------------------------------- canvas
// RGB buffer, row-major. All drawing goes through the helpers below so
// blending stays consistent across the whole picture.
const px = new Uint8Array(W * H * 3);

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function setRgb(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = clamp255(r);
  px[i + 1] = clamp255(g);
  px[i + 2] = clamp255(b);
}

// Additive glow: light accumulates, never wraps, saturates at white.
function addRgb(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0 || x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = clamp255(px[i] + r * a);
  px[i + 1] = clamp255(px[i + 1] + g * a);
  px[i + 2] = clamp255(px[i + 2] + b * a);
}

// Opaque blend of a colour over the pixel, alpha 0..1.
function blendRgb(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0 || x < 0 || x >= W || y < 0 || y >= H) return;
  if (a >= 1) {
    setRgb(x, y, r, g, b);
    return;
  }
  const i = (y * W + x) * 3;
  px[i] = clamp255(px[i] * (1 - a) + r * a);
  px[i + 1] = clamp255(px[i + 1] * (1 - a) + g * a);
  px[i + 2] = clamp255(px[i + 2] * (1 - a) + b * a);
}

type RGB = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// Soft radial glow stamp: warm light pooled around (cx, cy).
function glow(cx: number, cy: number, radius: number, c: RGB, strength: number): void {
  const r0 = Math.max(0, Math.floor(cx - radius));
  const r1 = Math.min(W - 1, Math.ceil(cx + radius));
  const t0 = Math.max(0, Math.floor(cy - radius));
  const t1 = Math.min(H - 1, Math.ceil(cy + radius));
  for (let y = t0; y <= t1; y++) {
    for (let x = r0; x <= r1; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d >= 1) continue;
      const fall = (1 - d) * (1 - d);
      addRgb(x, y, c[0], c[1], c[2], strength * fall);
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const r0 = Math.max(0, Math.floor(cx - r));
  const r1 = Math.min(W - 1, Math.ceil(cx + r));
  const t0 = Math.max(0, Math.floor(cy - r));
  const t1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = t0; y <= t1; y++) {
    for (let x = r0; x <= r1; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) blendRgb(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Rotated ellipse fill, tested in the ellipse's own frame.
function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, c: RGB, a = 1): void {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const r = Math.max(rx, ry);
  const r0 = Math.max(0, Math.floor(cx - r));
  const r1 = Math.min(W - 1, Math.ceil(cx + r));
  const t0 = Math.max(0, Math.floor(cy - r));
  const t1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = t0; y <= t1; y++) {
    for (let x = r0; x <= r1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      if (u * u + v * v <= 1) blendRgb(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Even-odd scanline polygon fill.
function polygon(points: Array<[number, number]>, c: RGB, a = 1): void {
  let minY = H - 1;
  let maxY = 0;
  for (const [, y] of points) {
    minY = Math.min(minY, Math.floor(y));
    maxY = Math.max(maxY, Math.ceil(y));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  const n = points.length;
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % n];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) blendRgb(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Thick line as a chain of discs — used for feather streaks and plumes.
function thickLine(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB, a = 1): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(lerp(x1, x2, t), lerp(y1, y2, t), w / 2, c, a);
  }
}

// A tapering ribbon along a quadratic bezier, colour graded along it.
// This is how the phoenix's tail plumes and crest feathers are drawn.
function ribbon(
  x1: number, y1: number, cx: number, cy: number, x2: number, y2: number,
  w0: number, w1: number, c0: RGB, c1: RGB, a = 1,
): void {
  const steps = 48;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    const w = lerp(w0, w1, t);
    const c = lerpRgb(c0, c1, t);
    disc(x, y, Math.max(0.6, w / 2), c, a);
  }
}

// ------------------------------------------------------------------- palette
const GOLD: RGB = [255, 196, 64];
const EMBER: RGB = [255, 122, 26];
const CRIMSON: RGB = [214, 38, 64];
const VIOLET: RGB = [122, 62, 190];
const INK: RGB = [12, 10, 28];

// Flame gradient: gold at the heart, through ember and crimson to violet
// at the cooling edge. t = 0 is hottest.
function flame(t: number): RGB {
  if (t < 0.5) return lerpRgb(GOLD, EMBER, t / 0.5);
  if (t < 0.8) return lerpRgb(EMBER, CRIMSON, (t - 0.5) / 0.3);
  return lerpRgb(CRIMSON, VIOLET, (t - 0.8) / 0.2);
}

// ------------------------------------------------------------------- sky
// Deep indigo at the zenith, warming through violet to a teal-gold band
// at the horizon where the phoenix's light catches the air.
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  let c: RGB;
  if (t < 0.45) c = lerpRgb([8, 10, 38], [34, 22, 78], smooth(t / 0.45));
  else if (t < 0.72) c = lerpRgb([34, 22, 78], [72, 44, 110], smooth((t - 0.45) / 0.27));
  else c = lerpRgb([72, 44, 110], [16, 74, 96], smooth((t - 0.72) / 0.28));
  for (let x = 0; x < W; x++) setRgb(x, y, c[0], c[1], c[2]);
}

// Stars: sparse, seeded, kept out of the moon's disc and the phoenix.
for (let i = 0; i < 420; i++) {
  const x = rand() * W;
  const y = rand() * 620;
  if (Math.hypot(x - 838, y - 148) < 90) continue;
  if (x > 380 && x < 880 && y > 90 && y < 560) continue;
  const b = 120 + rand() * 135;
  const r = rand();
  disc(x, y, r < 0.12 ? 1.6 : 0.9, [b, b, Math.min(255, b + 20)], 0.55 + rand() * 0.45);
}

// Moon and its halo, high right — the cold light against the fire.
glow(838, 148, 150, [150, 170, 255], 0.16);
glow(838, 148, 70, [210, 220, 255], 0.35);
disc(838, 148, 46, [238, 242, 255]);
disc(824, 136, 10, [214, 222, 248], 0.8);
disc(852, 162, 7, [214, 222, 248], 0.8);
disc(846, 132, 5, [222, 228, 250], 0.8);

// Aurora: three slow ribbons, additive, strongest at their crests.
function aurora(baseY: number, amp: number, freq: number, phase: number, c: RGB, peak: number): void {
  for (let x = 0; x < W; x++) {
    const cy = baseY + amp * Math.sin(x * freq + phase) + 26 * Math.sin(x * 0.011 + phase * 2.3);
    for (let dy = -110; dy <= 110; dy++) {
      const y = Math.round(cy + dy);
      if (y < 0 || y >= H) continue;
      const fall = Math.max(0, 1 - Math.abs(dy) / 110);
      addRgb(x, y, c[0], c[1], c[2], peak * fall * fall);
    }
  }
}
aurora(150, 42, 0.0042, 0.6, [64, 255, 196], 0.38);
aurora(215, 55, 0.0031, 2.1, [56, 224, 255], 0.26);
aurora(265, 36, 0.0052, 4.0, [168, 110, 255], 0.20);

// ---------------------------------------------------------------- mountains
// Ridge lines are fixed sums of sines — same mountains every run.
function ridgeY(x: number, base: number, amps: number[], freqs: number[], phases: number[]): number {
  let y = base;
  for (let i = 0; i < amps.length; i++) y += amps[i] * Math.sin(x * freqs[i] + phases[i]);
  return y;
}

function ridge(base: number, amps: number[], freqs: number[], phases: number[], c: RGB, rim: RGB | null): void {
  for (let x = 0; x < W; x++) {
    const yTop = ridgeY(x, base, amps, freqs, phases);
    for (let y = Math.max(0, Math.floor(yTop)); y < H; y++) setRgb(x, y, c[0], c[1], c[2]);
    if (rim) {
      // A lit rim along the crest catches the phoenix light.
      for (let dy = 0; dy < 3; dy++) {
        const y = Math.floor(yTop) + dy;
        if (y >= 0 && y < H) blendRgb(x, y, rim[0], rim[1], rim[2], 0.55 - dy * 0.18);
      }
    }
  }
}

// Far range, hazy violet; mid range, darker, its crest warmed by fire.
ridge(742, [46, 26, 12], [0.006, 0.013, 0.031], [0.4, 2.2, 5.1], [44, 36, 84], null);
ridge(828, [58, 34, 15], [0.005, 0.011, 0.027], [1.9, 0.7, 3.8], [26, 22, 58], [255, 150, 60]);

// The phoenix's own light pooled low over the valley.
glow(620, 660, 330, [255, 120, 40], 0.10);

// ------------------------------------------------------------------ phoenix
// The bird flies left-to-right across the upper half: body centre
// (560, 390), head at the left end turned down toward the explorer,
// one great wing raised, tail streaming right. It is drawn
// back-to-front: far wing, tail plumes, body, near wing, head.

// Far wing — rising up-right BEHIND the body, slightly dimmer. The bird
// now flies horizontally (head left, tail right): the diagonal layout
// read as a rocket, wings as fins. This wing is the far one, so it stays
// behind the body and the near wing.
polygon(
  [[600, 360], [670, 268], [748, 196], [798, 172], [748, 250], [690, 306], [640, 352], [620, 384]],
  [176, 44, 62],
);
polygon(
  [[600, 360], [664, 282], [728, 214], [768, 188], [726, 254], [676, 304], [632, 348], [616, 378]],
  [228, 84, 40],
);
for (let i = 0; i < 6; i++) {
  const t = i / 5;
  thickLine(
    lerp(600, 620, t), lerp(360, 384, t),
    lerp(728, 798, t), lerp(214, 172, t),
    5, flame(0.25 + t * 0.45), 0.85,
  );
}
thickLine(600, 360, 798, 172, 6, GOLD, 0.85);

// Tail plumes — five ribbons of fire streaming RIGHT from the rear of
// the body, fanning apart on curved paths, cooling from gold to violet
// at their tips. The bird flies left-to-right, so the tail trails to
// the right edge of the frame.
const tailBase: Array<[number, number, number, number, number, number]> = [
  [662, 384, 790, 400, 940, 470, 34],
  [668, 396, 800, 440, 960, 520, 42],
  [672, 406, 810, 470, 920, 560, 38],
  [656, 376, 770, 370, 990, 440, 26],
  [674, 414, 820, 500, 880, 600, 30],
];
for (const [x1, y1, cx, cy, x2, y2, w] of tailBase) {
  ribbon(x1, y1, cx, cy, x2, y2, w, 3, GOLD, VIOLET, 0.95);
  ribbon(x1, y1, cx, cy, x2, y2, w * 0.35, 2, [255, 232, 150], EMBER, 0.9);
}
// Halo of heat shimmering around the tail roots.
glow(800, 480, 200, [255, 110, 30], 0.12);

// Body — a hot core, brightest at the chest, cooling toward the edges.
// Horizontal now, centred (560, 390), head end left, tail end right.
ellipse(560, 390, 105, 50, -0.08, CRIMSON);
ellipse(560, 390, 86, 40, -0.08, EMBER);
ellipse(530, 382, 60, 29, -0.08, GOLD);
ellipse(512, 376, 34, 19, -0.08, [255, 232, 150]);
// Breast feathers: short gold arcs fanning from the chest.
for (let i = 0; i < 7; i++) {
  const t = i / 6;
  thickLine(
    lerp(520, 576, t), lerp(360, 410, t),
    lerp(480, 556, t), lerp(384, 424, t),
    4, flame(0.15 + t * 0.4), 0.8,
  );
}

// Near wing — the great raised wing, gold-edged, fire-veined. It rises
// straight UP from the shoulder to a tip high above the body, its
// trailing edge scalloped into feather tips. With the bird horizontal,
// this is the wing the eye reads first.
polygon(
  [[545, 365], [505, 250], [470, 140], [495, 105], [545, 190], [530, 215], [575, 280], [560, 300], [610, 350], [585, 385]],
  [198, 52, 58],
);
polygon(
  [[545, 365], [512, 262], [482, 162], [500, 128], [536, 198], [524, 218], [562, 276], [552, 294], [592, 342], [580, 376]],
  [240, 96, 36],
);
polygon(
  [[545, 365], [520, 274], [494, 184], [506, 150], [528, 206], [518, 222], [550, 272], [542, 288], [574, 334], [572, 366]],
  [255, 150, 40],
);
// Primary feathers: streaks FANNING from the shoulder to each feather tip,
// with a dark gap line between neighbouring feathers for separation.
const wingTips: Array<[number, number]> = [[530, 215], [560, 300], [545, 190], [575, 280], [610, 350]];
for (let i = 0; i < wingTips.length; i++) {
  const [tx, ty] = wingTips[i];
  thickLine(545, 365, tx, ty, 5, flame(0.1 + (i / wingTips.length) * 0.5), 0.9);
  thickLine(552, 370, tx + 12, ty + 8, 3, [140, 30, 44], 0.7);
}
// Gold leading edge, the line the eye follows first.
thickLine(545, 365, 495, 105, 7, GOLD, 0.95);
thickLine(545, 365, 495, 105, 3, [255, 240, 180], 0.9);

// Crest plumes from the head, streaming back up-right into the wind.
ribbon(440, 332, 510, 262, 596, 214, 16, 2, GOLD, CRIMSON, 0.95);
ribbon(446, 344, 520, 286, 620, 244, 13, 2, EMBER, VIOLET, 0.9);
ribbon(434, 322, 496, 244, 570, 186, 11, 2, GOLD, EMBER, 0.9);

// Neck and head — at the LEFT end of the body now, beak open and
// pointing left-down toward the explorer below.
ribbon(508, 372, 470, 358, 444, 350, 34, 26, EMBER, GOLD, 1);
disc(428, 348, 36, EMBER);
disc(422, 342, 26, GOLD);
disc(420, 338, 13, [255, 236, 160]);
// Beak, open and clearly hooked: upper and lower mandibles in dark horn
// with a gold edge. Slightly longer now so the head reads at 300 px.
polygon([[400, 336], [348, 350], [398, 356], [408, 346]], [52, 26, 18]);
polygon([[402, 356], [356, 372], [404, 368], [412, 358]], [52, 26, 18]);
thickLine(400, 336, 348, 350, 3, GOLD, 0.9);
// The eye: small, fierce, a white-hot core with a gold ring — the focal
// point of the whole image.
disc(424, 342, 5.5, GOLD);
disc(424, 342, 3, [255, 250, 230]);
disc(424, 342, 1.5, [255, 255, 255]);
glow(424, 342, 36, [255, 190, 80], 0.5);

// Full-body fire halo so the bird lifts off the sky.
glow(560, 360, 300, [255, 130, 40], 0.10);
glow(560, 390, 180, [255, 160, 60], 0.12);

// Embers: sparks torn from the wings and tail, drifting up and out.
for (let i = 0; i < 150; i++) {
  const x = 350 + rand() * 620;
  const y = 100 + rand() * 580;
  const s = rand();
  const c = flame(0.1 + s * 0.6);
  const r = 0.8 + rand() * 2.2;
  disc(x, y, r, c, 0.9);
  if (r > 2) glow(x, y, r * 4, c, 0.35);
}

// ------------------------------------------------- foreground cliff + human
// Near-black cliff the explorer stands on, bottom-left, its edge catching
// a thin line of phoenix light.
// The cliff is lower and narrower now: the first version's black mass
// ate a quarter of the frame. The explorer is ~30% bigger with a
// brighter lantern, so the scale story still reads at 300 px wide.
polygon(
  [[0, 1024], [0, 922], [120, 900], [236, 880], [330, 868], [380, 888], [410, 1024]],
  [10, 9, 26],
);
thickLine(0, 922, 120, 900, 3, [255, 150, 60], 0.5);
thickLine(120, 900, 236, 880, 3, [255, 150, 60], 0.55);
thickLine(236, 880, 330, 868, 3, [255, 170, 70], 0.6);

// The explorer: ~29 pixels tall, back to the viewer, looking up at the
// phoenix. Hood, cloak, boots — a silhouette with a lantern.
const HX = 296;
const HY = 868; // feet
disc(HX, HY - 25, 4.2, INK); // hood
polygon([[HX - 5, HY - 21], [HX + 5, HY - 21], [HX + 6, HY - 3], [HX - 6, HY - 3]], INK); // cloak
thickLine(HX - 2, HY - 3, HX - 5, HY, 3, INK); // legs
thickLine(HX + 2, HY - 3, HX + 5, HY, 3, INK);
// Raised arm holding the lantern out toward the bird.
thickLine(HX + 4, HY - 17, HX + 16, HY - 22, 2.8, INK);
disc(HX + 19, HY - 22, 4.4, [255, 196, 90]); // lantern glass
glow(HX + 19, HY - 22, 34, [255, 180, 70], 0.6);
glow(HX + 19, HY - 22, 13, [255, 210, 120], 0.75);

// A few last embers drifting low near the cliff, tying bird to human.
for (let i = 0; i < 26; i++) {
  const x = 180 + rand() * 420;
  const y = 700 + rand() * 160;
  disc(x, y, 1 + rand() * 1.6, flame(rand() * 0.5), 0.85);
}

// ------------------------------------------------------------------ vignette
// Gentle darkening at the corners so the eye stays on the bird.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0.85) {
      const f = 1 - (d - 0.85) * 0.55;
      const i = (y * W + x) * 3;
      px[i] = clamp255(px[i] * f);
      px[i + 1] = clamp255(px[i + 1] * f);
      px[i + 2] = clamp255(px[i + 2] * f);
    }
  }
}

// ---------------------------------------------------------------- PNG encode
// Minimal PNG writer: 8-bit RGB, filter 0, zlib level 9. Deterministic —
// the same pixels always produce the same bytes.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter: none
  // Uint8Array has no .copy (that is a Buffer method): use .set instead.
  raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'entry.png'), png);
