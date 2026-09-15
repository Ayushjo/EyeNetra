"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DoubleSide, Mesh, type Group } from "three";
import { landmarkToWorld } from "@/lib/coords";
import { LM } from "@/lib/mediapipe/constants";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Why NOT a filled face oval:
 * Ortho overlay keeps temple XY ≈ hinge XY while Z goes into the head.
 * A face-disc occluder covers that silhouette, so depth-test kills temples
 * at the hinges → stubs near the eyes (what we saw in screenshots).
 *
 * Fix: depth-only cards localized at the ears. Temples stay visible from
 * hinge → ear, then cull only where they pass behind the ear/hair region.
 *
 * Per-frame (perf-sensitive): landmark → world, place/scale two planes.
 */
function EarCard({
  meshRef,
}: {
  meshRef: React.RefObject<Mesh | null>;
}) {
  return (
    <mesh ref={meshRef} renderOrder={0} frustumCulled={false}>
      <circleGeometry args={[1, 28]} />
      <meshBasicMaterial
        colorWrite={false}
        depthWrite
        depthTest
        side={DoubleSide}
      />
    </mesh>
  );
}

export function FaceOccluder() {
  const groupRef = useRef<Group>(null);
  const leftRef = useRef<Mesh>(null);
  const rightRef = useRef<Mesh>(null);

  useFrame(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const { landmarks, hasFace, videoWidth, videoHeight, trackingFrame } =
      useTryOnStore.getState();
    if (!hasFace || !landmarks || landmarks.length < 455) {
      left.visible = false;
      right.visible = false;
      return;
    }

    const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    const faceScale = trackingFrame?.scale ?? 0.7;

    const place = (
      mesh: Mesh,
      earIdx: number,
      eyeOuterIdx: number,
    ) => {
      const earLm = landmarks[earIdx];
      const eyeLm = landmarks[eyeOuterIdx];
      if (!earLm) {
        mesh.visible = false;
        return;
      }
      const ear = landmarkToWorld(earLm, aspect);
      const eye = eyeLm ? landmarkToWorld(eyeLm, aspect) : null;

      // Card centered on ear, slightly toward the eye so the temple tip
      // tucks behind the ear rather than stopping short of it.
      let x = ear.x;
      let y = ear.y;
      if (eye) {
        x = ear.x * 0.85 + eye.x * 0.15;
        y = ear.y * 0.9 + eye.y * 0.1;
      }

      // Ear depth — behind glasses front (z≈0.12), in front of temple tips.
      // Clamp so we never wipe the lens plane when leaning in.
      const z = Math.min(ear.z - 0.04, 0.04);

      // Cover ear + hair tuck; ~0.55 of hinge→ear span, floored by face scale.
      const span = eye
        ? Math.hypot(ear.x - eye.x, ear.y - eye.y)
        : faceScale * 0.35;
      const radius = Math.max(0.1, Math.min(0.28, span * 0.55, faceScale * 0.38));

      mesh.visible = true;
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(radius);
      // Face camera (ortho): card is a depth stamp in screen space at the ear.
      mesh.rotation.set(0, 0, 0);
    };

    // Landmark indices are in image space; landmarkToWorld mirrors for CSS flip.
    // 234 = subject left ear region, 454 = subject right.
    place(left, LM.LEFT_EAR, LM.LEFT_EYE_OUTER);
    place(right, LM.RIGHT_EAR, LM.RIGHT_EYE_OUTER);
  });

  return (
    <group ref={groupRef}>
      <EarCard meshRef={leftRef} />
      <EarCard meshRef={rightRef} />
    </group>
  );
}
