// The First Dawn — ai-excited-01
//
// A lone explorer with a lantern stands on a cliff at night, dwarfed by a
// colossal fire phoenix rising through the sky beneath green aurora ribbons
// and a full moon. Everything is drawn procedurally, pixel by pixel, by
// this program alone: no image files, no libraries, no network.
//
// Node 22, standard library only. The PNG encoder is hand-rolled (CRC32,
// zlib deflate, per-row filter choice). The picture is fully deterministic:
// one fixed seed drives every star, ember and ridge bump, and nothing reads
// the clock, so two runs write byte-identical files.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";

const W = 1024;
const H = 1024;
const img = new Uint8Array(W * H * 3);

// ---------------------------------------------------------------------------
// Deterministic randomness: one seeded generator for the whole picture.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Colour helpers. Colours are [r, g, b] triples, 0..255.
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function put(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  img[i] = clamp255(c[0]);
  img[i + 1] = clamp255(c[1]);
  img[i + 2] = clamp255(c[2]);
}

function get(x: number, y: number): RGB {
  const i = (y * W + x) * 3;
  return [img[i], img[i + 1], img[i + 2]];
}

// Normal alpha blend of colour c over the pixel, alpha 0..1.
function blend(x: number, y: number, c: RGB, alpha: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || alpha <= 0) return;
  if (alpha > 1) alpha = 1;
  const i = (y * W + x) * 3;
  img[i] = clamp255(img[i] + (c[0] - img[i]) * alpha);
  img[i + 1] = clamp255(img[i + 1] + (c[1] - img[i + 1]) * alpha);
  img[i + 2] = clamp255(img[i + 2] + (c[2] - img[i + 2]) * alpha);
}

// Additive light: colour c added at strength 0..1, clamped at 255.
function addLight(x: number, y: number, c: RGB, strength: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || strength <= 0) return;
  const i = (y * W + x) * 3;
  img[i] = clamp255(img[i] + c[0] * strength);
  img[i + 1] = clamp255(img[i + 1] + c[1] * strength);
  img[i + 2] = clamp255(img[i + 2] + c[2] * strength);
}

// Soft radial glow: colour fades out quadratically to radius r.
function radialGlow(cx: number, cy: number, r: number, c: RGB, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / r;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const f = (1 - d2) * (1 - d2);
      addLight(x, y, c, peak * f);
    }
  }
}

// ---------------------------------------------------------------------------
// Shape rasterisers.
// ---------------------------------------------------------------------------

// Filled ellipse, rotated by angleDeg (degrees, y axis points down).
function fillEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number,
  c: RGB,
  alpha: number,
): void {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rad = Math.max(rx, ry);
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * ca + dy * sa) / rx;
      const v = (-dx * sa + dy * ca) / ry;
      if (u * u + v * v <= 1) blend(x, y, c, alpha);
    }
  }
}

// Filled disc (unrotated ellipse with equal radii).
function fillDisc(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  fillEllipse(cx, cy, r, r, 0, c, alpha);
}

// Scanline-filled polygon; pts is a flat [x0, y0, x1, y1, ...] list.
function fillPoly(pts: number[], c: RGB, alpha: number): void {
  let minY = H - 1;
  let maxY = 0;
  for (let i = 1; i < pts.length; i += 2) {
    if (pts[i] < minY) minY = pts[i];
    if (pts[i] > maxY) maxY = pts[i];
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length / 2;
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let k = 0; k < n; k++) {
      const x1 = pts[k * 2];
      const y1 = pts[k * 2 + 1];
      const x2 = pts[((k + 1) % n) * 2];
      const y2 = pts[((k + 1) % n) * 2 + 1];
      if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const xa = Math.max(0, Math.ceil(xs[s]));
      const xb = Math.min(W - 1, Math.floor(xs[s + 1]));
      for (let x = xa; x <= xb; x++) blend(x, y, c, alpha);
    }
  }
}

// A thick line drawn as a chain of overlapping discs — smooth and simple.
function strokeLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  c: RGB,
  alpha: number,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, w * 0.4)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    fillDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c, alpha);
  }
}

