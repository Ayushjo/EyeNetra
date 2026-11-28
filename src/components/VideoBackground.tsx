"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  VideoFrameTexture,
  VideoTexture,
  type Texture,
} from "three";
import {
  frameSyncMode,
  getFrameSeq,
  getFrameSyncCanvas,
  getSyncVideoFrame,
  getLiveVideo,
  setGlBackgroundActive,
} from "@/tracking/frameSync";

/** Distance of the background quad from the camera (inside far = 10000). */
const BACKGROUND_DEPTH = 5000;
/**
 * LIVE: re-upload the camera frame at most this often — about twice the
 * camera's 30 fps, so every frame reaches the screen even with the uneven
 * render timing the tracker causes, without 120 uploads/s on a 120 Hz screen.
 */
const VIDEO_UPLOAD_INTERVAL_MS = 15;

function prepare<T extends Texture>(tex: T): T {
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * The camera picture drawn inside the 3D scene, behind everything, in the same
 * render pass as the glasses (Meta's try-on renders its video as a plane in
 * the scene). Mirrored to match the selfie view; not tone-mapped (true video
 * colours).
 *
 * LIVE (default): the <video> itself, re-uploaded GPU-to-GPU on a short
 * timer as well as on each requestVideoFrameCallback (which the browser
 * skips while the tracker's detection occupies the main thread) — the
 * picture runs at the camera's rate.
 * SYNC (staff option): the frame the tracker analysed, uploaded only when a
 * new one was presented, so picture and pose always reach the screen together.
 */
export function VideoBackground() {
  const camera = useThree((s) => s.camera);
  const meshRef = useRef<Mesh>(null);
  const canvasTexRef = useRef<CanvasTexture | null>(null);
  const frameTexRef = useRef<VideoFrameTexture | null>(null);
  const videoTexRef = useRef<VideoTexture | null>(null);
  const lastUploadMs = useRef(0);
  const lastSeq = useRef(-1);
  const material = useMemo(
    () => new MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false }),
    [],
  );
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);

  useEffect(
    () => () => {
      setGlBackgroundActive(false);
      canvasTexRef.current?.dispose();
      videoTexRef.current?.dispose();
      frameTexRef.current?.dispose();
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || !(camera instanceof PerspectiveCamera)) {
      if (mesh) mesh.visible = false;
      return;
    }

    let map: Texture | null = null;
    if (frameSyncMode()) {
      const frame = getSyncVideoFrame();
      const canvas = frame ? null : getFrameSyncCanvas();
      if (frame) {
        // Worker tracker: the analysed VideoFrame itself, uploaded straight to
        // the GPU (no copy through the 2D display canvas).
        if (!frameTexRef.current) frameTexRef.current = prepare(new VideoFrameTexture());
        const seq = getFrameSeq();
        if (seq !== lastSeq.current || frameTexRef.current.image !== frame) {
          lastSeq.current = seq;
          frameTexRef.current.setFrame(frame);
        }
        map = frameTexRef.current;
      } else if (canvas) {
        if (!canvasTexRef.current || canvasTexRef.current.image !== canvas) {
          canvasTexRef.current?.dispose();
          canvasTexRef.current = prepare(new CanvasTexture(canvas));
          lastSeq.current = -1;
        }
        const seq = getFrameSeq();
        if (seq !== lastSeq.current) {
          lastSeq.current = seq;
          canvasTexRef.current.needsUpdate = true;
        }
        map = canvasTexRef.current;
      }
    } else {
      const video = getLiveVideo();
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        if (!videoTexRef.current || videoTexRef.current.image !== video) {
          videoTexRef.current?.dispose();
          // VideoTexture, not a plain Texture: three sizes a plain texture
          // from the element's width/height attributes (0 on a <video>) and
          // would allocate an empty, black texture.
          videoTexRef.current = prepare(new VideoTexture(video));
          lastUploadMs.current = 0;
        }
        // VideoTexture refreshes itself only on requestVideoFrameCallback,
        // which (like the decoded-frame count) lags while the tracker holds
        // the main thread — measured 18–20 of the camera's 30 frames/s. So
        // also upload the current frame on a short timer (kept up: ≈ 58/s).
        const nowMs = performance.now();
        if (nowMs - lastUploadMs.current >= VIDEO_UPLOAD_INTERVAL_MS) {
          lastUploadMs.current = nowMs;
          videoTexRef.current.needsUpdate = true;
        }
        map = videoTexRef.current;
      }
    }

    if (!map) {
      mesh.visible = false;
      setGlBackgroundActive(false);
      return;
    }
    if (material.map !== map) {
      material.map = map;
      material.needsUpdate = true;
    }
    setGlBackgroundActive(true);

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
