#!/usr/bin/env node
/**
 * Generate realistic everyday eyewear GLBs (wayfarer, browline, round metal,
 * aviator, office rectangle, bold square, panto, cat-eye, hexagon, slim
 * metal) with EXACT optical dimensions (A × B, DBL, temple length).
 *
 * Unlike scripts/generate-param-frames.mjs (flat measurement rigs), these are
 * built like real frames: swept rims with a rounded cross-section and a lens
 * groove, lenses on a 4-base spherical curve, ~6 mm face-form wrap, end
 * pieces, hinge barrels, rivets, tapered temples with an ear bend, acetate
 * saddle pads or metal pad arms with clear pads, and a procedural tortoise
 * texture. They are styles, not branded products.
 *
 * Material roles: "Frame" (variant-tinted), "Lens", "NosePad" (clear),
 * "Metal"/"Tip" (extras.keepAuthored → the viewer keeps the authored finish).
 *
 * Usage: node scripts/generate-real-frames.mjs
 *   → public/models/real/*.glb, src/data/realFrames.generated.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------- vector helpers ---------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));

// ---------- mesh -------------------------------------------------------------
class Mesh {
  constructor() { this.p = []; this.n = []; this.i = []; }
  v(p, n) { this.p.push(...p); this.n.push(...norm(n)); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  merge(o) {
    const base = this.p.length / 3;
    this.p.push(...o.p); this.n.push(...o.n); this.i.push(...o.i.map((k) => k + base));
    return this;
  }
  mirrorX() {
    const m = new Mesh();
    for (let k = 0; k < this.p.length; k += 3) {
      m.p.push(-this.p[k], this.p[k + 1], this.p[k + 2]);
      m.n.push(-this.n[k], this.n[k + 1], this.n[k + 2]);
    }
    for (let k = 0; k < this.i.length; k += 3) m.i.push(this.i[k], this.i[k + 2], this.i[k + 1]);
    return m;
  }
  /** rings[i][j]: {p, n}; j wraps; i wraps if closed, else ends are capped. */
  grid(rings, closed) {
    const M = rings[0].length;
    const idx = rings.map((r) => r.map(({ p, n }) => this.v(p, n)));
    const I = closed ? rings.length : rings.length - 1;
    for (let a = 0; a < I; a++) {
      const b = (a + 1) % rings.length;
      for (let j = 0; j < M; j++) {
        const k = (j + 1) % M;
        this.quad(idx[a][j], idx[b][j], idx[b][k], idx[a][k]);
      }
    }
    if (!closed) {
      for (const [r, sign] of [[0, -1], [rings.length - 1, 1]]) {
        const ring = rings[r];
        const c = mul(ring.reduce((s, q) => add(s, q.p), [0, 0, 0]), 1 / M);
        const nrm = mul(norm(sub(rings[Math.min(r + 1, rings.length - 1)][0].p, rings[Math.max(r - 1, 0)][0].p)), sign);
        const ci = this.v(c, nrm);
        const ids = ring.map((q) => this.v(q.p, nrm));
        for (let j = 0; j < M; j++) this.tri(ci, ids[j], ids[(j + 1) % M]);
      }
    }
  }
}

/** Rounded-rectangle cross-section, w along u, h along v, fixed point count. */
function roundedRect(w, h, r, k = 4) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corners = [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]];
  for (const [sx, sy, a0] of corners) {
    for (let s = 0; s <= k; s++) {
      const a = (a0 + (s / k) * 0.5) * Math.PI;
      const nu = Math.cos(a), nv = Math.sin(a);
      pts.push({ u: sx * (w / 2 - r) + r * nu, v: sy * (h / 2 - r) + r * nv, nu, nv });
    }
  }
  return pts;
}

// Face-form wrap: the front bows back toward the temples (~6 mm at the hinge).
let WRAP_K = 0;
const warp = (p) => [p[0], p[1], p[2] - WRAP_K * p[0] * p[0]];

