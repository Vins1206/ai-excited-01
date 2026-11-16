// The First Dawn — a colossal phoenix greets the full moon.
// Node 22, pure standard library. Deterministic 1024x1024 PNG.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024, H = 1024, N = W * H;
const buf = new Float32Array(N * 3);

// deterministic PRNG
let seed = 987654321;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function setPx(x: number, y: number, r: number, g: number, b: number, a: number, add = false) {
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 3;
  if (add) { buf[i] += r * a; buf[i + 1] += g * a; buf[i + 2] += b * a; }
  else { buf[i] += (r - buf[i]) * a; buf[i + 1] += (g - buf[i + 1]) * a; buf[i + 2] += (b - buf[i + 2]) * a; }
}
function glow(x: number, y: number, rad: number, r: number, g: number, b: number, peak: number) {
  const x0 = Math.max(0, (x - rad) | 0), x1 = Math.min(W - 1, (x + rad) | 0);
  const y0 = Math.max(0, (y - rad) | 0), y1 = Math.min(H - 1, (y + rad) | 0);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const d = Math.hypot(xx - x, yy - y) / rad;
    if (d >= 1) continue;
    const f = peak * (1 - d) * (1 - d);
    const i = (yy * W + xx) * 3;
    buf[i] += r * f; buf[i + 1] += g * f; buf[i + 2] += b * f;
  }
}
function disc(cx: number, cy: number, rad: number, r: number, g: number, b: number, a = 1) {
  const x0 = Math.max(0, (cx - rad) | 0), x1 = Math.min(W - 1, (cx + rad) | 0);
  const y0 = Math.max(0, (cy - rad) | 0), y1 = Math.min(H - 1, (cy + rad) | 0);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const d = Math.hypot(xx - cx, yy - cy);
    if (d > rad) continue;
    const edge = Math.min(1, (rad - d) / 2 + 0.5);
    setPx(xx, yy, r, g, b, a * edge);
  }
}
// capsule segment with round caps
function seg(x1: number, y1: number, x2: number, y2: number, wdt: number, r: number, g: number, b: number, a: number, add = false) {
  const minx = Math.max(0, Math.floor(Math.min(x1, x2) - wdt - 1)), maxx = Math.min(W - 1, Math.ceil(Math.max(x1, x2) + wdt + 1));
  const miny = Math.max(0, Math.floor(Math.min(y1, y2) - wdt - 1)), maxy = Math.min(H - 1, Math.ceil(Math.max(y1, y2) + wdt + 1));
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
  for (let yy = miny; yy <= maxy; yy++) for (let xx = minx; xx <= maxx; xx++) {
    let t = ((xx - x1) * dx + (yy - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(xx - (x1 + dx * t), yy - (y1 + dy * t));
    if (d > wdt) continue;
    const f = Math.min(1, (wdt - d) / 1.5 + 0.4);
    setPx(xx, yy, r, g, b, a * f, add);
  }
}
function poly(pts: number[][], r: number, g: number, b: number, a: number) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const [x, y] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  minx = Math.max(0, minx | 0); maxx = Math.min(W - 1, Math.ceil(maxx)); miny = Math.max(0, miny | 0); maxy = Math.min(H - 1, Math.ceil(maxy));
  for (let yy = miny; yy <= maxy; yy++) for (let xx = minx; xx <= maxx; xx++) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > yy) !== (yj > yy) && xx < ((xj - xi) * (yy - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) setPx(xx, yy, r, g, b, a);
  }
}
// flame colour ramp: t=0 white-hot -> 1 deep red
function flame(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.25) { const k = t / 0.25; return [1, 0.98 - 0.08 * k, 0.92 - 0.42 * k]; }
  if (t < 0.55) { const k = (t - 0.25) / 0.3; return [1, 0.9 - 0.35 * k, 0.5 - 0.38 * k]; }
  if (t < 0.8) { const k = (t - 0.55) / 0.25; return [1 - 0.08 * k, 0.55 - 0.27 * k, 0.12 - 0.07 * k]; }
  const k = (t - 0.8) / 0.2; return [0.92 - 0.3 * k, 0.28 - 0.16 * k, 0.05 - 0.02 * k];
}

