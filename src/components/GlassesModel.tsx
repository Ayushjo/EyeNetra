"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  type Group,
  type Object3D,
} from "three";
import type { FrameSku, FrameVariant } from "@/data/frames";
import {
  frameTiltRad,
  solveTempleFold,
  type GlassesGeom,
} from "@/lib/headAnchors";
import { useTryOnStore } from "@/store/tryOnStore";

export function isLensName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("lens") ||
    n.includes("glass") ||
    n.includes("shade") ||
    n.includes("optic")
  );
}

export function applyVariant(
  mat: MeshStandardMaterial | MeshPhysicalMaterial,
  lens: boolean,
  variant: FrameVariant,
  depthTest: boolean,
  quality: "live" | "capture",
) {
  mat.side = DoubleSide;
  if (lens) {
    mat.color = new Color(variant.lensColor);
    mat.transparent = true;
    mat.opacity = Math.min(1, Math.max(0, variant.lensOpacity));
    mat.map = null; // Lens tint comes from the variant, not a baked opaque texture.
    mat.metalness = 0;
    mat.depthWrite = false;
    mat.depthTest = depthTest;
    if (mat instanceof MeshPhysicalMaterial || quality === "capture") {
      mat.metalness = 0;
      mat.roughness = 0.05;
      mat.envMapIntensity = quality === "capture" ? 0.85 : 0.55;
      if (mat instanceof MeshPhysicalMaterial) {
        mat.clearcoat = 0.25;
        mat.clearcoatRoughness = 0.08;
        mat.reflectivity = 0.3;
        mat.ior = 1.5;
        mat.thickness = 0.2;
      }
    } else {
      mat.metalness = 0.05;
      mat.roughness = 0.12;
      mat.envMapIntensity = 0.35;
    }
    return;
  }

  mat.color = new Color(variant.frameColor);
  mat.metalness = Math.min(1, Math.max(0, variant.metalness));
  mat.roughness = Math.max(0.22, variant.roughness);
  mat.envMapIntensity = quality === "capture" ? 1.1 : 0.45;
  mat.transparent = false;
  mat.opacity = 1;
  mat.depthWrite = depthTest;
  mat.depthTest = depthTest;
}

export type PivotDebug = {
  bboxCenter: [number, number, number];
  bboxSize: [number, number, number];
  /** Local offset for the child mesh under the face anchor (usually 0 after recenter). */
  localOffset: [number, number, number];
  /** Scanned geometry (normalized width-1 units) — null when the scan fell back. */
  geom: GlassesGeom | null;
};

/**
 * Scan the normalized model for the fit pivot and the hinge. Runs once per
 * GLB load.
 *
 * Fit pivot = centre of the LENS meshes (x centred, y = lens bbox centre,
 * z = lens front). This is the optician's pupil-height rule: the pupils sit
 * on (slightly above) the lens centre, whatever the frame shape — a thin-bar
 * aviator, a tall wraparound shield or a deep acetate square all fit the same
 * way. The previous "bridge top minus 7 mm" pivot hung the Sport and Studio
 * frames ~1.5 cm too high (lens bottoms on the eye line, live check 5 Oct).
 *
 * Returns null (callers fall back to the bbox pivot) when no lens mesh is
 * identified or the hinge band is empty.
 */
