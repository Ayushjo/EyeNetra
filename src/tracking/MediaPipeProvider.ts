import { getFaceLandmarker } from "@/lib/mediapipe/faceLandmarker";
import { buildTrackingFrame } from "@/tracking/buildTrackingFrame";
import { useTryOnStore } from "@/store/tryOnStore";
import type { TrackingFrame, TrackingProvider } from "@/tracking/types";

type VideoFrameMetadata = { mediaTime: number };

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback: (
    cb: (now: number, metadata?: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

function silenceMediapipeConsole<T>(fn: () => T): T {
  const originalError = console.error;
  const originalWarn = console.warn;
  const filter = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (
      text.includes("TensorFlow Lite") ||
      text.includes("XNNPACK") ||
      text.includes("Created TensorFlow") ||
      text.includes("W0000") ||
      text.includes("INFO:")
    ) {
      return;
    }
    originalError.apply(console, args as Parameters<typeof console.error>);
  };
  console.error = filter as typeof console.error;
  console.warn = ((...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.includes("TensorFlow") || text.includes("XNNPACK")) return;
    originalWarn.apply(console, args as Parameters<typeof console.warn>);
  }) as typeof console.warn;
  try {
    return fn();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

/**
 * Current MediaPipe FaceLandmarker + computePose, behind TrackingProvider.
 * Behavior matches the pre-provider matrix pose path.
 */
export class MediaPipeProvider implements TrackingProvider {
  readonly id = "mediapipe" as const;

  private video: HTMLVideoElement | null = null;
  private cancelled = false;
  private handle: number | null = null;
  private usingVfc = false;
  private timestampMs = 0;
  private frameSkip = 0;
  private frames = 0;
  private fpsWindowStart = 0;
  private latest: TrackingFrame | null = null;
  private onStatus?: (s: "loading" | "ready" | "error", err?: string) => void;
  private onFps?: (fps: number) => void;

  constructor(opts?: {
    onStatus?: (s: "loading" | "ready" | "error", err?: string) => void;
    onFps?: (fps: number) => void;
  }) {
    this.onStatus = opts?.onStatus;
    this.onFps = opts?.onFps;
  }

  getFrame(): TrackingFrame | null {
    return this.latest;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    this.video = video;
    this.cancelled = false;
    this.timestampMs = 0;
    this.frameSkip = 0;
    this.frames = 0;
    this.fpsWindowStart = performance.now();
    this.latest = null;
    this.onStatus?.("loading");

    try {
      const landmarker = await silenceMediapipeConsole(() =>
        getFaceLandmarker(),
      );
      if (this.cancelled) return;
      this.onStatus?.("ready");

      const tick = (now: number, metadata?: VideoFrameMetadata) => {
        if (this.cancelled || !this.video) return;
        const v = this.video;
        if (v.readyState < 2) {
          this.schedule();
          return;
        }

        const mobile = useTryOnStore.getState().isMobilePerfMode;
        this.frameSkip += 1;
        if (this.frameSkip % (mobile ? 2 : 1) !== 0) {
          this.schedule();
          return;
        }

        this.timestampMs = Math.max(this.timestampMs + 1, Math.floor(now));

        try {
          const result = silenceMediapipeConsole(() =>
            landmarker.detectForVideo(v, this.timestampMs),
          );
          const face = result.faceLandmarks[0] ?? null;
          const matrix = result.facialTransformationMatrixes[0];
          const landmarks = face
            ? face.map((p) => ({ x: p.x, y: p.y, z: p.z }))
            : null;
          const transformMatrix = matrix?.data ? [...matrix.data] : null;
          const videoWidth = v.videoWidth || 1280;
          const videoHeight = v.videoHeight || 720;

          const store = useTryOnStore.getState();
          const sku = store.selectedFrame();
          this.latest = buildTrackingFrame({
            landmarks,
            transformMatrix,
            videoWidth,
            videoHeight,
            timestampMs: metadata?.mediaTime != null
              ? metadata.mediaTime * 1000
              : now,
            detectedAtMs: performance.now(),
            sku,
            faceProfile: store.faceProfile,
            headAnchors: store.headAnchors,
            glassesGeom: store.glassesGeom[sku.id] ?? null,
            perspTune: store.perspTune,
            cameraCalib: store.cameraCalib,
            debugLog: store.debugPoseLog,
          });
        } catch (err) {
          console.warn("[EyeNetra:mediapipe] detect skipped", err);
        }

        this.frames += 1;
        if (now - this.fpsWindowStart >= 1000) {
          this.onFps?.(this.frames);
          this.frames = 0;
          this.fpsWindowStart = now;
        }

        this.schedule();
      };

      this.tickFn = tick;
      this.schedule();
    } catch (err) {
      this.onStatus?.(
        "error",
        err instanceof Error
          ? err.message
          : "Failed to load MediaPipe face tracking.",
      );
      throw err;
    }
  }

  private tickFn:
    | ((now: number, metadata?: VideoFrameMetadata) => void)
    | null = null;

  private schedule() {
    if (this.cancelled || !this.video || !this.tickFn) return;
    const video = this.video as VideoWithFrameCallback;
    if (typeof video.requestVideoFrameCallback === "function") {
      this.usingVfc = true;
      this.handle = video.requestVideoFrameCallback((ts, meta) =>
        this.tickFn!(ts, meta),
      );
    } else {
      this.usingVfc = false;
      this.handle = requestAnimationFrame((ts) => this.tickFn!(ts));
    }
  }

  stop(): void {
    this.cancelled = true;
    if (this.handle != null && this.video) {
      const video = this.video as VideoWithFrameCallback;
      if (this.usingVfc && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(this.handle);
      } else {
        cancelAnimationFrame(this.handle);
      }
    }
    this.handle = null;
    this.video = null;
    this.tickFn = null;
    this.latest = null;
  }
}
