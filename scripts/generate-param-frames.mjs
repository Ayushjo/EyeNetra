#!/usr/bin/env node
/**
 * Generate parametric eyewear GLBs with EXACT known dimensions for fit
 * testing. These are not products — they are measurement rigs: every frame
 * has a known total width, lens shape/size, bridge width, temple length and
 * pantoscopic-neutral geometry, so the fit pipeline (lens-centre pivot,
 * hinge scan, temple occlusion, scale) can be checked against ground truth
 * across the shapes a real catalogue contains.
 *
 * Materials are named "Lens" and "Frame" so `fit.lensMaterialNames: ["Lens"]`.
 * Units: millimetres (the loader width-normalizes anyway).
 *
 * Usage: node scripts/generate-param-frames.mjs   → public/models/param/*.glb
 *        prints the frames.ts entries to paste.
 */
import { mkdirSync, writeFileSync } from "node:fs";

// ---------- minimal GLB writer (positions, normals, indices, 2 materials) ----
function writeGlb(path, meshes, materials) {
  // meshes: [{ name, material: index, positions: Float32Array, normals: Float32Array, indices: Uint32Array }]
  const bufParts = [];
  const bufferViews = [];
  const accessors = [];
  let byteLength = 0;
  const pushView = (data, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      bufParts.push(new Uint8Array(pad));
      byteLength += pad;
    }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufParts.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const gltfMeshes = [];
  const nodes = [];
  meshes.forEach((m, i) => {
    const pv = pushView(m.positions, 34962);
    const nv = pushView(m.normals, 34962);
    const iv = pushView(m.indices, 34963);
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < m.positions.length; k += 3)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], m.positions[k + a]);
        max[a] = Math.max(max[a], m.positions[k + a]);
      }
    accessors.push({ bufferView: pv, componentType: 5126, count: m.positions.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: nv, componentType: 5126, count: m.normals.length / 3, type: "VEC3" });
    accessors.push({ bufferView: iv, componentType: 5125, count: m.indices.length, type: "SCALAR" });
    const base = accessors.length - 3;
    gltfMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: m.material }] });
    nodes.push({ name: m.name, mesh: i });
  });
  const json = {
    asset: { version: "2.0", generator: "eyenetra-param-frames" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4) jsonStr += " ";
  const jsonBytes = Buffer.from(jsonStr, "utf8");
  const binPad = (4 - (byteLength % 4)) % 4;
  const bin = Buffer.concat([...bufParts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)), Buffer.alloc(binPad)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(jsonBytes.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(bin.length, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jsonChunk, jsonBytes, binChunk, bin]));
}