function scanGlassesGeom(
  root: Group,
  fit: FrameSku["fit"],
): GlassesGeom | null {
  root.updateMatrixWorld(true);
  const v = new Vector3();
  const lensBox = new Box3();
  let lensVerts = 0;
  const hingeSum = new Vector3();
  let hingeCount = 0;

  root.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh)) return;
    const pos = obj.geometry?.getAttribute?.("position");
    if (!pos) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const isLens = mats.some((m) =>
      fit.lensMaterialNames
        ? fit.lensMaterialNames.includes(m.name)
        : isLensName(m.name || obj.name || ""),
    );
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      if (isLens) {
        lensBox.expandByPoint(v);
        lensVerts++;
      }
      // Hinge band: outermost 6% of the width, within 0.3 widths of the
      // front plane (wraparounds hinge further back than flat fronts).
      if (Math.abs(v.x) > 0.44 && v.z > -0.3) {
        hingeSum.add(v.set(Math.abs(v.x), v.y, v.z));
        hingeCount++;
      }
    }
  });

  if (lensVerts < 12) {
    console.warn(
      `[EyeNetra:geom] fit scan fell back (lensVerts=${lensVerts}) — using bbox pivot`,
    );
    return null;
  }

  const center = lensBox.getCenter(new Vector3());
  // The fit pivot never depends on the hinge: if the hinge band is empty,
  // assume hinges level with the lens centre at the frame edge.
  const hinge =
    hingeCount > 0
      ? hingeSum.divideScalar(hingeCount)
      : new Vector3(0.5, center.y, lensBox.max.z - 0.05);
  if (hingeCount === 0) {
    console.warn(`[EyeNetra:geom] hinge band empty — assuming hinge at lens-centre height`);
  }
  return {
    bridgeLocal: { x: 0, y: center.y, z: lensBox.max.z },
    hingeLocal: { x: hinge.x, y: hinge.y, z: hinge.z },
    // Scale by the lens span when the SKU states it: the bbox width includes
    // hinge/end-piece flare, which over-sizes the front by 2–5 %.
    lensSpanNorm: lensBox.max.x - lensBox.min.x,
  };
}

/**
 * Orient once, width-normalize, then pin lens plane to z=0 with temples in -Z.
 *
 * Previous bug: picking front as argmax(|z|) flipped models that already had
 * temples in -Z (bbox.min.z more negative) → center.z ≈ +0.5 and temples
 * pointed at the camera. Always pin max.z → 0; if center is still +Z-heavy,
 * Y-rotate 180° once and re-pin.
 */
export function normalizeGlasses(
  root: Group,
  fit: FrameSku["fit"],
): PivotDebug {
  const modelEuler = fit.modelEuler;
  root.rotation.copy(
    new Euler(modelEuler[0], modelEuler[1], modelEuler[2], "XYZ"),
  );
  // Z=π uprights upside-down exports but swaps L/R — undo with scale.x.
  if (Math.abs(Math.abs(modelEuler[2]) - Math.PI) < 1e-3) {
    root.scale.x *= -1;
  }
  root.updateMatrixWorld(true);

  const box0 = new Box3().setFromObject(root);
  const size0 = new Vector3();
  box0.getSize(size0);
  const width = Math.max(size0.x, 1e-4);
  root.scale.multiplyScalar(1 / width);
  root.updateMatrixWorld(true);

  const pinFrontToZero = () => {
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const center = new Vector3();
    box.getCenter(center);
    // Lenses face +Z (toward camera). Pin the +Z face to the origin plane.
    root.position.x -= center.x;
    root.position.y -= center.y;
    root.position.z -= box.max.z;
    root.updateMatrixWorld(true);
  };

  pinFrontToZero();

  // If most of the mesh is still in +Z, temples are facing the camera — flip Y.
  {
    const box = new Box3().setFromObject(root);
    const center = new Vector3();
    box.getCenter(center);
    if (center.z > 0.05) {
      root.rotation.y += Math.PI;
      pinFrontToZero();
      console.info(
        "[EyeNetra:pivot] applied Y=π so temples face -Z (were pointing at camera)",
      );
    }
  }

  // Keep true temple length in the metric perspective path — the old 1.4×
  // stretch (added for the ortho ear-cards) made arms overshoot past the ear.
  const TEMPLE_DEPTH_MUL = 1.0;
  root.scale.z *= TEMPLE_DEPTH_MUL;
  root.updateMatrixWorld(true);

  // Bridge-anchored pivot: move the nose-pad contact point to the origin so
  // the anatomical seat anchor IS the contact point. Falls back to the bbox
  // pivot (front-center) when the scan can't find a plausible bridge.
  const override = fit.bridgeLocalOverride;
  let geom = scanGlassesGeom(root, fit);
  if (override) {
    geom = {
      bridgeLocal: { x: override[0], y: override[1], z: override[2] },
      hingeLocal: geom?.hingeLocal ?? { x: 0.5, y: override[1], z: 0 },
    };
  }
  if (geom) {
    root.position.x -= geom.bridgeLocal.x;
    root.position.y -= geom.bridgeLocal.y;
    root.position.z -= geom.bridgeLocal.z;
    root.updateMatrixWorld(true);
    // Express hinge relative to the new (contact-point) origin.
    geom = {
      ...geom,
      bridgeLocal: { x: 0, y: 0, z: 0 },
      hingeLocal: {
        x: geom.hingeLocal.x - geom.bridgeLocal.x,
        y: geom.hingeLocal.y - geom.bridgeLocal.y,
        z: geom.hingeLocal.z - geom.bridgeLocal.z,
      },
    };
  }

  const boxAfter = new Box3().setFromObject(root);
  const centerAfter = new Vector3();
  const sizeAfter = new Vector3();
  boxAfter.getCenter(centerAfter);
  boxAfter.getSize(sizeAfter);

  const debug: PivotDebug = {
    bboxCenter: [centerAfter.x, centerAfter.y, centerAfter.z],
    bboxSize: [sizeAfter.x, sizeAfter.y, sizeAfter.z],
    localOffset: [0, 0, 0],
    geom,
  };

  console.info(
    `[EyeNetra:pivot] after recenter bbox.center=(${centerAfter.x.toFixed(4)}, ${centerAfter.y.toFixed(4)}, ${centerAfter.z.toFixed(4)}) size=(${sizeAfter.x.toFixed(4)}, ${sizeAfter.y.toFixed(4)}, ${sizeAfter.z.toFixed(4)}) — expect x≈0 y≈0 z≤0 (temples back, depth×${TEMPLE_DEPTH_MUL})`,
  );

  return debug;
}

