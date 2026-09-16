"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Vector3, type Group, type Mesh } from "three";
import { perspectiveHeadDepth, computePosePerspective } from "@/lib/fitPose";
import { FACE_TRIANGLES } from "@/lib/faceMesh";
import { setPosteriorCap, writeFaceSurface } from "@/lib/faceOcclusion";
import { useTryOnStore } from "@/store/tryOnStore";

/** The face and glasses inherit one filtered pose. The posterior cap is only
 * an approximation: MediaPipe's face landmarks do not include ears or hair.
 */
export function FaceMeshOccluder({ anchorRef }: { anchorRef: React.RefObject<Group | null> }) {
  const meshRef = useRef<Mesh>(null);
  const capRef = useRef<Mesh>(null);
  const inverse = useRef(new Matrix4());
  const vertex = useRef(new Vector3());
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(468 * 3), 3));
    g.setIndex(FACE_TRIANGLES);
    return g;
  }, []);

  // Per-frame hot path: 468 vertex updates; geometry/index buffers are reused.
  useFrame(() => {
    const mesh = meshRef.current;
    const cap = capRef.current;
    if (!mesh || !cap) return;
    mesh.visible = cap.visible = false;
    const state = useTryOnStore.getState();
    const { landmarks, hasFace, videoWidth, videoHeight, transformMatrix, renderMode, perspTune } = state;
    if (renderMode !== "perspective" || !hasFace || !landmarks || !anchorRef.current) return;
    const depth = perspectiveHeadDepth(transformMatrix);
    if (depth == null) return;
    const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    const fit = state.selectedFrame().fit;
    const pose = computePosePerspective({
      landmarks, transformMatrix, aspect, frameWidthMm: fit.frameWidthMm,
      scaleTune: (fit.perspScaleTune ?? 1) * perspTune.scaleTune,
      yOffsetCm: (fit.perspYOffsetCm ?? 0.8) + perspTune.yOffsetCm - 0.8,
      zOffsetCm: (fit.perspZOffsetCm ?? 0.6) + perspTune.zOffsetCm - 0.6,
    });
    if (!pose) return;
    inverse.current.compose(pose.position, pose.quaternion, vertex.current.setScalar(pose.scale)).invert();
    const attribute = geometry.getAttribute("position") as BufferAttribute;
    const positions = attribute.array as Float32Array;
    if (!writeFaceSurface(landmarks, depth, aspect, inverse.current, positions, vertex.current)) return;
    attribute.needsUpdate = true;
    setPosteriorCap(positions, cap.position, cap.scale);
    mesh.visible = cap.visible = true;
  });

  return (
    <>
      <mesh ref={meshRef} geometry={geometry} visible={false} renderOrder={0} frustumCulled={false}>
        <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
      </mesh>
      <mesh ref={capRef} visible={false} renderOrder={0} frustumCulled={false}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
      </mesh>
    </>
  );
}