/** Sweep a section along a 3D path (open, capped). sectionAt(s∈[0,1]) → {t, h, r}. */
function tube(mesh, path, sectionAt, { up = [0, 1, 0] } = {}) {
  const rings = path.map((P, i) => {
    const T = norm(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]));
    let hint = up;
    if (Math.abs(dot(T, hint)) > 0.9) hint = [0, 0, 1];
    const S = norm(cross(T, hint));
    const U = cross(S, T);
    const { t, h, r } = sectionAt(i / (path.length - 1));
    return roundedRect(t, h, r).map(({ u, v, nu, nv }) => ({
      p: add(P, add(mul(S, u), mul(U, v))),
      n: add(mul(S, nu), mul(U, nv)),
    }));
  });
  mesh.grid(rings, false);
}

function ellipsoid(mesh, c, ax, ay, az, seg = 12) {
  const rings = [];
  for (let a = 1; a < seg; a++) {
    const th = (a / seg) * Math.PI;
    rings.push(Array.from({ length: seg * 2 }, (_, b) => {
      const ph = (b / (seg * 2)) * Math.PI * 2;
      const e = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const p = add(c, add(add(mul(ax, e[0]), mul(ay, e[1])), mul(az, e[2])));
      const la = dot(ax, ax), lb = dot(ay, ay), lc = dot(az, az);
      const n = add(add(mul(ax, e[0] / la), mul(ay, e[1] / lb)), mul(az, e[2] / lc));
      return { p, n };
    }));
  }
  mesh.grid(rings, false);
}

// ---------- lens shapes (right lens, +x temporal, exact A × B after fitting) --
const N = 96;
const sePt = (t, n) => { const c = Math.cos(t), s = Math.sin(t); return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)]; };
const ring = (f) => Array.from({ length: N }, (_, k) => f((k / N) * Math.PI * 2));
function smoothClosed(pts, passes) {
  for (let p = 0; p < passes; p++)
    pts = pts.map((q, k) => { const a = pts[(k - 1 + pts.length) % pts.length], b = pts[(k + 1) % pts.length]; return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4]; });
  return pts;
}
function resamplePolygon(verts, n) {
  const segs = verts.map((a, k) => { const b = verts[(k + 1) % verts.length]; return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }; });
  const total = segs.reduce((s, q) => s + q.len, 0);
  const out = [];
  for (let k = 0; k < n; k++) {
    let d = (k / n) * total;
    for (const s of segs) { if (d <= s.len) { out.push([s.a[0] + (s.b[0] - s.a[0]) * (d / s.len), s.a[1] + (s.b[1] - s.a[1]) * (d / s.len)]); break; } d -= s.len; }
  }
  return out;
}
const SHAPES = {
  round: () => ring((t) => [Math.cos(t), Math.sin(t)]),
  panto: () => ring((t) => { const [x, y] = sePt(t, 2.3); return [x, y > 0 ? y * 0.9 : y]; }),
  wayfarer: () => ring((t) => {
    const [x, y] = sePt(t, 3.4);
    // Trapezoid: wide straight brow rising toward the temple, bottom narrowing
    // and lifting on the nasal side.
    const xs = x * (1 + 0.16 * y) + (y < 0 ? 0.08 * y : 0);
    const yy = y > 0 ? y + 0.22 * (x + 1) * 0.5 : y * (1 - 0.3 * Math.max(0, -x));
    return [xs, yy];
  }),
  browline: () => ring((t) => { const [x, y] = sePt(t, 2.5); return [x, y > 0 ? y * 0.82 : y]; }),
  rect: () => ring((t) => { const [x, y] = sePt(t, 4); return [x, y < 0 ? y * (1 - 0.1 * Math.max(0, -x)) : y]; }),
  square: () => ring((t) => sePt(t, 3.6)),
  cateye: () => ring((t) => { const [x, y] = sePt(t, 2.6); return [x * (1 + 0.08 * y), y > 0 ? y + 0.7 * Math.max(0, x) ** 3 : y * (0.9 - 0.3 * Math.max(0, x))]; }),
  aviator: () => ring((t) => { const x = Math.cos(t), y = Math.sin(t); return [x, y > 0 ? y * 0.62 : y * (1 + 0.45 * Math.max(0, -x))]; }),
  hex: () => smoothClosed(resamplePolygon([0, 1, 2, 3, 4, 5].map((k) => [Math.cos((k / 6) * Math.PI * 2), Math.sin((k / 6) * Math.PI * 2) * 0.95]), N), 3),
};
/** Outline scaled to exactly A wide, B tall, bbox-centred. */
function lensOutline(shape, A, B) {
  const raw = SHAPES[shape]();
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return raw.map(([x, y]) => [((x - x0) / (x1 - x0) - 0.5) * A, ((y - y0) / (y1 - y0) - 0.5) * B]);
}