// A tapering ribbon along a quadratic bezier, stamped as shrinking discs.
// Draws an outer colour, then a narrower hotter inner colour on top.
function flameRibbon(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  outer: RGB,
  inner: RGB,
): void {
  // Sample the curve, then draw it as tapering thick segments so the
  // ribbon stays smooth instead of beading into separate discs.
  const steps = 60;
  const px: number[] = [];
  const py: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    px.push(mt * mt * x0 + 2 * mt * t * cx + t * t * x1);
    py.push(mt * mt * y0 + 2 * mt * t * cy + t * t * y1);
  }
  for (let pass = 0; pass < 2; pass++) {
    const col = pass === 0 ? outer : inner;
    const scale = pass === 0 ? 1 : 0.5;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const w = (w0 + (w1 - w0) * t) * scale;
      if (w < 0.8) continue;
      strokeLine(px[s], py[s], px[s + 1], py[s + 1], w, col, 0.95);
    }
  }
}

// ---------------------------------------------------------------------------
// Composition constants.
// ---------------------------------------------------------------------------
const MOON = { x: 822, y: 148, r: 62 };
const PHOENIX = { x: 478, y: 392 }; // body centre
const HEAD = { x: 588, y: 268 };

// The cliff's top edge: a fixed wavy ridge with a raised promontory where
// the explorer stands. The same function places the figure, so the feet
// always land exactly on the rock.
const ridgeJitter: number[] = [];
for (let i = 0; i < 33; i++) ridgeJitter.push(rand() * 12 - 6);

function cliffY(x: number): number {
  let y = 905 + 26 * Math.sin(x * 0.011 + 1.3) + 13 * Math.sin(x * 0.027 + 4.0);
  const gx = (x - 710) / 58;
  y -= 58 * Math.exp(-gx * gx); // promontory
  const jx = Math.max(0, Math.min(32, Math.floor(x / 32)));
  y += ridgeJitter[jx];
  return y;
}