// ---------- geometry helpers ------------------------------------------------
class MeshBuilder {
  constructor() { this.p = []; this.n = []; this.i = []; }
  addQuad(a, b, c, d, normal) {
    const base = this.p.length / 3;
    for (const v of [a, b, c, d]) { this.p.push(...v); this.n.push(...normal); }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Extrude a closed 2D outline (array of [x,y]) along z from z0 to z1 with a wall. */
  addTube(outline, z0, z1, flip = false) {
    const n = outline.length;
    for (let k = 0; k < n; k++) {
      const [x0, y0] = outline[k], [x1, y1] = outline[(k + 1) % n];
      const nx = y1 - y0, ny = -(x1 - x0);
      const len = Math.hypot(nx, ny) || 1;
      const normal = flip ? [-nx / len, -ny / len, 0] : [nx / len, ny / len, 0];
      this.addQuad([x0, y0, z0], [x1, y1, z0], [x1, y1, z1], [x0, y0, z1], normal);
    }
  }
  /** Flat ring between outer and inner outlines (same point count) at depth z. */
  addRing(outer, inner, z, normalZ) {
    const n = outer.length;
    for (let k = 0; k < n; k++) {
      const a = outer[k], b = outer[(k + 1) % n], c = inner[(k + 1) % n], d = inner[k];
      if (normalZ > 0) this.addQuad([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [d[0], d[1], z], [0, 0, 1]);
      else this.addQuad([d[0], d[1], z], [c[0], c[1], z], [b[0], b[1], z], [a[0], a[1], z], [0, 0, -1]);
    }
  }
  /** Filled flat polygon (fan) at depth z. */
  addFill(outline, z, normalZ) {
    const base = this.p.length / 3;
    for (const [x, y] of outline) { this.p.push(x, y, z); this.n.push(0, 0, normalZ); }
    for (let k = 1; k < outline.length - 1; k++) {
      if (normalZ > 0) this.i.push(base, base + k, base + k + 1);
      else this.i.push(base, base + k + 1, base + k);
    }
  }
  box(cx, cy, cz, sx, sy, sz) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const q = (a, b, c, d, n) => this.addQuad(a, b, c, d, n);
    q([cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz], [0, 0, 1]);
    q([cx + hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz - hz], [cx - hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz - hz], [0, 0, -1]);
    q([cx + hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy + hy, cz - hz], [cx + hx, cy + hy, cz + hz], [1, 0, 0]);
    q([cx - hx, cy - hy, cz - hz], [cx - hx, cy - hy, cz + hz], [cx - hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz - hz], [-1, 0, 0]);
    q([cx - hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz + hz], [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz], [0, 1, 0]);
    q([cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz + hz], [cx - hx, cy - hy, cz + hz], [0, -1, 0]);
  }
  toMesh(name, material) {
    return { name, material, positions: new Float32Array(this.p), normals: new Float32Array(this.n), indices: new Uint32Array(this.i) };
  }
}

/** Lens outline generators: return N points [x,y] around a lens of width w, height h. */
const SHAPES = {
  round: (w, h, N) => Array.from({ length: N }, (_, k) => { const t = (k / N) * Math.PI * 2; return [Math.cos(t) * w / 2, Math.sin(t) * h / 2]; }),
  oval: (w, h, N) => SHAPES.round(w, h, N),
  rect: (w, h, N) => superellipse(w, h, N, 5),
  square: (w, h, N) => superellipse(w, h, N, 4),
  wayfarer: (w, h, N) => Array.from({ length: N }, (_, k) => { const t = (k / N) * Math.PI * 2; const [x, y] = superellipsePt(w, h, t, 3.2); return [x + (y > 0 ? 0.06 * w : -0.02 * w) * Math.sign(x), y * (y > 0 ? 1 : 0.9)]; }),
  aviator: (w, h, N) => Array.from({ length: N }, (_, k) => { const t = (k / N) * Math.PI * 2; const x = Math.cos(t) * w / 2, y = Math.sin(t) * h / 2; return [x, y > 0 ? y * 0.75 : y * 1.05 - (Math.abs(x) / (w / 2)) * 0.12 * h]; }),
  cateye: (w, h, N) => Array.from({ length: N }, (_, k) => { const t = (k / N) * Math.PI * 2; const x = Math.cos(t) * w / 2, y = Math.sin(t) * h / 2; const lift = x > 0 ? (x / (w / 2)) ** 2 * 0.35 * h : 0; return [x, y > 0 ? y + lift : y * 0.85]; }),
  shield: (w, h, N) => superellipse(w, h, N, 2.6),
};
function superellipsePt(w, h, t, n) {
  const c = Math.cos(t), s = Math.sin(t);
  return [Math.sign(c) * Math.abs(c) ** (2 / n) * w / 2, Math.sign(s) * Math.abs(s) ** (2 / n) * h / 2];
}
function superellipse(w, h, N, n) { return Array.from({ length: N }, (_, k) => superellipsePt(w, h, (k / N) * Math.PI * 2, n)); }
function offsetOutline(outline, d) {
  // Grow outward by d along the local normal.
  const n = outline.length;
  return outline.map((p, k) => {
    const [px, py] = outline[(k - 1 + n) % n], [nx, ny] = outline[(k + 1) % n];
    const tx = nx - px, ty = ny - py;
    const len = Math.hypot(tx, ty) || 1;
    return [p[0] + (ty / len) * d, p[1] - (tx / len) * d];
  });
}

/**
 * Build one frame. All dims in mm. Lens outline is mirrored for the second eye.
 *  totalWidth = 2*lensW + bridge + 2*rimT (+hinge blocks inside width)
 */
function buildFrame(spec) {
  const { shape, lensW, lensH, bridge, rimT, templeLen, frontDepth = 3.5, templeT = 3.5, templeH = 5, N = 48, mirrorLeft = true } = spec;
  const frame = new MeshBuilder();
  const lens = new MeshBuilder();
  const halfBridge = bridge / 2;
  const cx = halfBridge + rimT + lensW / 2; // lens centre x (right lens, +x)
  const zFront = 0, zBack = -frontDepth;
  for (const side of [1, -1]) {
    // Right lens (+x) uses the outline as authored (CCW). The left lens is the
    // exact mirror: x → -x flips the winding to CW, so the outward offset and
    // the wall normals flip sign with it — mirror once, compensate once.
    const mirrored = side < 0 && mirrorLeft;
    const outline = SHAPES[shape](lensW, lensH, N).map(([x, y]) => [mirrored ? -x : x, y]);
    const inner = outline.map(([x, y]) => [x + side * cx, y]);
    const outer = offsetOutline(inner, mirrored ? -rimT : rimT);
    // Rim: front ring, back ring, outer wall, inner wall.
    if (mirrored) {
      frame.addRing(outer, inner, zFront, -1);
      frame.addRing(outer, inner, zBack, 1);
    } else {
      frame.addRing(outer, inner, zFront, 1);
      frame.addRing(outer, inner, zBack, -1);
    }
    frame.addTube(outer, zBack, zFront, mirrored);
    frame.addTube(inner, zBack, zFront, !mirrored);
    // Lens: thin slab 1 mm behind the front face.
    const lz = zFront - 1.0;
    lens.addFill(inner, lz, mirrored ? -1 : 1);
    lens.addFill(inner, lz - 1.2, mirrored ? 1 : -1);
    // Hinge block at the outer edge (level with the lens centre) + temple.
    const edgeX = side * (cx + lensW / 2 + rimT);
    frame.box(edgeX - side * 2, 0, -frontDepth / 2 - 1.5, 4, templeH + 1, frontDepth + 1);
    // Temple arm straight back from the hinge, then a 20 mm tip bent down 15°.
    const armLen = templeLen - 20;
    frame.box(edgeX - side * templeT / 2, 0, -frontDepth - armLen / 2, templeT, templeH, armLen);
    const tipZ0 = -frontDepth - armLen;
    for (let s = 0; s < 4; s++) {
      const z = tipZ0 - s * 5 - 2.5;
      const drop = -Math.tan(Math.PI / 12) * (s * 5 + 2.5);
      frame.box(edgeX - side * templeT / 2, drop, z, templeT, templeH * 0.8, 5);
    }
  }
  // Bridge bar connecting the two rims at the lens-centre height (+ slight up).
  const bridgeY = lensH * 0.3;
  frame.box(0, bridgeY, -frontDepth / 2, bridge + rimT * 2 + 1, rimT * 1.2, frontDepth);
  // Nose pads: two small blocks 8 mm below the bridge, 6 mm behind the front.
  // Nose pads: small, set back behind the lens plane so they never read as a
  // dark block through the lens from an off-axis camera.
  for (const side of [1, -1]) frame.box(side * (halfBridge - 1.5), bridgeY - 9, -7, 1.5, 6, 2);
  return { frame: frame.toMesh("Frame", 0), lens: lens.toMesh("Lens", 1) };
}

// ---------- the test set ----------------------------------------------------
// Each entry: exact dims. Width formula: 2*lensW + bridge + 2*rimT + 2*4 (hinge blocks).
const SET = [
  { id: "p-round-s",     name: "Param Round S",     shape: "round",    lensW: 44, lensH: 44, bridge: 21, rimT: 2.5, templeLen: 140 },
  { id: "p-round-l",     name: "Param Round L",     shape: "round",    lensW: 50, lensH: 48, bridge: 22, rimT: 3,   templeLen: 145 },
  { id: "p-rect-s",      name: "Param Rect S",      shape: "rect",     lensW: 50, lensH: 32, bridge: 18, rimT: 2,   templeLen: 140 },
  { id: "p-rect-l",      name: "Param Rect L",      shape: "rect",     lensW: 56, lensH: 38, bridge: 17, rimT: 2.5, templeLen: 145 },
  { id: "p-square",      name: "Param Square",      shape: "square",   lensW: 52, lensH: 44, bridge: 20, rimT: 3,   templeLen: 145 },
  { id: "p-wayfarer",    name: "Param Wayfarer",    shape: "wayfarer", lensW: 52, lensH: 42, bridge: 20, rimT: 3.5, templeLen: 145 },
  { id: "p-aviator",     name: "Param Aviator",     shape: "aviator",  lensW: 58, lensH: 50, bridge: 14, rimT: 1.2, templeLen: 140 },
  { id: "p-cateye",      name: "Param Cat-Eye",     shape: "cateye",   lensW: 52, lensH: 40, bridge: 18, rimT: 3,   templeLen: 140 },
  { id: "p-oval",        name: "Param Oval",        shape: "oval",     lensW: 50, lensH: 36, bridge: 19, rimT: 2,   templeLen: 142 },
  { id: "p-shield",      name: "Param Shield",      shape: "shield",   lensW: 62, lensH: 44, bridge: 12, rimT: 2,   templeLen: 130 },
  { id: "p-narrow",      name: "Param Narrow",      shape: "rect",     lensW: 46, lensH: 28, bridge: 20, rimT: 2,   templeLen: 138 },
  { id: "p-oversize",    name: "Param Oversize",    shape: "square",   lensW: 58, lensH: 50, bridge: 16, rimT: 4,   templeLen: 150 },
];

mkdirSync("public/models/param", { recursive: true });
const entries = [];
for (const spec of SET) {
  const { frame, lens } = buildFrame(spec);
  const width = 2 * spec.lensW + spec.bridge + 2 * spec.rimT + 8;
  const path = `public/models/param/${spec.id}.glb`;
  writeGlb(path, [frame, lens], [
    { name: "Frame", pbrMetallicRoughness: { baseColorFactor: [0.12, 0.12, 0.12, 1], metalness: 0.1, roughnessFactor: 0.5 } },
    { name: "Lens", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [0.3, 0.35, 0.4, 0.35], metalness: 0, roughnessFactor: 0.05 } },
  ]);
  entries.push({ ...spec, width, path });
  console.log(`${spec.id.padEnd(12)} width=${width}mm lens=${spec.lensW}x${spec.lensH} bridge=${spec.bridge} temple=${spec.templeLen}  → ${path}`);
}
writeFileSync("public/models/param/index.json", JSON.stringify(entries, null, 2));
console.log(`\nwrote ${entries.length} frames + public/models/param/index.json`);