/**
 * Front-of-frame depth pull (cm, view space). Lenses and rims are moved this
 * far toward the camera ALONG THE VIEW RAY in the depth test only — the
 * projected pixel is unchanged. A lens physically cannot be inside the face,
 * but the generic canonical mask is wider/flatter than many faces, so its
 * cheeks and nose sides clipped lens edges (live 7 Oct). Only a face part
 * more than this far in front (the nose bridge over the far lens in a
 * profile turn) still hides the front. Only the lens footprint is pulled
 * (see prepareDeform); end pieces, hinges and wrap sides keep true depth.
 */
export const FRONT_DEPTH_PULL_CM = 1.2;

type DeformEntry = {
  /** Private clone of the GLB geometry — must be disposed on unmount. */
  geometry: BufferGeometry;
  attr: BufferAttribute;
  norm: Float32Array;
  fromNorm: Matrix4;
};
type Deform = {
  entries: DeformEntry[];
  /** Mean temple x per 0.02-wide z bin, per side (+x / −x). */
  binsPos: Map<number, TempleBin>;
  binsNeg: Map<number, TempleBin>;
};
type TempleBin = { sum: number; sumY: number; n: number };
const TEMPLE_BIN = 0.02;

function templeXAt(deform: Deform, side: 1 | -1, z: number): number | null {
  const bins = side > 0 ? deform.binsPos : deform.binsNeg;
  const k = Math.floor(-z / TEMPLE_BIN);
  for (const d of [0, -1, 1, -2, 2]) {
    const b = bins.get(k + d);
    if (b && b.n > 0) return b.sum / b.n;
  }
  return null;
}

/**
 * Per-mesh private geometry (the GLTF cache is shared across instances),
 * normalized-space vertex copies for the temple fold, and the aFront weight
 * attribute for the depth pull.
 */
