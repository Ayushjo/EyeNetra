"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Quaternion, Vector3, type Mesh } from "three";
import { landmarkToWorld } from "@/lib/coords";
import { LM } from "@/lib/mediapipe/constants";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Head-shaped depth occluder (replaces the old flat ear cards).
 *
 * Why an ellipsoid, not a flat card or a face-oval disc:
 *  - A flat 2D card at the ears has no depth, so it either culls the temple at
 *    the hinge (too far forward) or does nothing (too far back).
 *  - A filled face-oval disc covers the hinge silhouette and stubs the temples.
 *  - A real 3D head volume, posed with the head, occludes exactly what a real
 *    head would: the FAR temple (behind the head) disappears, the NEAR temple
 *    and the front lenses stay visible — at every yaw, automatically.
 *
 * Depth-only (colorWrite off): it writes depth but no pixels, so the webcam
 * face still shows through; it only hides glasses geometry that sits behind it.
 * Rendered before the glasses (renderOrder 0 < 10) so depth is laid down first.
 *
 * Per-frame (perf-sensitive): one landmark→world, one quaternion copy, one
 * transform write. No allocation in the loop.
 */
export function FaceOccluder() {
  const meshRef = useRef<Mesh>(null);
  const anchor = useRef(new Vector3());
  const quat = useRef(new Quaternion());
  const tmp = useRef(new Vector3());

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const { landmarks, hasFace, videoWidth, videoHeight, trackingFrame } =
      useTryOnStore.getState();
    if (!hasFace || !landmarks || landmarks.length < 468 || !trackingFrame) {
      mesh.visible = false;
      return;
    }

    const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    const scale = trackingFrame.scale > 0 ? trackingFrame.scale : 0.7;

    // Anchor on the mid-eye / bridge — same source the glasses fit uses, so the
    // occluder and frames share one coordinate origin (no relative drift).
    const midLm =
      landmarks[LM.MID_EYES] ?? landmarks[LM.NOSE_BRIDGE] ?? landmarks[LM.NOSE_TIP];
    if (!midLm) {
      mesh.visible = false;
      return;
    }
    const mid = landmarkToWorld(midLm, aspect);
    anchor.current.set(mid.x, mid.y, mid.z);

    // Head orientation from the real face matrix (already mirrored for video).
    const r = trackingFrame.rotation;
    quat.current.set(r.x, r.y, r.z, r.w).normalize();

    // Ellipsoid half-extents in scene units, proportional to fit scale.
    // Wider than the lenses (cover cheeks/ears), tall enough for brow→jaw,
    // deep enough that temple tips fall behind the back pole.
    const rx = 0.62 * scale; // half head width
    const ry = 0.82 * scale; // half head height
    const rz = 0.85 * scale; // half head depth (front↔back)

    // Push the ellipsoid back along the head's own forward axis so its FRONT
    // pole sits just behind the lens plane: lenses/near-temple stay visible,
    // everything deeper (far temple, arms behind ears) is occluded.
    // Head forward (+Z of the head) rotated into scene space:
    tmp.current.set(0, 0, 1).applyQuaternion(quat.current);
    const frontBias = 0.16 * scale; // lens plane clearance in front of the head
    mesh.position.copy(anchor.current).addScaledVector(tmp.current, frontBias - rz);

    mesh.quaternion.copy(quat.current);
    mesh.scale.set(rx, ry, rz);
    mesh.visible = true;
  });

  return (
    <mesh ref={meshRef} renderOrder={0} frustumCulled={false}>
      <sphereGeometry args={[1, 24, 18]} />
      <meshBasicMaterial colorWrite={false} depthWrite depthTest />
    </mesh>
  );
}
