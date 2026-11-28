"use client";

import { Canvas, useThree } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import { Suspense, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AxesHelper,
  DoubleSide,
  Group,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GlassesModel, preloadCatalogueModels, type PivotDebug } from "@/components/GlassesModel";
import { FaceMeshOccluder } from "@/components/FaceMeshOccluder";
import { VideoBackground } from "@/components/VideoBackground";
import { useFitEngine } from "@/hooks/useFitEngine";
import { useTryOnStore } from "@/store/tryOnStore";
import { FRAMES, getFrameById } from "@/data/frames";
import { SHOP_HDRI } from "@/lib/hdri";
import { frameSyncActive, getLiveVideo, onFramePresented } from "@/tracking/frameSync";
import { useUiStore } from "@/store/uiStore";

/**
 * Staff option "pace 3D to camera": draw once per new camera frame (with the
 * video locked to the tracker: once per analysed frame shown) instead of on
 * every display refresh. The picture only changes at the camera's rate, so
 * the extra redraws mostly cost GPU time the face tracker could use — on the
 * test laptop (integrated GPU, 120 Hz screen) this let the worker tracker
 * reach the camera's 30 fps.
 */
function CameraPacedLoop() {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    let video: (HTMLVideoElement & {
      requestVideoFrameCallback: (cb: (now: number) => void) => number;
      cancelVideoFrameCallback: (h: number) => void;
    }) | null = null;
    // Locked video: draw when the tracker shows a new analysed frame (its
    // pose is already published).
    const offPresent = onFramePresented(() => {
      if (!cancelled) advance(performance.now());
    });
    // Live video (or locked but nothing shown yet): draw per camera frame.
    const tick = (now: number) => {
      if (cancelled || !video) return;
      if (!frameSyncActive()) advance(now);
      handle = video.requestVideoFrameCallback(tick);
    };
    const wait = setInterval(() => {
      const v = getLiveVideo() as typeof video;
      if (!v || v === video) return;
      video = v;
      handle = video.requestVideoFrameCallback(tick);
      clearInterval(wait);
    }, 100);
    return () => {
      cancelled = true;
      offPresent();
      clearInterval(wait);
      if (video) video.cancelVideoFrameCallback(handle);
    };
  }, [advance]);
  return null;
}

/**
 * Option (b): parent anchor receives matrix pose each frame; glasses mesh is a
 * child with a fixed local offset (0 after bridge-recenter). AxesHelper sits
 * on the anchor so we can see the nose-bridge pivot on the face.
 */
