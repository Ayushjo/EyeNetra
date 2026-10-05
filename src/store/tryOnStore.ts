import { create } from "zustand";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { FRAMES, getFrameById, type FrameSku, type FrameVariant } from "@/data/frames";
import type { FaceProfile } from "@/lib/faceProfile";
import {
  DEFAULT_CAMERA_CALIB,
  type CameraCalib,
} from "@/lib/cameraCalib";
import {
  DEFAULT_LIGHT_ESTIMATE,
  type LightEstimate,
} from "@/lib/lightEstimate";
import {
  canonicalHeadAnchors,
  DEFAULT_TRAGION_TUNE,
  type GlassesGeom,
  type HeadAnchors,
  type TragionTune,
} from "@/lib/headAnchors";
import type { TrackingFrame, TrackingProviderId } from "@/tracking/types";

export type LandmarkPoint = Pick<NormalizedLandmark, "x" | "y" | "z">;
export type { FaceProfile };

export type TrackingStatus = "idle" | "loading" | "ready" | "error";

export type CapabilityStatus = {
  webgl2: boolean;
  camera: boolean;
};

export type CaptureRefine = {
  dx: number;
  dy: number;
  dScale: number;
};

export type RenderMode = "ortho" | "perspective";

/** Live-tunable perspective fit params (cm), shared across frames for now. */
export type PerspectiveTune = {
  yOffsetCm: number;
  zOffsetCm: number;
  scaleTune: number;
};

export type CaptureState = {
  imageUrl: string;
  landmarks: LandmarkPoint[];
  transformMatrix: number[] | null;
  videoWidth: number;
  videoHeight: number;
  renderMode: RenderMode;
  fovDeg: number;
  anchorPose: NonNullable<TrackingFrame["anchorPose"]> | null;
  faceDepthCm: number | null;
  frameId: string;
  variantId: string;
  refine: CaptureRefine;
};

type TryOnState = {
  selectedFrameId: string;
  selectedVariantId: string;
  landmarks: LandmarkPoint[] | null;
  /** FaceLandmarker facialTransformationMatrixes[0].data (row-major 4×4). */
  transformMatrix: number[] | null;
  hasFace: boolean;
  videoWidth: number;
  videoHeight: number;
  trackingStatus: TrackingStatus;
  trackingError: string | null;
  /** Exponential smoothing factor 0..1 (higher = snappier, lower = smoother). */
  smoothingFactor: number;
  showLandmarks: boolean;
  fps: number;
  isMobilePerfMode: boolean;
  capabilities: CapabilityStatus | null;
  /** Provider-agnostic latest tracking frame (fit engine consumes this). */
  trackingFrame: TrackingFrame | null;
  /** Active tracking engine id (swappable providers). */
  trackingProviderId: TrackingProviderId;
  /** ortho = legacy overlay; perspective = metric matrix path (temples, pitch). */
  renderMode: RenderMode;
  /** Live-tunable perspective fit offsets (cm) + scale multiplier. */
  perspTune: PerspectiveTune;
  /** Log decomposed Euler while head turns (console). */
  debugPoseLog: boolean;
  /** Show AxesHelper at the face-matrix anchor (nose-bridge pivot check). */
  showFitDebug: boolean;
  /** Frozen HQ capture (null = live preview). */
  capture: CaptureState | null;
  /** Stable iris-calibrated face metrics (null until “Get your fit size”). */
  faceProfile: FaceProfile | null;
  /**
   * Last MediaPipe fit scale applied by useFitEngine — used to cross-bind
   * Jeeliz size so switch keeps pixel-matched frame width.
   */
  lastMediapipeScale: number | null;
  /** Anatomical anchor points in head-local metric space (cm). */
  headAnchors: HeadAnchors;
  /** Per-GLB scanned bridge/hinge geometry (normalized model units). */
  glassesGeom: Record<string, GlassesGeom>;
  /** Dev sliders for the estimated tragion offset (behind showFitDebug). */
  tragionTune: TragionTune;
  /** Single source of camera FOV + iris scale correction for all consumers. */
  cameraCalib: CameraCalib;
  /** Ambient light estimate from the video feed (EMA-smoothed). */
  lightEstimate: LightEstimate;
  /** Banner shown on the stage when the voice assistant puts a frame on the face. */
  showcase: { name: string; brand: string; at: number } | null;
  /** Hide dev-only tuning panels (default: hidden — this is a customer screen). */
  showDevControls: boolean;
  /** Dev: render the depth occluder (off = see raw glasses, no face masking). */
  showOccluder: boolean;

  selectedFrame: () => FrameSku;
  selectedVariant: () => FrameVariant;
  setFrame: (frameId: string) => void;
  setVariant: (variantId: string) => void;
  setTrackingProviderId: (id: TrackingProviderId) => void;
  setRenderMode: (mode: RenderMode) => void;
  setPerspTune: (tune: Partial<PerspectiveTune>) => void;
  setTrackingFrame: (frame: TrackingFrame | null) => void;
  setDebugPoseLog: (value: boolean) => void;
  setShowFitDebug: (value: boolean) => void;
  setFaceProfile: (profile: FaceProfile | null) => void;
  setLastMediapipeScale: (scale: number | null) => void;
  setHeadAnchors: (anchors: HeadAnchors) => void;
  setGlassesGeom: (frameId: string, geom: GlassesGeom) => void;
  setTragionTune: (tune: Partial<TragionTune>) => void;
  setCameraCalib: (calib: Partial<CameraCalib>) => void;
  setLightEstimate: (estimate: LightEstimate) => void;
  setShowcase: (showcase: { name: string; brand: string } | null) => void;
  setShowDevControls: (value: boolean) => void;
  setShowOccluder: (value: boolean) => void;
  setCapture: (capture: CaptureState | null) => void;
  /** Architected refinement nudge for capture (not user-facing yet). */
  setCaptureRefine: (refine: Partial<CaptureRefine>) => void;
  setTrackingResult: (payload: {
    landmarks: LandmarkPoint[] | null;
    transformMatrix: number[] | null;
    hasFace: boolean;
    videoWidth: number;
    videoHeight: number;
  }) => void;
  setTrackingStatus: (status: TrackingStatus, error?: string | null) => void;
  setSmoothingFactor: (value: number) => void;
  setShowLandmarks: (value: boolean) => void;
  setFps: (fps: number) => void;
  setMobilePerfMode: (value: boolean) => void;
  setCapabilities: (caps: CapabilityStatus) => void;
};