// ---------- sky ----------
for (let y = 0; y < H; y++) {
  const t = y / H;
  let r: number, g: number, b: number;
  if (t < 0.55) { const k = t / 0.55; r = 0.012 + 0.03 * k; g = 0.02 + 0.045 * k; b = 0.07 + 0.1 * k; }
  else if (t < 0.82) { const k = (t - 0.55) / 0.27; r = 0.042 + 0.16 * k; g = 0.065 + 0.05 * k; b = 0.17 - 0.05 * k; }
  else { const k = (t - 0.82) / 0.18; r = 0.2 - 0.13 * k; g = 0.115 - 0.06 * k; b = 0.12 - 0.03 * k; }
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; }
}
// dawn glow on horizon centre
glow(512, 900, 620, 0.55, 0.22, 0.05, 0.35);
glow(512, 860, 320, 1, 0.5, 0.12, 0.3);

// ---------- stars ----------
for (let s = 0; s < 900; s++) {
  const x = rnd() * W, y = Math.pow(rnd(), 1.4) * 760;
  const br = 0.35 + rnd() * 0.65, sz = rnd() < 0.06 ? 2.2 : 1.1;
  disc(x, y, sz, br, br, br * (0.9 + rnd() * 0.1), 0.9);
  if (sz > 2) { seg(x - 6, y, x + 6, y, 0.6, br, br, br, 0.35, true); seg(x, y - 6, x, y + 6, 0.6, br, br, br, 0.35, true); }
}

// ---------- aurora: vivid green-to-violet curtains with vertical rays ----------
for (let band = 0; band < 3; band++) {
  const baseY = 46 + band * 84, amp = 36 + band * 15, thick = 96 - band * 16;
  const ph = band * 2.1, fr = 0.004 + band * 0.0013;
  for (let x = 0; x < W; x += 2) {
    const cy = baseY + Math.sin(x * fr + ph) * amp + Math.sin(x * 0.013 + ph * 3) * 10;
    const ray = 0.72 + 0.28 * Math.sin(x * 0.11 + band * 1.7) * Math.sin(x * 0.031 + ph);
    for (let k = 0; k < thick; k += 1) {
      const tt = k / thick, yy = cy + k;
      const fade = Math.sin(Math.PI * Math.min(1, tt * 1.08));
      const edge = Math.sin(Math.PI * Math.min(1, x / W * 1.12)) * 0.75 + 0.35;
      const a = 0.15 * fade * edge * ray;
      // emerald core low, teal middle, violet crown
      let r = 0.08 + 0.62 * tt * tt, g = 1.0 - 0.42 * tt, b = 0.42 + 0.62 * tt;
      if (band === 1) { g *= 0.92; b += 0.12; }
      if (band === 2) { r += 0.3; b += 0.25; g *= 0.8; }
      for (let dx = 0; dx < 2; dx++) setPx(x + dx, yy, r, g, b, a, true);
    }
    // bright lower rim of the curtain
    setPx(x, cy + 2, 0.35, 1, 0.6, 0.3 * ray, true);
    setPx(x + 1, cy + 3, 0.35, 1, 0.6, 0.24 * ray, true);
  }
}

// ---------- moon ----------
const MX = 806, MY = 196, MR = 108;
glow(MX, MY, 300, 0.75, 0.8, 0.95, 0.34);
glow(MX, MY, 170, 0.9, 0.92, 1, 0.4);
disc(MX, MY, MR + 7, 0.98, 0.99, 1, 0.95);
disc(MX, MY, MR, 0.93, 0.95, 0.99, 1);
const craters: [number, number, number][] = [[-34, -20, 17], [22, 30, 13], [40, -38, 10], [-8, 52, 9], [-52, 34, 8], [12, -6, 7], [58, 8, 6]];
for (const [ox, oy, cr] of craters) disc(MX + ox, MY + oy, cr, 0.78, 0.82, 0.9, 0.5);
disc(MX - 30, MY - 52, 26, 0.97, 0.98, 1, 0.35);

// ---------- phoenix ----------
glow(470, 470, 560, 1, 0.42, 0.08, 0.34);
glow(470, 480, 300, 1, 0.55, 0.14, 0.3);

