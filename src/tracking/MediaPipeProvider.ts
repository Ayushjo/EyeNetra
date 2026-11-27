import { getFaceLandmarker } from "@/lib/mediapipe/faceLandmarker";
import { buildTrackingFrame } from "@/tracking/buildTrackingFrame";
import { presentFrame } from "@/tracking/frameSync";
import { solveHeadPosePnP } from "@/lib/pnp";
import { useTryOnStore } from "@/store/tryOnStore";
import type { TrackingFrame, TrackingProvider } from "@/tracking/types";

type VideoFrameMetadata = { mediaTime: number };
/** PnP solves worse than this (px RMS) fall back to the MediaPipe matrix. */
const PNP_MAX_RMS_PX = 25;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback: (
    cb: (now: number, metadata?: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

/**
 * Longest side of the image handed to the detector. MediaPipe crops the face
 * and resizes it to 192–256 px internally, so a full 1280×720 frame buys no
 * accuracy — but the CPU path must read every input pixel back from the GPU,
 * and that readback was the tracker's main cost (≈ 4× the inference itself
 * at 720p). 960 keeps iris landmarks (fit-size measurement) sharp.
 */
const DETECT_MAX_SIDE = 960;

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
  private lastPnpLogMs = 0;
  /** Downscaled copy of the frame the detector analyses (GPU 2D canvas). */
  private detectCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private detectCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
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
      const landmarker = await getFaceLandmarker();
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
          // SYNC display only: show exactly the frame the detector analyses.
          presentFrame(v);
          const result = landmarker.detectForVideo(this.detectSource(v), this.timestampMs);
          const face = result.faceLandmarks[0] ?? null;
          const matrix = result.facialTransformationMatrixes[0];
          const landmarks = face
            ? face.map((p) => ({ x: p.x, y: p.y, z: p.z }))
            : null;
          const mediapipeMatrix = matrix?.data ? [...matrix.data] : null;
          const videoWidth = v.videoWidth || 1280;
          const videoHeight = v.videoHeight || 720;

          const store = useTryOnStore.getState();
          // Head pose by PnP on 33 rigid landmarks under the render camera's
          // own intrinsics (technique from Meta's try-on; lib/pnp.ts). The
          // MediaPipe matrix seeds the solve and remains the fallback.
          let transformMatrix = mediapipeMatrix;
          if (landmarks && mediapipeMatrix) {
            const pnp = solveHeadPosePnP(
              landmarks, mediapipeMatrix, videoWidth, videoHeight, store.cameraCalib.fovDeg,
            );
            if (pnp && pnp.rmsPx < PNP_MAX_RMS_PX) transformMatrix = pnp.matrix;
            if (store.debugPoseLog && pnp && now - this.lastPnpLogMs > 1000) {
              this.lastPnpLogMs = now;
              console.info(`[EyeNetra:pnp] rms=${pnp.rmsPx.toFixed(2)}px it=${pnp.iterations}`);
            }
          }
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

  /**
   * The frame to detect on: the video itself if it is already small, else a
   * downscaled copy (one GPU drawImage, ~0.3 ms). Landmarks are normalised,
   * so the smaller image yields the same coordinates.
   */
  private detectSource(v: HTMLVideoElement): TexImageSource {
    const vw = v.videoWidth, vh = v.videoHeight;
    const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(vw, vh));
    if (scale >= 1 || !vw || !vh) return v;
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    if (!this.detectCanvas || this.detectCanvas.width !== w || this.detectCanvas.height !== h) {
      this.detectCanvas =
        typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement("canvas"), { width: w, height: h });
      // Never read back on the CPU: the canvas must stay GPU-backed so the
      // detector's upload of it is a GPU copy.
      this.detectCtx = this.detectCanvas.getContext("2d", { alpha: false }) as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
    }
    if (!this.detectCtx) return v;
    this.detectCtx.drawImage(v, 0, 0, w, h);
    return this.detectCanvas;
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
    this.detectCanvas = null;
    this.detectCtx = null;
  }
}
