"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import {
  Box3,
  Color,
  DoubleSide,
  Euler,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector3,
  type Group,
  type Object3D,
} from "three";
import type { FrameSku, FrameVariant } from "@/data/frames";
import type { GlassesGeom } from "@/lib/headAnchors";

function isLensName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("lens") ||
    n.includes("glass") ||
    n.includes("shade") ||
    n.includes("optic")
  );
}

function applyVariant(
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
function normalizeGlasses(
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

  const { cloned, pivot } = useMemo(() => {
    const root = scene.clone(true) as Group;
    const pivotInfo = normalizeGlasses(root, fit);
    return { cloned: root, pivot: pivotInfo };
  }, [scene, fit]);

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
      mats.forEach((mat, i) => {
        const lens = fit.lensMaterialNames
          ? fit.lensMaterialNames.includes(mat.name)
          : isLensName(mat.name || name);
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
        owned.push(next);
        if (Array.isArray(obj.material)) obj.material[i] = next;
        else obj.material = next;
      });
    });
    return () => owned.forEach(mat => mat.dispose());
  }, [cloned, variant, depthTest, quality, fit.lensMaterialNames]);

  return <primitive object={cloned} />;
}

useGLTF.preload("/models/aviator-sunglasses.glb");
useGLTF.preload("/models/glasses-round-frame.glb");
useGLTF.preload("/models/sport-glasses-b307.glb");
useGLTF.preload("/models/ai-generated-frames.glb");