function prepareDeform(root: Group, geom: GlassesGeom | null): Deform {
  root.updateMatrixWorld(true);
  const hz = geom?.hingeLocal.z ?? -0.05;
  const lensHalf = geom?.lensSpanNorm ? geom.lensSpanNorm / 2 : 0.42;
  const entries: DeformEntry[] = [];
  const binsPos = new Map<number, TempleBin>();
  const binsNeg = new Map<number, TempleBin>();
  const v = new Vector3();
  root.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh) || !obj.geometry?.getAttribute?.("position")) return;
    obj.geometry = obj.geometry.clone();
    const attr = obj.geometry.getAttribute("position") as BufferAttribute;
    const norm = new Float32Array(attr.count * 3);
    const front = new Float32Array(attr.count);
    const templeZ = new Float32Array(attr.count);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(obj.matrixWorld);
      v.toArray(norm, i * 3);
      // Pull only the lens footprint: inside the lens span (fading over
      // 0.04 widths past it) and within ~1 cm of the front plane. Keying it to
      // the hinge pulled deep end pieces / wrap sides over the face on turns
      // (live 7 Oct: far hinge drawn over the eye on Wayfarer/Studio, Sport
      // wrap never tucked behind the cheek — hinges 2–3 cm back).
      const wz = Math.min(1, Math.max(0, (v.z + 0.07) / 0.04));
      const wx = Math.min(1, Math.max(0, (lensHalf + 0.04 - Math.abs(v.x)) / 0.04));
      front[i] = wz * wx;
      // Pre-fold depth of temple vertices for the behind-the-ear fade (10 =
      // not a temple → never faded).
      templeZ[i] = Math.abs(v.x) > 0.25 && v.z < hz - 0.02 ? v.z : 10;
      if (Math.abs(v.x) > 0.25 && v.z < hz - 0.02) {
        const bins = v.x > 0 ? binsPos : binsNeg;
        const k = Math.floor(-v.z / TEMPLE_BIN);
        const b = bins.get(k) ?? { sum: 0, sumY: 0, n: 0 };
        b.sum += v.x;
        b.sumY += v.y;
        b.n++;
        bins.set(k, b);
      }
    }
    obj.geometry.setAttribute("aFront", new BufferAttribute(front, 1));
    obj.geometry.setAttribute("aTempleZ", new BufferAttribute(templeZ, 1));
    entries.push({ geometry: obj.geometry, attr, norm, fromNorm: obj.matrixWorld.clone().invert() });
  });
  return { entries, binsPos, binsNeg };
}

/**
 * Temple centreline from the per-depth bins, both sides averaged (|x|), z
 * descending from the hinge. Bins with too few vertices are skipped.
 */
function templeProfileFrom(deform: Deform): NonNullable<GlassesGeom["templeProfile"]> {
  const keys = [...new Set([...deform.binsPos.keys(), ...deform.binsNeg.keys()])].sort((a, b) => a - b);
  const z: number[] = [], x: number[] = [], y: number[] = [];
  for (const k of keys) {
    const p = deform.binsPos.get(k), n = deform.binsNeg.get(k);
    const parts = [p, n].filter((b): b is TempleBin => Boolean(b && b.n >= 2));
    if (!parts.length) continue;
    const cnt = parts.reduce((a, b) => a + b.n, 0);
    z.push(-(k + 0.5) * TEMPLE_BIN);
    x.push(parts.reduce((a, b) => a + Math.abs(b.sum), 0) / cnt);
    y.push(parts.reduce((a, b) => a + b.sumY, 0) / cnt);
  }
  return { z, x, y };
}

/** Rotate a temple point about its hinge's vertical axis (smooth over ~0.05 widths). */
function foldPoint(
  x: number,
  z: number,
  hinge: { x: number; z: number },
  fold: { pos: number; neg: number },
): [number, number] {
  const hz = hinge.z;
  const t = Math.min(1, Math.max(0, (hz - 0.005 - z) / 0.055));
  const a = (x > 0 ? fold.pos : fold.neg) * t * t * (3 - 2 * t);
  const hx = Math.sign(x) * Math.abs(hinge.x);
  const dx = x - hx, dz = z - hz;
  const c = Math.cos(a), s = Math.sin(a);
  return [hx + dx * c + dz * s, hz - dx * s + dz * c];
}

/**
 * Head-side occluder that hugs the temples. MediaPipe's face mesh stops at
 * the temple/hairline, so between the face edge and the ear nothing hid the
 * far temple on a turn (head-local: hinge x≈7.6 cm vs mesh edge 6.9 cm, live
 * 7 Oct). Real temples rest ON the side of the head, so model that surface:
 * a depth-only wall INSET just inside each (folded) temple, from behind the
 * hinge to the temple end. From the far side it hides the temple like the
 * skull does; from the near side the temple stays in front of it. Derived
 * from the frame itself, so it cannot be too narrow (temple leaks) or too
 * wide (near temple hidden) for a given face/frame — the failure modes of a
 * generic head proxy (cf. WebAR.rocks occluder.glb, Snap "mask head sides").
 */