// ---------- frame builder ----------------------------------------------------
const BASE_CURVE_R = 132; // mm, ~4-base front
const sag = (r) => BASE_CURVE_R - Math.sqrt(BASE_CURVE_R * BASE_CURVE_R - r * r);

function buildFrame(spec) {
  const {
    shape, A, B, DBL, temple, kind, // kind: "acetate" | "metal" | "browline"
    rimW = 4, rimTopW = rimW, rimD = 5, endH = 9, templeH = 7, templeT = 3.6, wrapMm = 6,
    rivets = false, hingeYFrac = 0.28, aviatorBar = false,
  } = spec;
  const meshes = { frame: new Mesh(), metal: new Mesh(), tip: new Mesh(), lens: new Mesh(), pad: new Mesh() };
  const right = { frame: new Mesh(), metal: new Mesh(), tip: new Mesh(), lens: new Mesh(), pad: new Mesh() };
  const halfB = DBL / 2;
  const cx = halfB + A / 2;
  const outline = lensOutline(shape, A, B).map(([x, y]) => [x + cx, y]);
  const halfSpanGuess = cx + A / 2 + rimW;
  WRAP_K = wrapMm / (halfSpanGuess * halfSpanGuess);
  const isMetal = kind === "metal";
  const lensZ = -rimD * 0.45;

  // Lens: concentric rings on the spherical front curve, sitting in the rim groove.
  {
    const R = 10;
    const rings = [];
    for (let j = 1; j <= R; j++) {
      rings.push(outline.map(([x, y]) => {
        const px = cx + (x - cx) * (j / R), py = y * (j / R);
        const r = Math.hypot(px - cx, py);
        const p = warp([px, py, lensZ - sag(r)]);
        return { p, n: [(px - cx) / BASE_CURVE_R, py / BASE_CURVE_R, 1] };
      }));
    }
    const ci = right.lens.v(warp([cx, 0, lensZ]), [0, 0, 1]);
    const ids = rings.map((r) => r.map(({ p, n }) => right.lens.v(p, n)));
    for (let k = 0; k < N; k++) right.lens.tri(ci, ids[0][k], ids[0][(k + 1) % N]);
    for (let j = 0; j < R - 1; j++)
      for (let k = 0; k < N; k++) right.lens.quad(ids[j][k], ids[j + 1][k], ids[j + 1][(k + 1) % N], ids[j][(k + 1) % N]);
  }

  // Rim sweep: groove overlaps the lens edge by 0.8 mm; width varies by angle.
  const rimSweep = (mesh, indices, { width, depth, radius, closed }) => {
    const rings = indices.map((k) => {
      const p = outline[k];
      const a = outline[(k - 1 + N) % N], b = outline[(k + 1) % N];
      let n2 = norm([b[1] - a[1], -(b[0] - a[0]), 0]);
      if (n2[0] * (p[0] - cx) + n2[1] * p[1] < 0) n2 = mul(n2, -1);
      const W = width(k);
      const zEdge = -sag(Math.hypot(p[0] - cx, p[1]));
      return roundedRect(W, depth, radius).map(({ u, v, nu, nv }) => {
        const uu = u + W / 2 - 0.8;
        const vv = v - depth / 2 + depth * 0.05;
        return { p: warp([p[0] + n2[0] * uu, p[1] + n2[1] * uu, zEdge + vv]), n: [n2[0] * nu, n2[1] * nu, nv] };
      });
    });
    mesh.grid(rings, closed);
  };
  const all = Array.from({ length: N }, (_, k) => k);
  const topness = (k) => Math.max(0, outline[k][1] / (B / 2)); // 0 bottom/sides → 1 top
  if (kind === "acetate") {
    rimSweep(right.frame, all, { width: (k) => rimW + (rimTopW - rimW) * topness(k) ** 1.5, depth: rimD, radius: 1.6, closed: true });
  } else if (kind === "metal") {
    rimSweep(right.frame, all, { width: () => rimW, depth: rimD, radius: rimW / 2, closed: true });
  } else {
    // Browline: acetate brow over the top ~45 %, thin metal wire all round.
    rimSweep(right.metal, all, { width: () => 1.5, depth: 1.8, radius: 0.75, closed: true });
    const brow = all.filter((k) => outline[k][1] > -B * 0.05);
    // Order temporal → over the top → nasal; unwrap so the seam sits at the bottom.
    const ang = (k) => { const a = Math.atan2(outline[k][1], outline[k][0] - cx); return a < -Math.PI / 2 ? a + 2 * Math.PI : a; };
    brow.sort((a, b) => ang(a) - ang(b));
    rimSweep(right.frame, brow, { width: (k) => 2 + (rimTopW - 2) * topness(k) ** 0.7, depth: rimD, radius: 1.4, closed: false });
  }

  // Temporal outer point at hinge height → end piece → hinge.
  const hy = B * hingeYFrac;
  let outer = outline.reduce((best, p) => (Math.abs(p[1] - hy) < 2.5 && p[0] > best[0] ? p : best), [cx, 0]);
  const rimOutW = kind === "acetate" ? rimW : kind === "browline" ? rimTopW * 0.8 : rimW;
  const ex = outer[0] + rimOutW - 0.8;
  const zFront = -sag(Math.hypot(outer[0] - cx, outer[1]));
  const endMat = kind === "metal" ? right.frame : right.frame;
  const hingeZ = zFront - rimD - 3;
  const endPath = [];
  for (let s = 0; s <= 8; s++) {
    const t = s / 8;
    const ang = t * Math.PI / 2;
    endPath.push(warp([ex - 3 + 4 * Math.sin(ang), hy, zFront - rimD / 2 - (1 - Math.cos(ang)) * (rimD / 2 + 3)]));
  }
  tube(endMat, endPath, () => (isMetal ? { t: 1.8, h: 3.2, r: 0.9 } : { t: rimD * 0.9, h: endH, r: 1.6 }));
  const hinge = endPath[endPath.length - 1];
  const hingeLen = isMetal ? 4 : Math.min(endH - 2, 6);
  tube(right.metal, [add(hinge, [0.4, -hingeLen / 2, 0]), add(hinge, [0.4, hingeLen / 2, 0])], () => ({ t: 2.4, h: 2.4, r: 1.2 }));
  if (rivets) {
    for (const dx of [-3.2, 0.4]) {
      const p = warp([ex - 3 + dx, hy + 1.2, zFront + 0.2]);
      tube(right.metal, [add(p, [0, 0, -0.6]), add(p, [0, 0, 0.35])], () => ({ t: 1.6, h: 1.6, r: 0.8 }));
    }
  }

  // Temple: straight back with 3° splay, ear bend 28° over ~18 mm, short tip.
  {
    const path = [];
    const straight = temple - 38;
    const splay = (3 * Math.PI) / 180;
    const dir = [Math.sin(splay), 0, -Math.cos(splay)];
    const start = add(hinge, [0.6, 0, -0.6]);
    const steps = 40;
    for (let s = 0; s <= steps; s++) path.push(add(start, mul(dir, (s / steps) * straight)));
    let P = path[path.length - 1];
    let pitch = 0;
    for (let s = 1; s <= 14; s++) {
      pitch = Math.min(28, pitch + 2.2);
      const a = (pitch * Math.PI) / 180;
      P = add(P, mul(norm([dir[0] * Math.cos(a), -Math.sin(a), dir[2] * Math.cos(a)]), 2.7));
      path.push(P);
    }
    const n = path.length;
    const bendAt = (steps + 1) / n;
    if (isMetal) {
      tube(right.frame, path.slice(0, steps + 3), () => ({ t: 1.4, h: 2.2, r: 0.7 }));
      tube(right.tip, path.slice(steps - 4), (s) => ({ t: 3 - s * 0.6, h: 4.2 - s * 1, r: 1.2 }));
    } else {
      tube(right.frame, path, (s) => {
        const k = s < bendAt ? s / bendAt : 1;
        return { t: templeT - 0.9 * k, h: endH - (endH - templeH) * Math.min(1, k * 4) - (templeH - 4.2) * k * k, r: 1.2 };
      });
    }
  }

  // Nose pads.
  if (isMetal || kind === "browline") {
    const root = warp([halfB + 1.2, -B * 0.05, -sag(A / 2) - rimD]);
    const padC = [halfB - 2.2, -B * 0.24, root[2] - 6];
    const armPath = Array.from({ length: 10 }, (_, s) => { const t = s / 9; return add(lerp3(root, padC, t), [0, 0, -Math.sin(t * Math.PI) * 1.5]); });
    tube(isMetal ? right.frame : right.metal, armPath, () => ({ t: 0.9, h: 0.9, r: 0.45 }));
    const thin = norm([1, 0, 0.35]);
    const long = norm([0.25, 1, 0.1]);
    const wide = norm(cross(thin, long));
    ellipsoid(right.pad, add(padC, mul(thin, -0.9)), mul(thin, 0.9), mul(long, 6), mul(wide, 3.6));
  } else {
    // Acetate saddle pads moulded onto the back of the nasal rim.
    const top = warp([halfB - rimW * 0.35, -B * 0.02, -sag(A / 2) - rimD * 0.9]);
    const bot = warp([halfB - rimW * 0.35 - 1.2, -B * 0.32, -sag(A / 2) - rimD - 1.2]);
    const path = Array.from({ length: 10 }, (_, s) => lerp3(top, bot, s / 9));
    tube(right.frame, path, (s) => ({ t: 2.6, h: 2 + 2 * Math.sin(s * Math.PI), r: 1 }), { up: [1, 0, 0] });
  }

  // Bridge (symmetric, built once).
  {
    const nasalIn = halfB - (kind === "metal" ? 0 : rimW * 0.45);
    const zB = -sag(A / 2) - rimD * 0.5;
    const arch = (yb, archH, sect) => {
      const path = Array.from({ length: 21 }, (_, s) => {
        const x = -nasalIn + (2 * nasalIn * s) / 20;
        const q = x / nasalIn;
        return warp([x, yb + archH * (1 - q * q), zB + (kind === "acetate" ? 0 : 0.8) * (1 - q * q)]);
      });
      tube(meshes.frame, path, sect);
    };
    if (kind === "acetate") arch(B * 0.2, 2.2, () => ({ t: rimD, h: Math.max(4.5, rimTopW * 0.85), r: 1.6 }));
    else if (kind === "browline") {
      const p = Array.from({ length: 21 }, (_, s) => { const x = -halfB - 1 + ((2 * halfB + 2) * s) / 20; const q = x / (halfB + 1); return warp([x, B * 0.18 + 2.5 * (1 - q * q), -sag(A / 2) - 0.9]); });
      tube(meshes.metal, p, () => ({ t: 1.6, h: 1.8, r: 0.8 }));
    } else {
      arch(B * 0.22, 3, () => ({ t: 1.4, h: 1.8, r: 0.7 }));
      if (aviatorBar) {
        const yTop = B * 0.45;
        const p = Array.from({ length: 21 }, (_, s) => warp([-(halfB + 6) + ((2 * halfB + 12) * s) / 20, yTop, -sag(A / 2) - rimD * 0.5]));
        tube(meshes.frame, p, () => ({ t: 1.3, h: 1.6, r: 0.65 }));
      }
    }
  }

  for (const key of Object.keys(meshes)) meshes[key].merge(right[key]).merge(right[key].mirrorX());
  return meshes;
}

