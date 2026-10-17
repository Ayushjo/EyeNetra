#!/usr/bin/env node
/**
 * Convert the CC0 "LowPoly Glasses Pack" by iPoly3D (opengameart.org/content/
 * lowpoly-glasses-pack) from OBJ/MTL to GLB for the try-on.
 *
 * Per model: parse v / vn / f (polygons fan-triangulated), group faces by
 * usemtl, take Kd as the base colour, and identify the LENS material: among
 * materials whose geometry stays near the front (z-span < 25 % of the model's
 * depth — temples run far back), the one with the largest XY-projected area
 * (lenses are filled panels; rims are thin). It is renamed "Lens"; the rest
 * keep their names. Units are left as authored (the loader width-normalizes).
 *
 * Usage: node scripts/convert-obj-frames.mjs <OBJ dir> <out dir> [name ...]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

function parseMtl(path) {
  const out = {};
  let cur = null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const [k, ...r] = line.trim().split(/\s+/);
    if (k === "newmtl") cur = out[r.join(" ")] = { kd: [0.8, 0.8, 0.8], d: 1 };
    else if (cur && k === "Kd") cur.kd = r.slice(0, 3).map(Number);
    else if (cur && k === "d") cur.d = Number(r[0]);
  }
  return out;
}

function parseObj(path) {
  const V = [], N = [];
  const groups = new Map(); // material -> { p: [], n: [] }
  let mat = "default";
  const g = () => groups.get(mat) ?? (groups.set(mat, { p: [], n: [] }), groups.get(mat));
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "v") V.push(t.slice(1, 4).map(Number));
    else if (t[0] === "vn") N.push(t.slice(1, 4).map(Number));
    else if (t[0] === "usemtl") mat = t.slice(1).join(" ");
    else if (t[0] === "f") {
      const verts = t.slice(1).map((s) => {
        const [vi, , ni] = s.split("/").map((x) => (x ? Number(x) : NaN));
        return { v: V[vi > 0 ? vi - 1 : V.length + vi], n: Number.isFinite(ni) ? N[ni > 0 ? ni - 1 : N.length + ni] : null };
      });
      for (let i = 1; i + 1 < verts.length; i++) {
        const tri = [verts[0], verts[i], verts[i + 1]];
        // Flat normal fallback when vn is missing.
        let fn = null;
        if (tri.some((x) => !x.n)) {
          const [a, b, c] = tri.map((x) => x.v);
          const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
          const l = Math.hypot(nx, ny, nz) || 1;
          fn = [nx / l, ny / l, nz / l];
        }
        for (const x of tri) { g().p.push(...x.v); g().n.push(...(x.n ?? fn)); }
      }
    }
  }
  return groups;
}

function detectLens(groups) {
  let zmin = Infinity, zmax = -Infinity;
  for (const { p } of groups.values()) for (let i = 2; i < p.length; i += 3) { zmin = Math.min(zmin, p[i]); zmax = Math.max(zmax, p[i]); }
  const depth = zmax - zmin;
  let best = null, bestArea = 0;
  for (const [name, { p }] of groups) {
    let lo = Infinity, hi = -Infinity, area = 0;
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 9; k += 3) { lo = Math.min(lo, p[i + k + 2]); hi = Math.max(hi, p[i + k + 2]); }
      const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1];
      area += Math.abs(ax * by - ay * bx) / 2;
    }
    if (hi - lo < 0.25 * depth && area > bestArea) { best = name; bestArea = area; }
  }
  return best;
}

function writeGlb(path, groups, mtl, lensName) {
  const bufs = [], views = [], accessors = [], meshes = [], nodes = [], materials = [];
  let off = 0;
  const push = (arr, target) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (off % 4)) % 4;
    if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; }
    bufs.push(b); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); off += b.length;
    return views.length - 1;
  };
  for (const [name, { p, n }] of groups) {
    if (!p.length) continue;
    const isLens = name === lensName;
    const m = mtl[name] ?? { kd: [0.8, 0.8, 0.8], d: 1 };
    materials.push(isLens
      ? { name: "Lens", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [...m.kd, 0.5], metallicFactor: 0, roughnessFactor: 0.1 } }
      : { name, pbrMetallicRoughness: { baseColorFactor: [...m.kd, 1], metallicFactor: 0, roughnessFactor: 0.45 } });
    const pos = new Float32Array(p), nrm = new Float32Array(n);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[i + a]); max[a] = Math.max(max[a], pos[i + a]); }
    const base = accessors.length;
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: push(nrm, 34962), componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    meshes.push({ name: isLens ? "Lens" : name, primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, material: materials.length - 1 }] });
    nodes.push({ name: isLens ? "Lens" : name, mesh: meshes.length - 1 });
  }
  const json = {
    asset: { version: "2.0", generator: "eyenetra-convert-obj-frames", copyright: "CC0 — LowPoly Glasses Pack by iPoly3D (opengameart.org)" },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: off }],
  };
  let js = JSON.stringify(json);
  while (js.length % 4) js += " ";
  const jb = Buffer.from(js);
  const bin = Buffer.concat([...bufs, Buffer.alloc((4 - (off % 4)) % 4)]);
  const h = Buffer.alloc(12); h.write("glTF", 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + jb.length + bin.length, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(jb.length, 0); jc.writeUInt32LE(0x4e4f534a, 4);
  const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length, 0); bc.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([h, jc, jb, bc, bin]));
}

const [, , inDir, outDir, ...only] = process.argv;
if (!inDir || !outDir) { console.error("usage: convert-obj-frames.mjs <OBJ dir> <out dir> [name ...]"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const files = readdirSync(inDir).filter((f) => f.endsWith(".obj")).sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7)));
for (const f of files) {
  const id = "lp-" + basename(f).match(/glasses(\d+)/)[1];
  if (only.length && !only.includes(id)) continue;
  const groups = parseObj(join(inDir, f));
  const mtl = parseMtl(join(inDir, f.replace(/\.obj$/, ".mtl")));
  const lens = detectLens(groups);
  writeGlb(join(outDir, `${id}.glb`), groups, mtl, lens);
  console.log(`${id.padEnd(6)} lens=${lens ?? "NONE"}  materials=${[...groups.keys()].join(", ")}`);
}
