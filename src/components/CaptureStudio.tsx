"use client";

import { Environment } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GlassesModel } from "@/components/GlassesModel";
import { getFrameById } from "@/data/frames";
import { computePose } from "@/lib/fitPose";
import { FACE_TRIANGLES } from "@/lib/faceMesh";
import { writeFaceSurface } from "@/lib/faceOcclusion";
import { useTryOnStore, type CaptureState } from "@/store/tryOnStore";

const IDENTITY = new Quaternion();

/** Soft elliptical contact shadow under brow/frame — capture only (~18% opacity). */
function CaptureShadowDisc({
  x,
  y,
  scale,
}: {
  x: number;
  y: number;
  scale: number;
}) {
  return (
    <mesh
      position={[x, y + scale * 0.08, 0.04]}
      scale={[scale * 0.55, scale * 0.12, 1]}
      renderOrder={1}
    >
      <circleGeometry args={[1, 48]} />
      <meshBasicMaterial
        color="#000000"
        transparent
        opacity={0.18}
        depthWrite={false}
      />
    </mesh>
  );
}

function CaptureGlasses({ capture }: { capture: CaptureState }) {
  const frame = getFrameById(capture.frameId);
  const variant =
    frame.variants.find((v) => v.id === capture.variantId) ?? frame.variants[0];
  const aspect =
    capture.videoHeight > 0
      ? capture.videoWidth / capture.videoHeight
      : 16 / 9;

  const faceProfile = useTryOnStore((s) => s.faceProfile);

  const pose = useMemo(() => {
    if (capture.renderMode === "perspective" && capture.anchorPose) {
      const a = capture.anchorPose;
      return {
        position: new Vector3(a.position.x + capture.refine.dx, a.position.y + capture.refine.dy, a.position.z),
        quaternion: new Quaternion(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w),
        scale: a.scale * (1 + capture.refine.dScale),
      };
    }
    const p = computePose({
      landmarks: capture.landmarks,
      transformMatrix: capture.transformMatrix,
      aspect,
      scaleMul: frame.fit.scaleMul,
      yOffsetFrac: frame.fit.yOffsetFrac,
      frameWidthMm: frame.fit.frameWidthMm,
      faceProfile,
      modelCorrect: IDENTITY,
      debugLog: false,
    });
    if (!p) return null;
    // Refinement pass hook (setCaptureRefine) — ready for future micro-nudges.
    p.position.x += capture.refine.dx;
    p.position.y += capture.refine.dy;
    p.scale *= 1 + capture.refine.dScale;
    return p;
  }, [capture, aspect, frame, faceProfile]);

  if (!pose) return null;

  return (
    <>
      {capture.renderMode === "ortho" && <CaptureShadowDisc
        x={pose.position.x} y={pose.position.y} scale={pose.scale}
      />}
      {capture.renderMode === "perspective" && <CaptureFaceMask capture={capture} />}
      <group
        position={pose.position}
        quaternion={pose.quaternion}
        scale={pose.scale}
      >
        <Suspense fallback={null}>
          <GlassesModel
            glbPath={frame.glbPath}
            variant={variant}
            fit={frame.fit}
            quality="capture"
          />
        </Suspense>
      </group>
    </>
  );
}

/** Static depth-only mask from the exact frozen detection and perspective camera. */
function CaptureFaceMask({ capture }: { capture: CaptureState }) {
  const geometry = useMemo(() => {
    if (!capture.anchorPose || !capture.faceDepthCm) return null;
    const a = capture.anchorPose;
    const raw = new Matrix4().compose(
      new Vector3(a.position.x, a.position.y, a.position.z),
      new Quaternion(a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w),
      new Vector3(a.scale, a.scale, a.scale),
    );
    const positions = new Float32Array(468 * 3);
    const aspect = capture.videoWidth / capture.videoHeight;
    const tanHalf = Math.tan(capture.fovDeg * Math.PI / 360);
    if (!writeFaceSurface(capture.landmarks, capture.faceDepthCm, aspect, raw.invert(), positions, new Vector3(), tanHalf)) return null;
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(positions, 3));
    geom.setIndex(FACE_TRIANGLES);
    return geom;
  }, [capture]);
  if (!geometry || !capture.anchorPose) return null;
  const a = capture.anchorPose;
  return <group position={[a.position.x, a.position.y, a.position.z]}
    quaternion={[a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w]}
    scale={a.scale}>
    <mesh geometry={geometry} renderOrder={0} frustumCulled={false}>
      <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
    </mesh>
  </group>;
}