// ---------- tortoise texture (PNG) --------------------------------------------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function tortoisePng(size = 256, seed = 7) {
  // Tileable value noise (lattice wraps) → fBm → domain warp → havana palette.
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lat = (G) => Array.from({ length: G * G }, rnd);
  const octs = [8, 16, 32, 64].map((G) => ({ G, t: lat(G) }));
  const vn = ({ G, t }, x, y) => {
    const fx = x * G, fy = y * G, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const g = (a, b) => t[((a % G) + G) % G + (((b % G) + G) % G) * G];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
  };
  const fbm = (x, y) => octs.reduce((acc, o, k) => acc + vn(o, x, y) / 2 ** k, 0) / 1.875;
  const out = Buffer.alloc(size * size * 3);
  const pal = [[0.55, 0.28, 0.07], [0.3, 0.13, 0.035], [0.12, 0.05, 0.02], [0.04, 0.018, 0.01]];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const w = fbm(u + 0.37, v + 0.11);
      const t = Math.min(1, Math.max(0, (fbm(u + 0.3 * w, v + 0.3 * w) - 0.25) * 2.4));
      const f = t * (pal.length - 1), i = Math.min(pal.length - 2, Math.floor(f)), r = f - i;
      const c = pal[i].map((a, k) => a + (pal[i + 1][k] - a) * r);
      for (let k = 0; k < 3; k++) out[(y * size + x) * 3 + k] = Math.round(Math.pow(c[k], 1 / 2.2) * 255);
    }
  return png(size, size, out);
}

