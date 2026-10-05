#!/usr/bin/env node
// One-time extraction of head-local metric vertex positions from MediaPipe's
// canonical_face_model.obj (Apache-2.0) for src/lib/canonicalFace.ts.
// Usage: node scripts/extract-canonical-face.mjs path/to/canonical_face_model.obj
import { readFileSync } from "node:fs";

const WANTED = [1, 4, 6, 10, 33, 93, 127, 133, 152, 168, 195, 197, 234, 263, 323, 356, 362, 454];
const text = readFileSync(process.argv[2], "utf8");
const verts = [];
for (const line of text.split("\n")) {
  if (line.startsWith("v ")) {
    const [, x, y, z] = line.trim().split(/\s+/);
    verts.push([Number(x), Number(y), Number(z)]);
  }
}
console.log(`// ${verts.length} vertices total`);
for (const i of WANTED) {
  const [x, y, z] = verts[i];
  console.log(`  ${i}: [${x}, ${y}, ${z}],`);
}
