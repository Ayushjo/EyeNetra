"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AxesHelper,
  Group,
  OrthographicCamera,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GlassesModel, type PivotDebug } from "@/components/GlassesModel";
import { FaceOccluder } from "@/components/FaceOccluder";
import { useFitEngine } from "@/hooks/useFitEngine";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Option (b): parent anchor receives matrix pose each frame; glasses mesh is a
 * child with a fixed local offset (0 after bridge-recenter). AxesHelper sits
 * on the anchor so we can see the nose-bridge pivot on the face.
 */
function GlassesAnchor() {
  const anchorRef = useRef<Group>(null);
  const offsetRef = useRef<Group>(null);
  useFitEngine(anchorRef);

  const frameId = useTryOnStore((s) => s.selectedFrameId);
  const variantId = useTryOnStore((s) => s.selectedVariantId);
  const showFitDebug = useTryOnStore((s) => s.showFitDebug);
  const frame = useTryOnStore((s) => s.selectedFrame());
  const variant = useTryOnStore((s) => s.selectedVariant());

  const [localOffset] = useState(() => new Vector3(0, 0, 0));
  const axesRef = useRef<AxesHelper | null>(null);

  const onPivotDebug = useCallback((info: PivotDebug) => {
    // Model is recentered so bridge → origin; keep child offset at 0.
    // Bbox center log is the confirmation the user asked for.
    console.info(
      `[EyeNetra:pivot] confirmed for ${frame.glbPath}: bbox.center=`,
      info.bboxCenter,
      `localOffset=`,
      info.localOffset,
    );
  }, [frame.glbPath]);

  useEffect(() => {
    if (!showFitDebug) {
      if (axesRef.current && anchorRef.current) {
        anchorRef.current.remove(axesRef.current);
        axesRef.current.dispose();
        axesRef.current = null;
      }
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (!axesRef.current) {
      axesRef.current = new AxesHelper(0.18);
      axesRef.current.renderOrder = 20;
      anchor.add(axesRef.current);
      console.info(
        "[EyeNetra:pivot] AxesHelper attached at face anchor (RGB = XYZ). It should sit on the nose bridge.",
      );
    }
    return () => {
      if (axesRef.current && anchor) {
        anchor.remove(axesRef.current);
        axesRef.current.dispose();
        axesRef.current = null;
      }
    };
  }, [showFitDebug, frameId]);

  return (
    <group ref={anchorRef}>
      {/* Fixed local offset — set once; not recomputed per frame.
          Visibility is owned by useFitEngine (do NOT set visible={false} here —
          React re-applies JSX props and would fight the imperative show). */}
      <group ref={offsetRef} position={localOffset}>
        <Suspense fallback={null}>
          <GlassesModel
            key={`${frameId}-${variantId}`}
            glbPath={frame.glbPath}
            variant={variant}
            fit={frame.fit}
            onPivotDebug={onPivotDebug}
          />
        </Suspense>
      </group>
    </group>
  );
}

function CameraAspectSync() {
  const videoWidth = useTryOnStore((s) => s.videoWidth);
  const videoHeight = useTryOnStore((s) => s.videoHeight);
  const { camera, size } = useThree();

  useEffect(() => {
    const aspect =
      size.height > 0
        ? size.width / size.height
        : videoHeight > 0
          ? videoWidth / videoHeight
          : 16 / 9;
    if (camera instanceof OrthographicCamera) {
      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.near = -50;
      camera.far = 50;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    }
  }, [camera, videoWidth, videoHeight, size.width, size.height]);

  return null;
}

function Scene() {
  return (
    <>
      <CameraAspectSync />
      {/* Key + fill for shape; the Environment supplies realistic reflections. */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 3, 4]} intensity={0.9} />
      <directionalLight position={[-3, 1, 2]} intensity={0.35} />
      {/* Self-contained studio env map (no external HDRI): soft box lights that
          give metal temples and lenses real specular highlights + reflections.
          background={false} keeps the overlay transparent over the webcam. */}
      <Environment resolution={128} background={false}>
        <Lightformer
          intensity={2.2}
          position={[0, 1.5, 3]}
          scale={[6, 3, 1]}
          color="#ffffff"
        />
        <Lightformer
          intensity={1.1}
          position={[-3, 0.5, 2]}
          scale={[3, 4, 1]}
          color="#dfe8ff"
        />
        <Lightformer
          intensity={1.1}
          position={[3, 0.5, 2]}
          scale={[3, 4, 1]}
          color="#fff2e0"
        />
        <Lightformer
          intensity={0.8}
          position={[0, -2, 1]}
          scale={[6, 2, 1]}
          color="#cfd6e0"
        />
      </Environment>
      {/* Depth-only head occluder — far temple culls behind the head at any yaw. */}
      <FaceOccluder />
      <GlassesAnchor />
    </>
  );
}

export function TryOnCanvas({ className = "" }: { className?: string }) {
  const videoWidth = useTryOnStore((s) => s.videoWidth);
  const videoHeight = useTryOnStore((s) => s.videoHeight);
  const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;

  return (
    <div className={`pointer-events-none absolute inset-0 z-20 ${className}`}>
      <Canvas
        orthographic
        dpr={[1, 1.5]}
        camera={{
          position: [0, 0, 5],
          zoom: 1,
          near: -50,
          far: 50,
          left: -aspect,
          right: aspect,
          top: 1,
          bottom: -1,
        }}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: "low-power",
        }}
        onCreated={({ gl, camera }) => {
          gl.outputColorSpace = SRGBColorSpace;
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.setClearColor(0x000000, 0);
          camera.updateProjectionMatrix();

          const canvasEl = gl.domElement;
          canvasEl.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            console.warn(
              "[EyeNetra] WebGL context lost — reload if glasses disappear.",
            );
          });
        }}
        style={{ background: "transparent", width: "100%", height: "100%" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
