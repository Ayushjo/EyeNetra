#!/usr/bin/env node
// Dump each GLB's primitives (material, alphaMode, vertex count, world bbox)
// so lens/rim/temple geometry can be audited numerically.
// Usage: node scripts/inspect-glb.mjs [public/models/x.glb ...]
import { readFileSync, readdirSync } from "node:fs";
import { Matrix4, Vector3, Box3, Quaternion } from "three";

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync("public/models").filter((f) => f.endsWith(".glb")).map((f) => `public/models/${f}`);

for (const file of files) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const bin = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + binLen);
  const readVec3 = (accIndex) => {
    const a = json.accessors[accIndex];
    const bv = json.bufferViews[a.bufferView];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || 12;
    const out = new Float32Array(a.count * 3);
    for (let k = 0; k < a.count; k++) {
      const b = base + k * stride;
      out[k * 3] = bin.readFloatLE(b);
      out[k * 3 + 1] = bin.readFloatLE(b + 4);
      out[k * 3 + 2] = bin.readFloatLE(b + 8);
    }
    return out;
  };
  const world = new Map();
  const walk = (ni, parent) => {
    const n = json.nodes[ni];
    const m = new Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else {
      const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      m.compose(new Vector3(...t), new Quaternion(...r), new Vector3(...s));
    }
    const w = parent.clone().multiply(m);
    if (n.mesh != null) world.set(ni, w);
    (n.children || []).forEach((c) => walk(c, w));
  };
  json.scenes[json.scene || 0].nodes.forEach((n) => walk(n, new Matrix4()));
  const rows = [];
  const all = new Box3();
  for (const [ni, w] of world) {
    const mesh = json.meshes[json.nodes[ni].mesh];
    for (const p of mesh.primitives) {
      const pos = readVec3(p.attributes.POSITION);
      const box = new Box3();
      const v = new Vector3();
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(w);
        box.expandByPoint(v);
      }
      all.union(box);
      const mat = json.materials[p.material] || {};
      rows.push({ mat: mat.name, alpha: mat.alphaMode || "OPAQUE", verts: pos.length / 3, box, mesh: mesh.name });
    }
  }
  const size = all.getSize(new Vector3());
  const f3 = (vec) => vec.toArray().map((x) => +x.toFixed(2)).join(",");
  console.log(`\n== ${file}  size=(${f3(size)}) min=(${f3(all.min)}) max=(${f3(all.max)})`);
  for (const r of rows) {
    // Normalized by total width so bboxes compare across models.
    const nmin = r.box.min.clone().sub(all.min).divideScalar(size.x);
    const nmax = r.box.max.clone().sub(all.min).divideScalar(size.x);
    console.log(`  ${String(r.mat).padEnd(24)} ${r.alpha.padEnd(6)} v=${String(r.verts).padEnd(6)} x[${nmin.x.toFixed(2)}..${nmax.x.toFixed(2)}] y[${nmin.y.toFixed(2)}..${nmax.y.toFixed(2)}] z[${nmin.z.toFixed(2)}..${nmax.z.toFixed(2)}]  ${r.mesh}`);
  }
}
