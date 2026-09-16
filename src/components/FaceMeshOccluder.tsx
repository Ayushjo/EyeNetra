"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, type Mesh } from "three";
import { PERSPECTIVE_FOV_DEG, perspectiveHeadDepth } from "@/lib/fitPose";
import { delaunay, type P2 } from "@/lib/faceMesh";
import { LM } from "@/lib/mediapipe/constants";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Real face-mesh depth occluder (perspective mode only).
 *
 * Builds a solid surface from MediaPipe's 468 landmarks, unprojected into the
 * SAME metric perspective space the glasses use (head depth from the transform
 * matrix), so it hugs the actual face. Rendered depth-only (colorWrite off): it
 * writes depth but no pixels, so the webcam face shows through and any glasses
 * geometry that passes BEHIND the face — the far temple on a turn, the arm as it
 * reaches the ear — is culled exactly where a real face would hide it.
 *
 * Topology (triangle indices) is computed once and reused; only vertex depths
 * update per frame. It is independent of the selected glasses model, so it works
 * for every frame in the catalog and every new one added.
 *
 * Perf: one unproject per landmark per frame (468), no allocation in the loop.
 */

const N = 478; // MediaPipe face landmark count (with iris)
const DEPTH_SCALE = 26; // normalized-z → cm doming. Lower = flatter surface,
// which avoids stray forward vertex spikes that chop the thin temple arm into a
// dashed line as it crosses the face edge.
const MESH_BIAS = 0.5; // cm: push the mesh slightly back so it never eats the
// frame front (glasses sit a touch in front of the face).

export function FaceMeshOccluder() {
  const meshRef = useRef<Mesh>(null);
  const indexReady = useRef(false);
  const posArr = useRef<Float32Array>(new Float32Array(N * 3));

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(posArr.current, 3));
    return g;
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { landmarks, hasFace, videoWidth, videoHeight, transformMatrix, renderMode } =
      useTryOnStore.getState();

    if (
      renderMode !== "perspective" ||
      !hasFace ||
      !landmarks ||
      landmarks.length < 468 ||
      !transformMatrix
    ) {
      mesh.visible = false;
      return;
    }

    const depth = perspectiveHeadDepth(transformMatrix);
    if (depth == null) {
      mesh.visible = false;
      return;
    }

    const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    const tanHalf = Math.tan((PERSPECTIVE_FOV_DEG * Math.PI) / 180 / 2);
    const midEye = landmarks[LM.MID_EYES] ?? landmarks[LM.NOSE_BRIDGE];
    const midZ = midEye ? midEye.z : 0;

    // Compute the triangulation once from the first (front-ish) frame.
    if (!indexReady.current) {
      const p2: P2[] = new Array(N);
      for (let i = 0; i < N; i++) {
        const lm = landmarks[i];
        p2[i] = lm ? { x: 0.5 - lm.x, y: 0.5 - lm.y } : { x: 0, y: 0 };
      }
      const idx = delaunay(p2);
      if (idx.length >= 3) {
        geometry.setIndex(idx);
        indexReady.current = true;
      } else {
        mesh.visible = false;
        return;
      }
    }

    const arr = posArr.current;
    for (let i = 0; i < N; i++) {
      const lm = landmarks[i];
      const base = i * 3;
      if (!lm) {
        arr[base] = 0;
        arr[base + 1] = 0;
        arr[base + 2] = -depth;
        continue;
      }
      const di = depth + (lm.z - midZ) * DEPTH_SCALE + MESH_BIAS;
      const ndcX = (0.5 - lm.x) * 2; // mirrored to match the flipped video
      const ndcY = (0.5 - lm.y) * 2;
      arr[base] = ndcX * di * tanHalf * aspect;
      arr[base + 1] = ndcY * di * tanHalf;
      arr[base + 2] = -di;
    }
    (geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();
    mesh.visible = true;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} renderOrder={0} frustumCulled={false}>
      <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
    </mesh>
  );
}
