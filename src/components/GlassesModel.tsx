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
  name: string,
  variant: FrameVariant,
  depthTest: boolean,
  quality: "live" | "capture",
) {
  mat.side = DoubleSide;
  if (isLensName(name)) {
    mat.color = new Color(variant.lensColor);
    mat.transparent = true;
    mat.opacity = Math.min(0.55, Math.max(0.22, variant.lensOpacity));
    mat.depthWrite = false;
    mat.depthTest = depthTest;
    if (mat instanceof MeshPhysicalMaterial || quality === "capture") {
      mat.metalness = 0;
      mat.roughness = 0.05;
      mat.envMapIntensity = 1.35;
      if (mat instanceof MeshPhysicalMaterial) {
        mat.clearcoat = 1;
        mat.clearcoatRoughness = 0.08;
        mat.reflectivity = 0.6;
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
  mat.metalness = Math.min(0.55, Math.max(0.15, variant.metalness));
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
};

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
  modelEuler: [number, number, number],
): PivotDebug {
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

  const boxAfter = new Box3().setFromObject(root);
  const centerAfter = new Vector3();
  const sizeAfter = new Vector3();
  boxAfter.getCenter(centerAfter);
  boxAfter.getSize(sizeAfter);

  const debug: PivotDebug = {
    bboxCenter: [centerAfter.x, centerAfter.y, centerAfter.z],
    bboxSize: [sizeAfter.x, sizeAfter.y, sizeAfter.z],
    localOffset: [0, 0, 0],
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
    const pivotInfo = normalizeGlasses(root, fit.modelEuler);
    return { cloned: root, pivot: pivotInfo };
  }, [scene, fit.modelEuler]);

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
    cloned.traverse((obj: Object3D) => {
      if (!(obj instanceof Mesh)) return;
      const name = obj.name || "";
      obj.renderOrder = 10;
      obj.frustumCulled = false;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat, i) => {
        const usePhysical = quality === "capture" && isLensName(name);
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
        applyVariant(next, name, variant, depthTest, quality);
        if (Array.isArray(obj.material)) obj.material[i] = next;
        else obj.material = next;
      });
    });
  }, [cloned, variant, depthTest, quality]);

  return <primitive object={cloned} />;
}

useGLTF.preload("/models/aviator-sunglasses.glb");
useGLTF.preload("/models/glasses-round-frame.glb");
useGLTF.preload("/models/sport-glasses-b307.glb");
useGLTF.preload("/models/ai-generated-frames.glb");
