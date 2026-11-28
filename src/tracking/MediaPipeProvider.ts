import { getFaceLandmarker } from "@/lib/mediapipe/faceLandmarker";
import { presentFrame } from "@/tracking/frameSync";
import { devSample } from "@/lib/devMetrics";
import { DETECT_MAX_SIDE, mediapipeTrackingFrame } from "@/tracking/mediapipeFrame";
import { useTryOnStore } from "@/store/tryOnStore";
import type { TrackerStats, TrackingFrame, TrackingProvider } from "@/tracking/types";

type VideoFrameMetadata = { mediaTime: number };

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback: (
    cb: (now: number, metadata?: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};

/**
 * Current MediaPipe FaceLandmarker + computePose, behind TrackingProvider.
 * Behavior matches the pre-provider matrix pose path. Detection runs on the
 * page's main thread — the fallback for WorkerMediaPipeProvider, and the
 * engine for SYNC display (which must paint the very frame it analyses).
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
  private detectMsSum = 0;
  /** Downscaled copy of the frame the detector analyses (GPU 2D canvas). */
  private detectCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private detectCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private onStatus?: (s: "loading" | "ready" | "error", err?: string) => void;
  private onFps?: (fps: number) => void;
  private onStats?: (s: TrackerStats) => void;

  constructor(opts?: {
    onStatus?: (s: "loading" | "ready" | "error", err?: string) => void;
    onFps?: (fps: number) => void;
    onStats?: (s: TrackerStats) => void;
  }) {
    this.onStatus = opts?.onStatus;
    this.onFps = opts?.onFps;
    this.onStats = opts?.onStats;
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
    this.detectMsSum = 0;
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
          presentFrame(v, v.videoWidth, v.videoHeight);
          const t0 = performance.now();
          const result = landmarker.detectForVideo(this.detectSource(v), this.timestampMs);
          const t1 = performance.now();
          this.detectMsSum += t1 - t0;
          devSample("wait", t0 - now);
          devSample("detect", t1 - t0);
          devSample("handoff", 0);
          const face = result.faceLandmarks[0] ?? null;
          const matrix = result.facialTransformationMatrixes[0];
          this.latest = mediapipeTrackingFrame({
            landmarks: face ? face.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null,
            mediapipeMatrix: matrix?.data ? [...matrix.data] : null,
            videoWidth: v.videoWidth || 1280,
            videoHeight: v.videoHeight || 720,
            timestampMs: metadata?.mediaTime != null ? metadata.mediaTime * 1000 : now,
            detectedAtMs: performance.now(),
            // When this frame reached the page — same clock as
            // frameSync.getLiveFrameAtMs().
            frameAtMs: now,
            receivedAtMs: performance.now(),
          });
        } catch (err) {
          console.warn("[EyeNetra:mediapipe] detect skipped", err);
        }

        this.frames += 1;
        if (now - this.fpsWindowStart >= 1000) {
          this.onFps?.(this.frames);
          this.onStats?.({
            engine: "main",
            detectMs: this.frames ? this.detectMsSum / this.frames : null,
          });
          this.frames = 0;
          this.detectMsSum = 0;
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