/**
 * HQ capture studio: frozen still + matrix fit + contact shadow + env reflections.
 * Outside the live 30fps budget.
 */
export function CaptureStudio() {
  const capture = useTryOnStore((s) => s.capture);
  const setCapture = useTryOnStore((s) => s.setCapture);

  if (!capture) return null;

  const aspect =
    capture.videoHeight > 0
      ? capture.videoWidth / capture.videoHeight
      : 16 / 9;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl ring-1 ring-white/10">
        <div
          className="relative w-full"
          style={{ aspectRatio: `${aspect}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={capture.imageUrl}
            alt="Captured try-on"
            className="absolute inset-0 h-full w-full object-fill"
          />
          <div className="absolute inset-0">
            <Canvas
              orthographic={capture.renderMode === "ortho"}
              dpr={[1, 2]}
              camera={capture.renderMode === "perspective" ? {
                position: [0, 0, 0],
                fov: capture.fovDeg,
                near: 1,
                far: 1000,
              } : {
                position: [0, 0, 5],
                zoom: 1,
                near: -50,
                far: 50,
                left: -aspect,
                right: aspect,
                top: 1,
                bottom: -1,
              }}
              gl={{ antialias: true, alpha: true }}
              onCreated={({ gl }) => {
                gl.outputColorSpace = SRGBColorSpace;
                gl.toneMapping = ACESFilmicToneMapping;
                gl.setClearColor(0x000000, 0);
              }}
              style={{
                background: "transparent",
                width: "100%",
                height: "100%",
              }}
            >
              <ambientLight intensity={0.55} />
              <directionalLight position={[2, 3, 4]} intensity={1.2} />
              <Suspense fallback={null}>
                <Environment preset="studio" />
              </Suspense>
              <CaptureGlasses capture={capture} />
            </Canvas>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-zinc-950 px-4 py-3">
          <p className="text-xs text-zinc-400">
            HQ capture — contact shadow + studio reflections
          </p>
          <button
            type="button"
            onClick={() => setCapture(null)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Freeze current video frame + tracking snapshot for the HQ pass. */
export function freezeCaptureFromStage(
  stage: HTMLElement,
): CaptureState | null {
  const video = stage.querySelector("video");
  if (!video || video.readyState < 2) return null;

  const {
    landmarks,
    transformMatrix,
    videoWidth,
    videoHeight,
    selectedFrameId,
    selectedVariantId,
    hasFace,
    renderMode,
    cameraCalib,
    trackingFrame,
  } = useTryOnStore.getState();

  if (!hasFace || !landmarks) return null;

  const w = video.videoWidth || videoWidth;
  const h = video.videoHeight || videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);

  return {
    imageUrl: canvas.toDataURL("image/jpeg", 0.92),
    landmarks: landmarks.map((p) => ({ ...p })),
    transformMatrix: transformMatrix ? [...transformMatrix] : null,
    videoWidth: w,
    videoHeight: h,
    renderMode,
    fovDeg: cameraCalib.fovDeg,
    anchorPose: trackingFrame?.anchorPose
      ? {
          position: { ...trackingFrame.anchorPose.position },
          rotation: { ...trackingFrame.anchorPose.rotation },
          scale: trackingFrame.anchorPose.scale,
        }
      : null,
    faceDepthCm: trackingFrame?.depthCm ?? null,
    frameId: selectedFrameId,
    variantId: selectedVariantId,
    refine: { dx: 0, dy: 0, dScale: 0 },
  };
}