function GlassesAnchor() {
  const anchorRef = useRef<Group>(null);
  const offsetRef = useRef<Group>(null);
  useFitEngine(anchorRef);

  const renderMode = useTryOnStore((s) => s.renderMode);
  const selectedFrameId = useTryOnStore((s) => s.selectedFrameId);
  const selectedVariantId = useTryOnStore((s) => s.selectedVariantId);
  const showFitDebug = useTryOnStore((s) => s.showFitDebug);
  // Deferred selection: when the assistant (or a tap) switches frames, React
  // keeps rendering the CURRENT glasses until the new GLB has loaded instead
  // of showing the Suspense fallback (no glasses) in between.
  const shownKey = useDeferredValue(`${selectedFrameId}|${selectedVariantId}`);
  const [frameId, variantId] = shownKey.split("|");
  const frame = getFrameById(frameId);
  const variant = frame.variants.find((v) => v.id === variantId) ?? frame.variants[0];

  const [localOffset] = useState(() => new Vector3(0, 0, 0));
  const axesRef = useRef<AxesHelper | null>(null);

  const onPivotDebug = useCallback((info: PivotDebug) => {
    // Model is recentered so the nose-pad contact → origin; offset stays 0.
    console.info(
      `[EyeNetra:pivot] confirmed for ${frame.glbPath}: bbox.center=`,
      info.bboxCenter,
      `geom=`,
      info.geom,
    );
    if (info.geom) {
      useTryOnStore.getState().setGlassesGeom(frameId, info.geom);
    }
  }, [frame.glbPath, frameId]);

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
      <FaceMeshOccluder anchorRef={anchorRef} />
      {/* Legacy ortho head mask. Perspective uses face-sized geometry. */}
      {renderMode === "ortho" && (
      <mesh
        renderOrder={0}
        frustumCulled={false}
        position={[0, -0.02, -1.32]}
        scale={[0.52, 0.98, 1.05]}
      >
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial
          colorWrite={false}
          depthWrite
          depthTest
          side={DoubleSide}
        />
      </mesh>
      )}
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

/**
 * Renders the active camera for the current render mode. Perspective uses the
 * MediaPipe FOV so the metric matrix pose projects correctly; ortho is the
 * legacy overlay camera. makeDefault swaps the active camera instantly on
 * toggle — no Canvas remount.
 */
function Cameras() {
  const renderMode = useTryOnStore((s) => s.renderMode);
  const fovDeg = useTryOnStore((s) => s.cameraCalib.fovDeg);
  const videoWidth = useTryOnStore((s) => s.videoWidth);
  const videoHeight = useTryOnStore((s) => s.videoHeight);
  const { size } = useThree();
  const aspect =
    size.height > 0
      ? size.width / size.height
      : videoHeight > 0
        ? videoWidth / videoHeight
        : 16 / 9;

  if (renderMode === "perspective") {
    return (
      <PerspectiveCamera
        makeDefault
        fov={fovDeg}
        near={1}
        far={10000}
        position={[0, 0, 0]}
      />
    );
  }
  return (
    <OrthographicCamera
      makeDefault
      left={-aspect}
      right={aspect}
      top={1}
      bottom={-1}
      near={-50}
      far={50}
      position={[0, 0, 5]}
    />
  );
}

/** Scales the HDRI's light on every material (their envMapIntensity still applies). */
const SHOP_HDRI_INTENSITY = 1;

/**
 * Self-contained studio env map: soft box lights that give metal temples and
 * lenses specular highlights + reflections. Rendered once into a 128 px cube.
 * Now only the stand-in while the shop HDRI loads.
 */
function StudioEnvironment() {
  return (
    <Environment resolution={128} background={false}>
      <Lightformer intensity={2.2} position={[0, 1.5, 3]} scale={[6, 3, 1]} color="#ffffff" />
      <Lightformer intensity={1.1} position={[-3, 0.5, 2]} scale={[3, 4, 1]} color="#dfe8ff" />
      <Lightformer intensity={1.1} position={[3, 0.5, 2]} scale={[3, 4, 1]} color="#fff2e0" />
      <Lightformer intensity={0.8} position={[0, -2, 1]} scale={[6, 2, 1]} color="#cfd6e0" />
    </Environment>
  );
}

function Scene() {
  const light = useTryOnStore((s) => s.lightEstimate);
  const renderMode = useTryOnStore((s) => s.renderMode);
  const tint = `rgb(${Math.round(light.color[0] * 255)}, ${Math.round(light.color[1] * 255)}, ${Math.round(light.color[2] * 255)})`;
  return (
    <>
      <Cameras />
      {renderMode === "perspective" ? <VideoBackground /> : null}
      {/* Key + fill for shape, driven by the video-frame light estimate;
          the Environment supplies realistic reflections. */}
      <ambientLight intensity={light.ambient} color={tint} />
      <directionalLight position={[2, 3, 4]} intensity={light.key} color={tint} />
      <directionalLight position={[-3, 1, 2]} intensity={light.key * 0.4} />
      {/* Reflections + image-based light from a real shop interior (HDRI,
          served locally — public/hdri/README.md). Loaded and pre-filtered
          once; per frame it is only a texture lookup in the materials.
          background={false} keeps the overlay transparent over the webcam.
          Until the file has loaded, the studio panels stand in. */}
      <Suspense fallback={<StudioEnvironment />}>
        <Environment
          files={SHOP_HDRI}
          background={false}
          environmentIntensity={SHOP_HDRI_INTENSITY}
        />
      </Suspense>
      {/* Real face-mesh depth occluder (perspective): precise front/side temple
          occlusion. The anchor ellipsoid inside GlassesAnchor still covers the
          back of the head for the far temple on strong turns. */}
      <GlassesAnchor />
    </>
  );
}

/** Wait this long for the browser to restore a lost context before rebuilding. */
const CONTEXT_RESTORE_WAIT_MS = 1000;

/**
 * Most pixels the 3D canvas renders per frame (MSAA, tone mapping, the video
 * background). The mirror can fill a large screen now; a flat 1.5× device
 * pixel ratio there meant ~2.2 MP a frame on an integrated GPU, and that GPU
 * time also delays the tracker's frame readback.
 */
const MAX_RENDER_PIXELS = 1.4e6;

/** Device pixel ratio for the canvas: ≤ 1.5, ≤ the screen's, within budget. */
function useRenderDpr(ref: React.RefObject<HTMLDivElement | null>): number {
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      const budget = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
      const next = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1, budget));
      setDpr(Math.round(next * 20) / 20);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return dpr;
}

export function TryOnCanvas({ className = "" }: { className?: string }) {
  // Bumping the key remounts the Canvas with a fresh WebGL context. A lost
  // context otherwise leaves the last frame on screen forever (live: glasses
  // frozen beside the face while tracking kept running).
  const [canvasKey, setCanvasKey] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const dpr = useRenderDpr(boxRef);
  const paceToCamera = useUiStore((s) => s.paceRenderToCamera);
  useEffect(() => {
    preloadCatalogueModels(FRAMES.map((f) => f.glbPath));
  }, []);
  return (
    <div ref={boxRef} className={`pointer-events-none absolute inset-0 z-20 ${className}`}>
      <Canvas
        key={canvasKey}
        dpr={dpr}
        frameloop={paceToCamera ? "never" : "always"}
        gl={{
          antialias: true,
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
          let restored = false;
          canvasEl.addEventListener("webglcontextrestored", () => {
            restored = true;
            console.info("[EyeNetra] WebGL context restored by the browser.");
          });
          canvasEl.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            console.warn("[EyeNetra] WebGL context lost — rebuilding the 3D view if not restored.");
            setTimeout(() => {
              if (!restored) setCanvasKey((k) => k + 1);
            }, CONTEXT_RESTORE_WAIT_MS);
          });
        }}
        style={{ background: "transparent", width: "100%", height: "100%" }}
      >
        {paceToCamera ? <CameraPacedLoop /> : null}
        <Scene />
      </Canvas>
    </div>
  );
}