type TryOnStore = ReturnType<typeof createTryOnStore>;

/** Bump when store shape/actions change so Fast Refresh doesn't keep a stale singleton. */
const STORE_VERSION = 9;

function createTryOnStore() {
  return create<TryOnState>((set, get) => ({
    selectedFrameId: FRAMES[0].id,
    selectedVariantId: FRAMES[0].variants[0].id,
    landmarks: null,
    transformMatrix: null,
    hasFace: false,
    videoWidth: 1280,
    videoHeight: 720,
    trackingStatus: "idle",
    trackingError: null,
    smoothingFactor: 0.35,
    showLandmarks: false,
    fps: 0,
    isMobilePerfMode: false,
    capabilities: null,
    trackingFrame: null,
    trackingProviderId: "mediapipe",
    renderMode: "perspective",
    perspTune: { yOffsetCm: 0, zOffsetCm: 0, scaleTune: 1.0 },
    headAnchors: canonicalHeadAnchors(),
    glassesGeom: {},
    tragionTune: { ...DEFAULT_TRAGION_TUNE },
    cameraCalib: { ...DEFAULT_CAMERA_CALIB },
    lightEstimate: { ...DEFAULT_LIGHT_ESTIMATE },
    showcase: null,
    showDevControls: false,
    showOccluder: true,
    debugPoseLog: false,
    showFitDebug: false,
  capture: null,
  faceProfile: null,
  lastMediapipeScale: null,

  selectedFrame: () => getFrameById(get().selectedFrameId),
    selectedVariant: () => {
      const frame = getFrameById(get().selectedFrameId);
      return (
        frame.variants.find((v) => v.id === get().selectedVariantId) ??
        frame.variants[0]
      );
    },
    setFrame: (frameId) => {
      const frame = getFrameById(frameId);
      set({
        selectedFrameId: frame.id,
        selectedVariantId: frame.variants[0].id,
      });
    },
    setVariant: (variantId) => set({ selectedVariantId: variantId }),
    setTrackingProviderId: (id) => set({ trackingProviderId: id }),
    setRenderMode: (mode) => set({ renderMode: mode }),
    setPerspTune: (tune) =>
      set({ perspTune: { ...get().perspTune, ...tune } }),
    setTrackingFrame: (frame) => {
      set({
        trackingFrame: frame,
        landmarks: frame?.landmarks ?? null,
        transformMatrix: frame?.transformMatrix ?? null,
        hasFace: frame?.hasFace ?? false,
        videoWidth: frame?.videoWidth ?? get().videoWidth,
        videoHeight: frame?.videoHeight ?? get().videoHeight,
      });
    },
    setDebugPoseLog: (value) => set({ debugPoseLog: value }),
    setShowFitDebug: (value) => set({ showFitDebug: value }),
    setFaceProfile: (profile) => {
      const stack =
        new Error().stack?.split("\n").slice(2, 6).join(" ← ") ?? "";
      console.info(
        `[EyeNetra:calib:write] store.faceProfile=`,
        profile
          ? {
              ipdMm: profile.ipdMm,
              faceWidthMm: profile.faceWidthMm,
              refEyeSpanScene: profile.refEyeSpanScene,
            }
          : null,
        `\n  via ${stack}`,
      );
      set({ faceProfile: profile });
    },
    setLastMediapipeScale: (scale) => set({ lastMediapipeScale: scale }),
    setHeadAnchors: (anchors) => set({ headAnchors: anchors }),
    setCameraCalib: (calib) =>
      set({ cameraCalib: { ...get().cameraCalib, ...calib } }),
    setLightEstimate: (estimate) => set({ lightEstimate: estimate }),
    setShowcase: (showcase) =>
      set({ showcase: showcase ? { ...showcase, at: Date.now() } : null }),
    setShowDevControls: (value) => set({ showDevControls: value }),
    setShowOccluder: (value) => set({ showOccluder: value }),
    setGlassesGeom: (frameId, geom) =>
      set({ glassesGeom: { ...get().glassesGeom, [frameId]: geom } }),
    setTragionTune: (tune) => {
      const merged = { ...get().tragionTune, ...tune };
      set({
        tragionTune: merged,
        // Tune applies only to canonical anchors; calibrated ones are measured.
        headAnchors:
          get().headAnchors.source === "canonical"
            ? canonicalHeadAnchors(merged)
            : get().headAnchors,
      });
    },
    setCapture: (capture) => set({ capture }),
    setCaptureRefine: (refine) => {
      const cap = get().capture;
      if (!cap) return;
      set({ capture: { ...cap, refine: { ...cap.refine, ...refine } } });
    },
    setTrackingResult: (payload) => set(payload),
    setTrackingStatus: (status, error = null) =>
      set({ trackingStatus: status, trackingError: error }),
    setSmoothingFactor: (value) =>
      set({ smoothingFactor: Math.min(1, Math.max(0.05, value)) }),
    setShowLandmarks: (value) => set({ showLandmarks: value }),
    setFps: (fps) => set({ fps }),
    setMobilePerfMode: (value) => set({ isMobilePerfMode: value }),
    setCapabilities: (caps) => set({ capabilities: caps }),
  }));
}