// ---------------------------------------------------------------------------
// 1. Night sky: gradient, aurora ribbons, moon glow, phoenix heart-glow.
// ---------------------------------------------------------------------------
function drawSky(): void {
  const stops: [number, RGB][] = [
    [0.0, hex("#060b24")],
    [0.35, hex("#101d47")],
    [0.6, hex("#1c2c5c")],
    [0.8, hex("#2d3c6d")],
    [1.0, hex("#191430")],
  ];
  const bands = [
    { base: 148, amp: 56, freq: 0.0045, phase: 0.7, width: 46, col: hex("#2fe8a8"), s: 0.5 },
    { base: 212, amp: 72, freq: 0.0038, phase: 2.1, width: 62, col: hex("#37c8e8"), s: 0.42 },
    { base: 92, amp: 40, freq: 0.006, phase: 4.0, width: 34, col: hex("#8a7bff"), s: 0.3 },
  ];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0);
    const base = mix(c0, c1, f);
    for (let x = 0; x < W; x++) {
      let r = base[0];
      let g = base[1];
      let b = base[2];
      // Warm heart-glow around the phoenix.
      const pdx = (x - PHOENIX.x) / 300;
      const pdy = (y - PHOENIX.y) / 300;
      const pd = pdx * pdx + pdy * pdy;
      const pw = 0.62 * Math.exp(-pd * 1.4);
      r += 214 * pw;
      g += 110 * pw;
      b += 34 * pw;
      // Cool halo around the moon.
      const mdx = x - MOON.x;
      const mdy = y - MOON.y;
      const md = Math.sqrt(mdx * mdx + mdy * mdy);
      const mw = 0.5 * Math.exp(-md / 170) + 0.22 * Math.exp(-md / 55);
      r += 246 * mw;
      g += 240 * mw;
      b += 214 * mw;
      // Aurora ribbons: soft sine bands, fading toward the horizon.
      const fade = Math.max(0, 1 - y / 1150);
      for (const band of bands) {
        const centre = band.base + band.amp * Math.sin(x * band.freq + band.phase);
        const d = (y - centre) / band.width;
        const a = band.s * Math.exp(-d * d) * fade;
        r += band.col[0] * a;
        g += band.col[1] * a;
        b += band.col[2] * a;
      }
      const i = (y * W + x) * 3;
      img[i] = clamp255(r);
      img[i + 1] = clamp255(g);
      img[i + 2] = clamp255(b);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Moon disc with craters, then stars.
// ---------------------------------------------------------------------------
function drawMoon(): void {
  // Halo ring just outside the disc, then the bright disc itself.
  radialGlow(MOON.x, MOON.y, MOON.r + 26, hex("#fff6d8"), 0.16);
  const core = hex("#f8f3de");
  const shade = hex("#ddd3ae");
  for (let y = MOON.y - MOON.r; y <= MOON.y + MOON.r; y++) {
    for (let x = MOON.x - MOON.r; x <= MOON.x + MOON.r; x++) {
      const dx = (x - MOON.x) / MOON.r;
      const dy = (y - MOON.y) / MOON.r;
      if (dx * dx + dy * dy > 1) continue;
      // Slightly brighter toward the upper-left, as if lit from there.
      const lit = 1 - 0.12 * (dx * 0.6 + dy * 0.6 + 0.4);
      blend(x, y, mix(core, shade, 0), 1);
      const i = (y * W + x) * 3;
      img[i] = clamp255(img[i] * lit + 12);
      img[i + 1] = clamp255(img[i + 1] * lit + 10);
      img[i + 2] = clamp255(img[i + 2] * lit + 8);
    }
  }
  // Craters: deterministic grey blotches inside the disc.
  const craters: [number, number, number][] = [
    [798, 128, 9], [845, 168, 12], [808, 172, 6], [838, 122, 7], [822, 148, 5],
  ];
  for (const [cx, cy, cr] of craters) {
    fillDisc(cx, cy, cr, hex("#d8cda6"), 0.5);
    fillDisc(cx - 2, cy - 2, cr * 0.6, hex("#e6dcba"), 0.35);
  }
}

function drawStars(): void {
  for (let s = 0; s < 250; s++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * 660);
    const dx = x - MOON.x;
    const dy = y - MOON.y;
    if (dx * dx + dy * dy < (MOON.r + 8) * (MOON.r + 8)) continue;
    const bright = 150 + Math.floor(rand() * 105);
    const tint: RGB =
      rand() < 0.7 ? [bright, bright, Math.min(255, bright + 12)] : [bright, bright - 18, bright - 42];
    const roll = rand();
    if (roll < 0.62) {
      put(x, y, tint);
    } else if (roll < 0.9) {
      fillDisc(x, y, 1.4, tint, 0.95);
    } else {
      // Sparkle: a tiny four-point star.
      put(x, y, tint);
      put(x - 1, y, tint);
      put(x + 1, y, tint);
      put(x, y - 1, tint);
      put(x, y + 1, tint);
      put(x - 3, y, [bright * 0.5, bright * 0.5, bright * 0.5]);
      put(x + 3, y, [bright * 0.5, bright * 0.5, bright * 0.5]);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The phoenix: glow, tail flames, wings, body, head.
// ---------------------------------------------------------------------------
function drawPhoenix(): void {
  // Under-glow first, so the bird looks lit from within.
  radialGlow(PHOENIX.x, PHOENIX.y, 430, hex("#ff7a22"), 0.34);
  radialGlow(PHOENIX.x, PHOENIX.y, 190, hex("#ffc23d"), 0.5);
  radialGlow(HEAD.x, HEAD.y, 130, hex("#ffd76a"), 0.4);

  // Tail flames: five ribbons trailing down-left from the tail base.
  const tailBase: [number, number] = [438, 470];
  const tails: [number, number, number, number, number, number][] = [
    // cx, cy, x1, y1, w0, w1
    [300, 620, 150, 700, 30, 5],
    [330, 700, 250, 790, 34, 5],
    [400, 720, 370, 815, 36, 6],
    [480, 700, 500, 790, 32, 5],
    [540, 640, 610, 700, 28, 4],
  ];
  for (const [cx, cy, x1, y1, w0, w1] of tails) {
    flameRibbon(tailBase[0], tailBase[1], cx, cy, x1, y1, w0, w1, hex("#e8491a"), hex("#ffc23d"));
  }
  // White-hot cores down the two middle ribbons.
  flameRibbon(tailBase[0], tailBase[1], 330, 700, 250, 790, 12, 2, hex("#ffd76a"), hex("#fff3b0"));
  flameRibbon(tailBase[0], tailBase[1], 400, 720, 370, 815, 12, 2, hex("#ffd76a"), hex("#fff3b0"));

  // Wings: two raised fans of feathers. Each feather is one rotated ellipse;
  // outer feathers are deep crimson, inner ones run hot gold.
  const crimson = hex("#b91f1f");
  const ember = hex("#e8491a");
  const flame = hex("#ff7a1f");
  const gold = hex("#ffb62e");
  const pale = hex("#ffd76a");
  const ramp = [crimson, ember, ember, flame, flame, gold, pale];

  const leftAngles = [192, 204, 216, 228, 240, 252, 264];
  const rightAngles = [348, 336, 324, 312, 300, 288, 276];
  const leftRoot: [number, number] = [452, 380];
  const rightRoot: [number, number] = [510, 372];

  function wing(
    root: [number, number],
    angles: number[],
  ): void {
    for (let i = 0; i < angles.length; i++) {
      const ang = angles[i];
      const len = 385 - i * 13;
      const wid = 64 - i * 2;
      const rad = (ang * Math.PI) / 180;
      const cx = root[0] + Math.cos(rad) * len * 0.44;
      const cy = root[1] + Math.sin(rad) * len * 0.44;
      fillEllipse(cx, cy, len / 2, wid / 2, ang, ramp[i], 0.96);
    }
    // Bright edge along the outer half of the outermost feather only,
    // so it sits on the feather instead of crossing the body like a rod.
    const a0 = (angles[0] * Math.PI) / 180;
    strokeLine(
      root[0] + Math.cos(a0) * 200,
      root[1] + Math.sin(a0) * 200,
      root[0] + Math.cos(a0) * 350,
      root[1] + Math.sin(a0) * 350,
      5,
      hex("#ffe9a8"),
      0.7,
    );
  }
  wing(leftRoot, leftAngles);
  wing(rightRoot, rightAngles);

  // Body: layered ellipses, deep red outside, gold heart inside, on a
  // diagonal rising toward the head.
  // Body: a tapered teardrop — wide at the chest, narrow at the tail —
  // so it reads as a bird, not a disc; hot layered core inside it.
  fillPoly(
    [417, 447, 468, 348, 527, 292, 583, 273, 617, 307, 593, 358, 542, 422, 443, 473],
    hex("#c22e12"),
    0.97,
  );
  fillEllipse(PHOENIX.x + 14, PHOENIX.y - 8, 104, 36, -28, hex("#e8491a"), 0.97);
  fillEllipse(PHOENIX.x + 28, PHOENIX.y - 14, 74, 26, -28, hex("#ff7a1f"), 0.97);
  fillEllipse(PHOENIX.x + 42, PHOENIX.y - 18, 44, 17, -28, hex("#ffd76a"), 0.97);
  // Breast highlight where the wing roots meet the body.
  fillEllipse(PHOENIX.x + 52, PHOENIX.y - 22, 24, 12, -28, hex("#fff3b0"), 0.9);

  // Neck and head, reaching up toward the moon — big enough to read
  // against the wing behind it.
  fillEllipse(540, 318, 52, 30, -48, hex("#ff7a1f"), 0.97);
  fillEllipse(HEAD.x, HEAD.y, 58, 40, -40, hex("#ffb62e"), 0.97);
  fillEllipse(HEAD.x + 10, HEAD.y - 7, 32, 22, -40, hex("#ffd76a"), 0.97);
  // Crest flames sweeping back from the crown.
  flameRibbon(HEAD.x - 18, HEAD.y - 18, 548, 208, 520, 184, 18, 4, hex("#e8491a"), hex("#ffd76a"));
  flameRibbon(HEAD.x - 10, HEAD.y - 24, 570, 204, 548, 178, 16, 4, hex("#ff7a1f"), hex("#fff3b0"));
  // Beak, open and pointing at the moon; dark eye with a white glint.
  fillPoly(
    [624, 244, 674, 228, 630, 272],
    hex("#ffdf8a"),
    0.97,
  );
  fillPoly([624, 250, 660, 240, 628, 264], hex("#8a2a08"), 0.97);
  fillDisc(612, 250, 7, hex("#160a04"), 1);
  fillDisc(614, 248, 2.4, hex("#ffffff"), 1);
}

// ---------------------------------------------------------------------------
// 4. Embers drifting up from the bird and the lantern.
// ---------------------------------------------------------------------------
function drawEmbers(): void {
  for (let e = 0; e < 110; e++) {
    let x: number;
    let y: number;
    if (rand() < 0.62) {
      // Around the phoenix.
      x = 150 + rand() * 760;
      y = 80 + rand() * 700;
    } else {
      // Rising from the cliff and the lantern.
      x = 600 + rand() * 220;
      y = 700 + rand() * 200;
    }
    const hot = rand() < 0.5;
    const c: RGB = hot ? hex("#ffd76a") : hex("#ff9a2a");
    const r = 1 + rand() * 1.6;
    fillDisc(x, y, r, c, 0.95);
    if (rand() < 0.35) radialGlow(x, y, 7, c, 0.35);
  }
}

// ---------------------------------------------------------------------------
// 5. The cliff, the explorer, the lantern.
// ---------------------------------------------------------------------------
function drawCliff(): void {
  // Ridge polygon: top edge from cliffY, straight down to the bottom.
  const pts: number[] = [];
  for (let x = 0; x <= W; x += 16) pts.push(x, cliffY(x));
  pts.push(W, H);
  pts.push(0, H);
  fillPoly(pts, hex("#0a0d18"), 1);
  // Warm rim light along the ridge, brighter near the lantern.
  for (let x = 0; x < W; x += 8) {
    const y = cliffY(x);
    const nearLantern = Math.exp(-Math.pow((x - 712) / 90, 2));
    const c = mix(hex("#c65a1e"), hex("#ff8a2a"), nearLantern);
    strokeLine(x, y, x + 8, cliffY(x + 8), 2.5 + nearLantern * 2, c, 0.5 + nearLantern * 0.4);
  }
  // Faint warm wash on the rock face below the lantern.
  radialGlow(716, cliffY(716) + 26, 120, hex("#ff8a2a"), 0.22);
}

function drawExplorer(): void {
  const fx = 710;
  const feetY = cliffY(fx);
  const ink: RGB = hex("#04060d");
  // Lantern light first, so the figure is a silhouette inside its own glow.
  const lx = 736;
  const ly = feetY - 66;
  radialGlow(lx, ly, 118, hex("#ffb347"), 0.75);
  radialGlow(lx, ly + 26, 62, hex("#ff9a2a"), 0.4);
  // Cloak: a flared, hooded shape.
  fillPoly(
    [fx - 8, feetY - 46, fx + 8, feetY - 46, fx + 12, feetY, fx - 12, feetY],
    ink,
    1,
  );
  // Hooded head.
  fillDisc(fx, feetY - 52, 6.5, ink, 1);
  fillPoly([fx - 6, feetY - 54, fx + 6, feetY - 54, fx, feetY - 62], ink, 1);
  // Raised arm reaching for the lantern.
  strokeLine(fx + 6, feetY - 40, lx - 4, ly + 8, 5, ink, 1);
  // The lantern itself: dark frame, bright heart.
  fillPoly([lx - 7, ly - 10, lx + 7, ly - 10, lx + 7, ly + 10, lx - 7, ly + 10], hex("#241503"), 1);
  fillEllipse(lx, ly, 4.5, 7.5, 0, hex("#fff3c0"), 1);
  fillDisc(lx, ly, 2.2, hex("#ffffff"), 1);
  // Handle from the hand up to the lantern cap.
  strokeLine(lx - 4, ly + 8, lx - 2, ly - 10, 2, ink, 1);
  // A small pool of light at the explorer's feet.
  fillEllipse(fx + 8, feetY - 2, 26, 5, 0, hex("#ff9a2a"), 0.28);
}

// ---------------------------------------------------------------------------
// 6. Vignette: gently darken the corners so the eye stays on the bird.
// ---------------------------------------------------------------------------
function vignette(): void {
  for (let y = 0; y < H; y++) {
    const dy = (y - H / 2) / (H / 2);
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const d2 = dx * dx + dy * dy;
      const f = 1 - 0.18 * Math.max(0, Math.min(1, (d2 - 0.4) / 1.2));
      const i = (y * W + x) * 3;
      img[i] = clamp255(img[i] * f);
      img[i + 1] = clamp255(img[i + 1] * f);
      img[i + 2] = clamp255(img[i + 2] * f);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: CRC32, chunk writer, per-row filter choice (None vs Up),
// zlib deflate at level 9. Deterministic for identical input bytes.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc >>> 0, 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc(H * (1 + stride));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const row = img.subarray(y * stride, (y + 1) * stride);
    // Score filter 0 (None) and filter 2 (Up) by sum of absolute values.
    let sumNone = 0;
    let sumUp = 0;
    for (let i = 0; i < stride; i++) {
      const b0 = row[i];
      sumNone += b0 > 127 ? 256 - b0 : b0;
      const d = (row[i] - prev[i]) & 0xff;
      sumUp += d > 127 ? 256 - d : d;
    }
    const off = y * (1 + stride);
    if (sumUp < sumNone) {
      raw[off] = 2;
      for (let i = 0; i < stride; i++) raw[off + 1 + i] = (row[i] - prev[i]) & 0xff;
    } else {
      raw[off] = 0;
      for (let i = 0; i < stride; i++) raw[off + 1 + i] = row[i];
    }
    prev.set(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Main: draw everything, encode, write entry.png.
// ---------------------------------------------------------------------------
function main(): void {
  drawSky();
  drawMoon();
  drawStars();
  drawPhoenix();
  drawEmbers();
  drawCliff();
  drawExplorer();
  vignette();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  const hash = crypto.createHash("sha256").update(png).digest("hex");
  console.log(`wrote ${outPath} ${png.length} bytes sha256=${hash}`);
}

main();