const WALL_INSET = 0.02; // ~3 mm at a 15 cm frame
const WALL_HALF_HEIGHT = 0.12; // ~1.8 cm above/below the temple
export function buildTempleWalls(
  deform: Deform,
  hinge: { x: number; z: number },
  fold: { pos: number; neg: number },
): BufferGeometry | null {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1] as const) {
    const bins = side > 0 ? deform.binsPos : deform.binsNeg;
    const keys = [...bins.keys()].sort((a, b) => a - b);
    const start = Math.floor(-(hinge.z - 0.015) / TEMPLE_BIN);
    const cols: number[] = [];
    for (const k of keys) {
      if (k < start) continue;
      const b = bins.get(k)!;
      const z0 = -(k + 0.5) * TEMPLE_BIN;
      const [x, z] = foldPoint(b.sum / b.n, z0, hinge, fold);
      const y = b.sumY / b.n;
      cols.push(pos.length / 3);
      pos.push(x - side * WALL_INSET, y + WALL_HALF_HEIGHT, z);
      pos.push(x - side * WALL_INSET, y - WALL_HALF_HEIGHT, z);
    }
    for (let i = 0; i + 1 < cols.length; i++) {
      const a = cols[i], b = cols[i + 1];
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  if (!idx.length) return null;
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function applyTempleFold(
  deform: Deform,
  hinge: { x: number; z: number },
  fold: { pos: number; neg: number },
) {
  const v = new Vector3();
  const hz = hinge.z;
  for (const { attr, norm, fromNorm } of deform.entries) {
    for (let i = 0; i < attr.count; i++) {
      let x = norm[i * 3];
      const y = norm[i * 3 + 1];
      let z = norm[i * 3 + 2];
      if (Math.abs(x) > 0.25 && z < hz - 0.005) [x, z] = foldPoint(x, z, hinge, fold);
      v.set(x, y, z).applyMatrix4(fromNorm);
      attr.setXYZ(i, v.x, v.y, v.z);
    }
    attr.needsUpdate = true;
  }
}

/**
 * Behind-the-ear temple fade (Jeeliz/WebAR.rocks do the same: their shaders
 * smoothstep temple alpha by model-space z, e.g. WebAR.rocks VTOGlasses
 * branchFadingZ −0.9 / transition 0.6). The ear is not tracked, so the tip
 * is always a guess; fading it reads better than a visibly wrong tip.
 * uFade = (start, end) in normalized glasses z: Meta's fixed 10→11 cm band.
 */
export const TEMPLE_FADE_START_CM = 10;
export const TEMPLE_FADE_END_CM = 11;
export type GlassesUniforms = { uFade: { value: Vector2 } };

function installDepthPull(
  mat: MeshStandardMaterial | MeshPhysicalMaterial,
  shared: GlassesUniforms,
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDepthPull = { value: FRONT_DEPTH_PULL_CM };
    shader.uniforms.uFade = shared.uFade;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vTempleFade;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\ngl_FragColor.a *= vTempleFade;",
      );
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aFront;\nattribute float aTempleZ;\nuniform float uDepthPull;\nuniform vec2 uFade;\nvarying float vTempleFade;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvTempleFade = aTempleZ > 5.0 ? 1.0 : smoothstep(uFade.y, uFade.x, aTempleZ);",
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          float eyeDist = length(mvPosition.xyz);
          if (eyeDist > 1e-3 && aFront > 0.0) {
            vec4 pulled = vec4(mvPosition.xyz * max(0.05, 1.0 - uDepthPull * aFront / eyeDist), 1.0);
            vec4 clip = projectionMatrix * pulled;
            gl_Position.z = clip.z / clip.w * gl_Position.w;
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => "eyenetra-depth-pull";
  mat.needsUpdate = true;
}

export function GlassesModel({
  glbPath,
  variant,
  fit,
  quality = "live",
  onPivotDebug,
}: {
  glbPath: string;
  variant: FrameVariant;
  fit: FrameSku["fit"];
  quality?: "live" | "capture";
  onPivotDebug?: (info: PivotDebug) => void;
}) {
  const { scene } = useGLTF(glbPath);
  const depthTest = true;
  // depthTest on so ear occluder cards can hide temple tips behind ears.
  // (Full face-oval occluder is gone — it culled temples at the hinges.)
  const logged = useRef(false);

  const { cloned, pivot, deform } = useMemo(() => {
    const root = scene.clone(true) as Group;
    const pivotInfo = normalizeGlasses(root, fit);
    const deformInfo = prepareDeform(root, pivotInfo.geom);
    if (pivotInfo.geom) {
      pivotInfo.geom = { ...pivotInfo.geom, templeProfile: templeProfileFrom(deformInfo) };
    }
    return { cloned: root, pivot: pivotInfo, deform: deformInfo };
  }, [scene, fit]);

  // Temple fold: aim each temple at the user's ear-rest point. Recomputed only
  // when anchors / calibration / SKU change — positions rewritten on the CPU.
  const headAnchors = useTryOnStore((s) => s.headAnchors);
  const glassesUniforms = useMemo<GlassesUniforms>(
    () => ({ uFade: { value: new Vector2(-10, -11) } }),
    [],
  );
  const [walls, setWalls] = useState<BufferGeometry | null>(null);
  const wallMaterial = useMemo(
    () => new MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: DoubleSide }),
    [],
  );
  useEffect(() => () => wallMaterial.dispose(), [wallMaterial]);
  // Free the per-instance geometry clones on unmount / SKU change. Without
  // this every frame or colour switch leaked GPU buffers (the voice flow
  // switches frames constantly) until the browser dropped the WebGL context
  // and the try-on froze on its last image.
  useEffect(() => () => deform.entries.forEach((e) => e.geometry.dispose()), [deform]);
  useEffect(() => () => walls?.dispose(), [walls]);
  const scaleCorrection = useTryOnStore((s) => s.cameraCalib.scaleCorrection);
  useEffect(() => {
    const geom = pivot.geom;
    if (!geom || !deform.binsPos.size || !deform.binsNeg.size) return;
    const widthMm =
      fit.lensSpanMm && geom.lensSpanNorm && geom.lensSpanNorm > 0.2
        ? fit.lensSpanMm / geom.lensSpanNorm
        : fit.frameWidthMm;
    const scaleCm = (widthMm / 10) * (scaleCorrection || 1) * (fit.perspScaleTune ?? 1);
    const pantoRad = frameTiltRad(fit);
    const fold = solveTempleFold({
      anchors: headAnchors,
      hinge: geom.hingeLocal,
      templeXAt: (side, z) => templeXAt(deform, side, z),
      scaleCm,
      pantoRad,
      nosePadOffsetMm: fit.nosePadOffsetMm,
    });
    applyTempleFold(deform, geom.hingeLocal, fold);
    // Meta's fixed fade band: 10 → 11 cm behind the lens front (their
    // TEMPLE_ARM_FADE_START/END_DEPTH −0.10/−0.11 at glasses scale 100),
    // converted to this model's normalized units with the rendered scale.
    glassesUniforms.uFade.value.set(
      -TEMPLE_FADE_START_CM / scaleCm,
      -TEMPLE_FADE_END_CM / scaleCm,
    );
    setWalls((prev) => {
      prev?.dispose();
      return buildTempleWalls(deform, geom.hingeLocal, fold);
    });
    console.info(
      `[EyeNetra:fold] ${glbPath} temples +x ${((fold.pos * 180) / Math.PI).toFixed(1)}° −x ${((fold.neg * 180) / Math.PI).toFixed(1)}°`,
    );
  }, [deform, pivot, fit, headAnchors, scaleCorrection, glbPath]);

  useEffect(() => {
    onPivotDebug?.(pivot);
  }, [pivot, onPivotDebug]);

  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    const [ex, ey, ez] = fit.modelEuler;
    console.info(
      `[EyeNetra:glb] ${glbPath} modelEuler=[${ex}, ${ey}, ${ez}]` +
        (Math.abs(Math.abs(ez) - Math.PI) < 1e-3
          ? " (Z=π upright + scale.x flip)"
          : " (identity)") +
        ` pivot bbox.center=`,
      pivot.bboxCenter,
    );
  }, [glbPath, fit.modelEuler, pivot]);

  useEffect(() => {
    const owned: (MeshStandardMaterial | MeshPhysicalMaterial)[] = [];
    cloned.traverse((obj: Object3D) => {
      if (!(obj instanceof Mesh)) return;
      const name = obj.name || "";
      obj.renderOrder = 10;
      obj.frustumCulled = false;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let meshHasLens = false;
      mats.forEach((mat, i) => {
        const lens = fit.lensMaterialNames
          ? fit.lensMaterialNames.includes(mat.name)
          : isLensName(mat.name || name);
        if (lens) meshHasLens = true;
        const usePhysical = lens;
        let next: MeshStandardMaterial | MeshPhysicalMaterial;
        if (usePhysical) {
          next = new MeshPhysicalMaterial();
          if (mat instanceof MeshStandardMaterial) {
            next.map = mat.map;
            next.normalMap = mat.normalMap;
          }
        } else if (mat instanceof MeshStandardMaterial) {
          next = mat.clone();
        } else if (mat instanceof MeshBasicMaterial) {
          next = new MeshStandardMaterial({ color: mat.color.clone() });
        } else {
          next = new MeshStandardMaterial();
        }
        next.name = mat.name;
        // Authored transparency outside the lens list is only trusted for
        // nose pads: the round frame's GLB ships its TEMPLES as a BLEND
        // material, which rendered them see-through (scripts/inspect-glb.mjs
        // material_2 z[0.00..0.48]). Everything else gets the frame finish.
        const keepTransparent =
          !lens && mat.transparent && /transparent|pad|nose/i.test(mat.name || name);
        // Hardware (hinges, rivets, metal temple tips) authored with
        // extras.keepAuthored keeps its own finish instead of the variant tint.
        const keepAuthored = !lens && Boolean(mat.userData?.keepAuthored);
        if (keepAuthored) {
          next.side = DoubleSide;
          next.envMapIntensity = quality === "capture" ? 1.1 : 0.6;
          next.depthWrite = depthTest;
          next.depthTest = depthTest;
        } else if (!keepTransparent) applyVariant(next, lens, variant, depthTest, quality);
        installDepthPull(next, glassesUniforms);
        // Frame finish is opaque but drawn in the transparent pass so the
        // temple fade can blend; drawn before the lens (renderOrder 9 < 10).
        if (!lens && !keepTransparent) {
          next.transparent = true;
          next.depthWrite = depthTest;
        }
        owned.push(next);
        if (Array.isArray(obj.material)) obj.material[i] = next;
        else obj.material = next;
      });
      // Frame meshes before lens meshes (both in the transparent pass).
      obj.renderOrder = meshHasLens ? 10 : 9;
    });
    return () => owned.forEach(mat => mat.dispose());
  }, [cloned, variant, depthTest, quality, fit.lensMaterialNames]);

  return (
    <>
      <primitive object={cloned} />
      {walls ? (
        <mesh geometry={walls} material={wallMaterial} renderOrder={1} frustumCulled={false} />
      ) : null}
    </>
  );
}

useGLTF.preload("/models/aviator-sunglasses.glb");
useGLTF.preload("/models/glasses-round-frame.glb");
useGLTF.preload("/models/sport-glasses-b307.glb");
useGLTF.preload("/models/ai-generated-frames.glb");

/**
 * Warm the GLTF cache with every catalogue frame, one file per idle slot, so
 * a frame the voice assistant picks is already parsed when it is shown
 * (measured: an uncached swap left the face without glasses until the file
 * loaded). Order: FRAMES order (the four showroom
 * models are already preloaded above).
 */
export function preloadCatalogueModels(paths: string[]) {
  if (typeof window === "undefined") return;
  const queue = [...new Set(paths)];
  const idle: (cb: () => void) => void =
    "requestIdleCallback" in window
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 200);
  const next = () => {
    const path = queue.shift();
    if (!path) return;
    useGLTF.preload(path);
    idle(next);
  };
  idle(next);
}