function feather(bx: number, by: number, ang: number, len: number, wid: number, t0: number, bright: number) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const px = -dy, py = dx;
  const steps = Math.max(8, (len / 6) | 0);
  for (let sIdx = 0; sIdx < steps; sIdx++) {
    const t = sIdx / steps, tn = (sIdx + 1) / steps;
    const wHere = wid * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (1 - t * 0.55);
    const cx = bx + dx * len * t, cy = by + dy * len * t + Math.sin(t * 2.2) * len * 0.03;
    const [r, g, b] = flame(t0 + t * (1 - t0));
    const quad = [
      [cx + px * wHere, cy + py * wHere],
      [bx + dx * len * tn + px * wHere * 0.7, by + dy * len * tn + Math.sin(tn * 2.2) * len * 0.03 + py * wHere * 0.7],
      [bx + dx * len * tn - px * wHere * 0.7, by + dy * len * tn + Math.sin(tn * 2.2) * len * 0.03 - py * wHere * 0.7],
      [cx - px * wHere, cy - py * wHere],
    ];
    poly(quad, r * bright, g * bright, b * bright, 0.92);
  }
  seg(bx, by, bx + dx * len * 0.92, by + dy * len * 0.92, Math.max(1.2, wid * 0.14), 1, 0.9, 0.6, 0.35, true);
}

function wing(side: 1 | -1) {
  const bx = 470 + side * 26, by = 452;
  const layers = [
    { n: 11, len: 560, wid: 34, spread: 0.62, base: -0.42, t0: 0.3 },
    { n: 13, len: 480, wid: 27, spread: 0.7, base: -0.3, t0: 0.16 },
    { n: 15, len: 385, wid: 21, spread: 0.78, base: -0.16, t0: 0.04 },
  ];
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    for (let i = 0; i < L.n; i++) {
      const f = L.n === 1 ? 0.5 : i / (L.n - 1);
      let ang = L.base + (f - 0.5) * 2 * L.spread * 0.9 + f * 0.55;
      if (side === -1) ang = Math.PI - ang;
      const lenJ = L.len * (0.82 + 0.3 * Math.sin(f * Math.PI) + rnd() * 0.05);
      feather(bx + side * li * 14, by - li * 16 + f * 26, ang, lenJ, L.wid, L.t0, 0.92 + li * 0.07);
    }
  }
  for (let i = 0; i < 16; i++) {
    const f = i / 15;
    let ang = -0.5 + f * 1.15;
    if (side === -1) ang = Math.PI - ang;
    feather(bx, by - 6, ang, 130 + Math.sin(f * Math.PI) * 60, 17, 0.02, 1.05);
  }
}
wing(-1); wing(1);

// tail: long flowing flame ribbons fanning downward
for (let i = 0; i < 9; i++) {
  const f = i / 8, ang = Math.PI / 2 + (f - 0.5) * 0.85;
  feather(470 + (f - 0.5) * 60, 560, ang, 330 + Math.sin(f * Math.PI) * 90, 27 - Math.abs(f - 0.5) * 10, 0.22, 0.95);
}
for (let i = 0; i < 5; i++) {
  const f = i / 4, ang = Math.PI / 2 + (f - 0.5) * 0.5;
  feather(470 + (f - 0.5) * 36, 548, ang, 215, 19, 0.05, 1.05);
}

// body: layered breast feathers over a hot core
glow(470, 500, 130, 1, 0.6, 0.2, 0.55);
for (let row = 0; row < 7; row++) {
  const n = 5 - Math.min(2, row >> 1);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const bx = 470 + (f - 0.5) * (104 - row * 9);
    const by = 428 + row * 26;
    feather(bx, by, Math.PI / 2 + (f - 0.5) * 0.5, 74 - row * 3, 19, 0.03 + row * 0.05, 1.08);
  }
}
for (let i = 0; i < 6; i++) {
  const t = i / 5;
  feather(492 + t * 52, 442 - t * 58, -Math.PI / 2 + 0.5 + t * 0.2, 56, 15, 0.02, 1.08);
}
// head turned to the moon: profile facing right/up
const HX = 566, HY = 356;
glow(HX, HY, 74, 1, 0.62, 0.2, 0.5);
disc(HX, HY, 33, 1, 0.83, 0.42, 1);
disc(HX + 6, HY - 7, 24, 1, 0.93, 0.6, 0.9);
for (let i = 0; i < 6; i++) {
  feather(HX - 12 - i * 3, HY - 22 + i * 3, Math.PI + 0.55 - i * 0.16, 120 - i * 9, 10, 0.1 + i * 0.09, 1.05);
}
poly([[HX + 22, HY - 12], [HX + 66, HY + 1], [HX + 20, HY + 9]], 1, 0.78, 0.3, 1);
poly([[HX + 22, HY + 4], [HX + 52, HY + 12], [HX + 18, HY + 14]], 0.95, 0.6, 0.2, 1);
disc(HX + 13, HY - 6, 5.5, 0.08, 0.03, 0.02, 1);
disc(HX + 15, HY - 8, 1.8, 1, 0.95, 0.8, 1);