declare global {
  var __eyenetraTryOnStore: TryOnStore | undefined;
  var __eyenetraTryOnStoreVersion: number | undefined;
}

function getOrCreateStore(): TryOnStore {
  const existing = globalThis.__eyenetraTryOnStore;
  const versionOk = globalThis.__eyenetraTryOnStoreVersion === STORE_VERSION;
  const shapeOk =
    !!existing &&
    typeof existing.getState().setTrackingProviderId === "function" &&
    typeof existing.getState().setTrackingFrame === "function" &&
    typeof existing.getState().setLastMediapipeScale === "function" &&
    typeof existing.getState().setRenderMode === "function" &&
    existing.getState().trackingProviderId != null;

  if (existing && versionOk && shapeOk) {
    return existing;
  }

  const prevProfile =
    existing && "faceProfile" in existing.getState()
      ? existing.getState().faceProfile
      : null;

  const store = createTryOnStore();
  if (prevProfile) {
    store.setState({ faceProfile: prevProfile });
  }
  globalThis.__eyenetraTryOnStore = store;
  globalThis.__eyenetraTryOnStoreVersion = STORE_VERSION;
  console.info(
    `[EyeNetra:store] created v${STORE_VERSION}` +
      (existing ? " (replaced stale Fast Refresh singleton)" : ""),
  );
  return store;
}

export const useTryOnStore: TryOnStore = getOrCreateStore();