// ---------- GLB writer -------------------------------------------------------
function writeGlb(path, parts, materials, image) {
  const bufParts = [];
  const bufferViews = [];
  const accessors = [];
  let byteLength = 0;
  const pushView = (bytes, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { bufParts.push(Buffer.alloc(pad)); byteLength += pad; }
    bufParts.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const meshes = [], nodes = [];
  for (const { name, material, mesh } of parts) {
    if (!mesh.i.length) continue;
    const pos = new Float32Array(mesh.p), nrm = new Float32Array(mesh.n), idx = new Uint32Array(mesh.i);
    const uv = new Float32Array((mesh.p.length / 3) * 2);
    for (let k = 0, j = 0; k < mesh.p.length; k += 3, j += 2) {
      uv[j] = (mesh.p[k] - 0.6 * mesh.p[k + 2]) / 38;
      uv[j + 1] = (mesh.p[k + 1] + 0.3 * mesh.p[k + 2]) / 38;
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[k + a]); max[a] = Math.max(max[a], pos[k + a]); }
    const base = accessors.length;
    accessors.push({ bufferView: pushView(pos, 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: pushView(nrm, 34962), componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    accessors.push({ bufferView: pushView(uv, 34962), componentType: 5126, count: uv.length / 2, type: "VEC2" });
    accessors.push({ bufferView: pushView(idx, 34963), componentType: 5125, count: idx.length, type: "SCALAR" });
    meshes.push({ name, primitives: [{ attributes: { POSITION: base, NORMAL: base + 1, TEXCOORD_0: base + 2 }, indices: base + 3, material }] });
    nodes.push({ name, mesh: meshes.length - 1 });
  }
  const json = { asset: { version: "2.0", generator: "eyenetra-real-frames" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews };
  if (image) {
    json.images = [{ bufferView: pushView(new Uint8Array(image), undefined), mimeType: "image/png" }];
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    json.textures = [{ sampler: 0, source: 0 }];
  }
  json.buffers = [{ byteLength }];
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4) jsonStr += " ";
  const jsonBytes = Buffer.from(jsonStr, "utf8");
  const bin = Buffer.concat([...bufParts, Buffer.alloc((4 - (byteLength % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(jsonBytes.length, 0); jc.writeUInt32LE(0x4e4f534a, 4);
  const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length, 0); bc.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jc, jsonBytes, bc, bin]));
}

// ---------- catalogue --------------------------------------------------------
const SILVER = [0.8, 0.8, 0.82], GOLD = [0.85, 0.68, 0.38], GUN = [0.32, 0.32, 0.34];
const CLEAR = { lensColor: "#dfe6ea", lensOpacity: 0.12 };
const V = (id, name, frameColor, metalness, roughness, lens = CLEAR) => ({ id, name, frameColor, metalness, roughness, ...lens });
const SET = [
  { id: "r-wayfarer", name: "Classic Wayfarer", shape: "wayfarer", kind: "acetate", A: 50, B: 40, DBL: 22, temple: 145, rimW: 4.2, rimTopW: 7.5, rimD: 5.5, endH: 10, templeH: 8, rivets: true, hingeYFrac: 0.3, hardware: SILVER,
    variants: [V("black", "Glossy Black", "#121212", 0.05, 0.22), V("matte", "Matte Black", "#1d1d1d", 0.02, 0.6), V("navy", "Navy", "#1b2540", 0.05, 0.3)] },
  { id: "r-wayfarer-tort", name: "Classic Wayfarer Tortoise", shape: "wayfarer", kind: "acetate", A: 52, B: 41, DBL: 22, temple: 150, rimW: 4.2, rimTopW: 7.5, rimD: 5.5, endH: 10, templeH: 8, rivets: true, hingeYFrac: 0.3, hardware: SILVER, tortoise: true,
    variants: [V("havana", "Havana", "#ffffff", 0.02, 0.25)] },
  { id: "r-browline", name: "Browline Clubmaster", shape: "browline", kind: "browline", A: 51, B: 41, DBL: 21, temple: 145, rimTopW: 6.5, rimD: 5, endH: 8, templeH: 6.5, rivets: true, hingeYFrac: 0.32, hardware: GOLD,
    variants: [V("black-gold", "Black / Gold", "#141414", 0.05, 0.25), V("tort-gold", "Tortoise / Gold", "#4a2a14", 0.05, 0.3)] },
  { id: "r-round-metal", name: "Round Metal", shape: "round", kind: "metal", A: 49, B: 47, DBL: 21, temple: 145, rimW: 1.6, rimD: 2, hingeYFrac: 0.05, hardware: GOLD,
    variants: [V("gold", "Gold", "#d4ad62", 0.9, 0.25), V("silver", "Silver", "#cfd2d6", 0.9, 0.22), V("gunmetal", "Gunmetal", "#4a4b50", 0.85, 0.3)] },
  { id: "r-aviator", name: "Aviator Metal", shape: "aviator", kind: "metal", A: 58, B: 50, DBL: 14, temple: 140, rimW: 1.5, rimD: 2, hingeYFrac: 0.3, aviatorBar: true, hardware: GOLD,
    variants: [V("gold-g15", "Gold / Green G-15", "#d4ad62", 0.9, 0.22, { lensColor: "#3a4a33", lensOpacity: 0.78 }), V("silver-clear", "Silver / Clear", "#cfd2d6", 0.9, 0.22), V("gold-brown", "Gold / Brown", "#d4ad62", 0.9, 0.22, { lensColor: "#5a3d22", lensOpacity: 0.72 })] },
  { id: "r-office-rect", name: "Office Rectangle", shape: "rect", kind: "acetate", A: 54, B: 36, DBL: 17, temple: 145, rimW: 3.6, rimTopW: 4.8, rimD: 4.5, endH: 8, templeH: 6.5, hardware: SILVER,
    variants: [V("black", "Black", "#151515", 0.05, 0.3), V("brown", "Dark Brown", "#3b2416", 0.05, 0.3), V("grey", "Crystal Grey", "#6b6f74", 0.05, 0.2)] },
  { id: "r-bold-square", name: "Bold Square", shape: "square", kind: "acetate", A: 54, B: 45, DBL: 18, temple: 145, rimW: 5.5, rimTopW: 7, rimD: 6, endH: 11, templeH: 9, templeT: 4.2, rivets: true, hingeYFrac: 0.3, hardware: SILVER,
    variants: [V("black", "Black", "#121212", 0.05, 0.25), V("blue", "Deep Blue", "#1a2f5c", 0.05, 0.3), V("wine", "Wine", "#5a1626", 0.05, 0.3)] },
  { id: "r-bold-square-tort", name: "Bold Square Tortoise", shape: "square", kind: "acetate", A: 54, B: 45, DBL: 18, temple: 145, rimW: 5.5, rimTopW: 7, rimD: 6, endH: 11, templeH: 9, templeT: 4.2, rivets: true, hingeYFrac: 0.3, hardware: SILVER, tortoise: true,
    variants: [V("havana", "Havana", "#ffffff", 0.02, 0.25)] },
  { id: "r-panto-tort", name: "Round Panto Tortoise", shape: "panto", kind: "acetate", A: 48, B: 44, DBL: 21, temple: 145, rimW: 4, rimTopW: 5, rimD: 5, endH: 8.5, templeH: 7, hardware: SILVER, tortoise: true,
    variants: [V("havana", "Havana", "#ffffff", 0.02, 0.25), V("honey", "Honey", "#f2c98a", 0.02, 0.25)] },
  { id: "r-cateye", name: "Cat-Eye", shape: "cateye", kind: "acetate", A: 52, B: 42, DBL: 18, temple: 140, rimW: 4, rimTopW: 6.5, rimD: 5, endH: 9, templeH: 7, hingeYFrac: 0.38, hardware: GOLD,
    variants: [V("black", "Black", "#121212", 0.05, 0.25), V("burgundy", "Burgundy", "#5c1a24", 0.05, 0.3)] },
  { id: "r-hex-metal", name: "Hexagon Metal", shape: "hex", kind: "metal", A: 51, B: 46, DBL: 21, temple: 145, rimW: 1.5, rimD: 2, hingeYFrac: 0.1, hardware: GOLD,
    variants: [V("gold", "Gold", "#d4ad62", 0.9, 0.25), V("silver", "Silver", "#cfd2d6", 0.9, 0.22)] },
  { id: "r-slim-metal", name: "Slim Rectangle Metal", shape: "rect", kind: "metal", A: 55, B: 34, DBL: 17, temple: 145, rimW: 1.6, rimD: 2.2, hingeYFrac: 0.25, hardware: GUN,
    variants: [V("gunmetal", "Gunmetal", "#4a4b50", 0.85, 0.3), V("silver", "Silver", "#cfd2d6", 0.9, 0.22), V("black", "Matte Black", "#202022", 0.6, 0.5)] },
];

mkdirSync("public/models/real", { recursive: true });
const tort = tortoisePng();
const skus = [];
for (const spec of SET) {
  const m = buildFrame(spec);
  const frameMat = { name: "Frame", pbrMetallicRoughness: { baseColorFactor: [0.08, 0.08, 0.08, 1], metallicFactor: spec.kind === "metal" ? 0.9 : 0, roughnessFactor: 0.3 } };
  if (spec.tortoise) frameMat.pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.25 };
  const materials = [
    frameMat,
    { name: "Lens", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [0.85, 0.9, 0.92, 0.12], metallicFactor: 0, roughnessFactor: 0.05 } },
    { name: "Metal", extras: { keepAuthored: true }, pbrMetallicRoughness: { baseColorFactor: [...spec.hardware, 1], metallicFactor: 1, roughnessFactor: 0.28 } },
    { name: "Tip", extras: { keepAuthored: true }, pbrMetallicRoughness: { baseColorFactor: [0.04, 0.04, 0.04, 1], metallicFactor: 0, roughnessFactor: 0.4 } },
    { name: "NosePad", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [0.92, 0.94, 0.95, 0.45], metallicFactor: 0, roughnessFactor: 0.15 } },
  ];
  const path = `public/models/real/${spec.id}.glb`;
  writeGlb(path, [
    { name: "Frame", material: 0, mesh: m.frame },
    { name: "Lens", material: 1, mesh: m.lens },
    { name: "Metal", material: 2, mesh: m.metal },
    { name: "Tip", material: 3, mesh: m.tip },
    { name: "NosePad", material: 4, mesh: m.pad },
  ], materials, spec.tortoise ? tort : null);
  // Measure the built geometry rather than trusting the formula.
  const lx = m.lens.p.filter((_, k) => k % 3 === 0);
  const all = [m.frame, m.metal, m.tip, m.pad].flatMap((q) => q.p.filter((_, k) => k % 3 === 0));
  const lensSpan = Math.max(...lx) - Math.min(...lx);
  const width = Math.max(...all, ...lx) - Math.min(...all, ...lx);
  const nasal = Math.min(...lx.filter((x) => x > 0)) * 2;
  skus.push({ spec, path, lensSpan, width, nasal });
  console.log(`${spec.id.padEnd(20)} ${spec.A}□${spec.DBL}-${spec.temple}  lensSpan=${lensSpan.toFixed(1)} (2A+DBL=${2 * spec.A + spec.DBL})  DBL=${nasal.toFixed(1)}  front=${width.toFixed(1)}mm`);
}

const ts = `// GENERATED by scripts/generate-real-frames.mjs — do not edit by hand.
// Realistic everyday styles with exact optical dimensions (A□DBL-temple).
// Styles, not branded products.
import type { FrameSku } from "./frames";

export const REAL_FRAMES: FrameSku[] = ${JSON.stringify(
  skus.map(({ spec, path, lensSpan, width }) => ({
    id: spec.id,
    name: spec.name,
    glbPath: "/" + path.replace(/^public\//, ""),
    thumbnailColor: spec.variants[0].frameColor === "#ffffff" ? "#5a3418" : spec.variants[0].frameColor,
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: Math.round(width * 10) / 10,
      lensSpanMm: Math.round(lensSpan * 10) / 10,
      templeLengthMm: spec.temple,
      bridgeWidthMm: spec.DBL,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: spec.variants.map((v) => ({ ...v, id: `${spec.id}-${v.id}` })),
  })),
  null,
  2,
)};
`;
writeFileSync("src/data/realFrames.generated.ts", ts);
console.log(`\nwrote ${skus.length} frames → public/models/real/, src/data/realFrames.generated.ts`);