// ember particles
for (let i = 0; i < 700; i++) {
  const x = rnd() * W, y = 240 + rnd() * 640;
  const dBird = Math.hypot(x - 470, y - 480);
  const near = Math.max(0, 1 - dBird / 560);
  const [r, g, b] = flame(0.15 + rnd() * 0.7);
  const a = 0.25 + near * 0.65;
  disc(x, y, 0.8 + rnd() * 2.4, r, g, b, a);
  if (rnd() < 0.3) glow(x, y, 9 + rnd() * 14, r, g, b, 0.12 * a);
}

// ---------- sea strip ----------
for (let y = 896; y < H; y++) {
  const t = (y - 896) / 128;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    buf[i] = 0.015 + 0.02 * (1 - t); buf[i + 1] = 0.035 + 0.02 * (1 - t); buf[i + 2] = 0.08 + 0.03 * (1 - t);
  }
}
for (let sIdx = 0; sIdx < 340; sIdx++) {
  const moonSide = rnd() < 0.4;
  const cx = moonSide ? MX + (rnd() - 0.5) * 190 : 470 + (rnd() - 0.5) * 620;
  const y = 902 + Math.pow(rnd(), 1.3) * 112;
  const len = 8 + rnd() * (moonSide ? 42 : 60);
  const [r, g, b] = moonSide ? [0.75, 0.82, 0.95] as const : flame(0.2 + rnd() * 0.55);
  seg(cx - len / 2, y, cx + len / 2, y, 1 + rnd() * 1.3, r, g, b, 0.16 + rnd() * 0.22, true);
}

// ---------- cliffs + tiny explorer ----------
poly([[0, 1024], [0, 872], [90, 852], [190, 866], [262, 900], [300, 1024]], 0.012, 0.014, 0.03, 1);
poly([[1024, 1024], [1024, 884], [946, 862], [862, 878], [800, 912], [772, 1024]], 0.012, 0.014, 0.03, 1);
const EX = 128, EY = 838;
glow(EX + 13, EY + 16, 42, 1, 0.72, 0.3, 0.5);
seg(EX, EY + 10, EX, EY + 30, 3.4, 0.005, 0.005, 0.01, 1);
disc(EX, EY + 4, 4.6, 0.005, 0.005, 0.01, 1);
seg(EX + 1, EY + 13, EX + 12, EY + 16, 2.2, 0.005, 0.005, 0.01, 1);
disc(EX + 14, EY + 17, 3.2, 1, 0.8, 0.42, 1);
seg(EX + 12, EY + 10, EX + 14, EY + 14, 1, 0.01, 0.01, 0.015, 1);
const FX = 906, FY = 852;
seg(FX, FY + 8, FX, FY + 22, 2.6, 0.005, 0.005, 0.01, 1);
disc(FX, FY + 3, 3.6, 0.005, 0.005, 0.01, 1);

// ---------- finish ----------
const out = new Uint8Array(N * 4);
for (let p = 0; p < N; p++) {
  const x = p % W, y = (p / W) | 0;
  const vx = (x - 512) / 512, vy = (y - 512) / 512;
  const vig = 1 - 0.26 * Math.min(1, (vx * vx + vy * vy) * 0.72);
  for (let c = 0; c < 3; c++) {
    let v = buf[p * 3 + c] * vig;
    v = v / (1 + v * 0.32);
    out[p * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  out[p * 4 + 3] = 255;
}

// ---------- PNG encode ----------
const crcTable = new Int32Array(256);
for (let nI = 0; nI < 256; nI++) { let c = nI; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[nI] = c; }
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(out.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
try { mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }
const dest = join(outDir, "entry.png");
writeFileSync(dest, png);
console.log(`wrote ${dest} ${png.length} bytes`);
