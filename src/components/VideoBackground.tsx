"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, SRGBColorSpace } from "three";
import { getFrameSeq, getFrameSyncCanvas, setGlBackgroundActive } from "@/tracking/frameSync";

/** Distance of the background quad from the camera (inside far = 10000). */
const BACKGROUND_DEPTH = 5000;

/**
 * The analysed video frame drawn inside the 3D scene, behind everything, in
 * the same render pass as the glasses (Meta's try-on renders its video as a
 * plane in the scene). Uploaded only when a new frame was presented, so the
 * picture and the pose computed on it always reach the screen together.
 * Mirrored to match the selfie view; not tone-mapped (true video colours).
 */
export function VideoBackground() {
  const camera = useThree((s) => s.camera);
  const meshRef = useRef<Mesh>(null);
  const textureRef = useRef<CanvasTexture | null>(null);
  const lastSeq = useRef(-1);
  const material = useMemo(
    () => new MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false }),
    [],
  );
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);

  useEffect(
    () => () => {
      setGlBackgroundActive(false);
      textureRef.current?.dispose();
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    const canvas = getFrameSyncCanvas();
    if (!mesh || !canvas || !(camera instanceof PerspectiveCamera)) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!textureRef.current || textureRef.current.image !== canvas) {
      textureRef.current?.dispose();
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.generateMipmaps = false;
      textureRef.current = tex;
      material.map = tex;
      material.needsUpdate = true;
      setGlBackgroundActive(true);
    }
    const seq = getFrameSeq();
    if (seq !== lastSeq.current) {
      lastSeq.current = seq;
      textureRef.current.needsUpdate = true;
    }
    // Fill the view frustum at BACKGROUND_DEPTH, mirrored horizontally.
    const h = 2 * BACKGROUND_DEPTH * Math.tan((camera.fov * Math.PI) / 360);
    const w = h * camera.aspect;
    mesh.position.set(0, 0, -BACKGROUND_DEPTH);
    mesh.scale.set(-w, h, 1);
    mesh.quaternion.identity();
    mesh.visible = true;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      frustumCulled={false}
      visible={false}
    />
  );
}
