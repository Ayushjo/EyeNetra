import { WASM_BASE_PATH } from "@/lib/mediapipe/constants";
import { DETECT_MAX_SIDE, mediapipeTrackingFrame } from "@/tracking/mediapipeFrame";
import type { DetectDelegate, WorkerIn, WorkerOut } from "@/tracking/detectWorkerProtocol";
import { useTryOnStore, type LandmarkPoint } from "@/store/tryOnStore";
import { useUiStore } from "@/store/uiStore";
import { presentFrame, presentVideoFrame } from "@/tracking/frameSync";
import { devSample } from "@/lib/devMetrics";
import type { TrackerStats, TrackingFrame, TrackingProvider } from "@/tracking/types";

type VideoFrameMetadata = { mediaTime: number };
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: (now: number, metadata?: VideoFrameMetadata) => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};
/** Chromium's MediaStreamTrackProcessor (not in TypeScript's DOM lib yet). */
type TrackProcessorCtor = new (init: {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}) => { readable: ReadableStream<VideoFrame> };

/** Loading the model can take a while on a slow link; past this, use the main thread. */
const READY_TIMEOUT_MS = 30_000;

/**
 * MediaPipe FaceLandmarker in a Web Worker (detect.worker.ts) — same model,
 * same settings, same TrackingFrame as MediaPipeProvider, but detection no
 * longer shares the main thread with the 3D renderer.
 *
 * Frames: on Chromium the camera track is fed to the worker through
 * MediaStreamTrackProcessor, so this thread never touches a frame. Elsewhere
 * the video's frame callback sends a downscaled ImageBitmap whenever the
 * worker reports it is idle — one frame in flight, always the newest.
 *
 * Lock video to tracker (SYNC display): the worker hands each analysed
 * VideoFrame back with its result, and this thread shows that exact frame at
 * the same moment it publishes the frame's pose — face and glasses always
 * come from one camera frame, at the tracker's full rate. (Bitmap path: a
 * full-size copy of the frame sent for analysis is kept here for display.)
 */
export class WorkerMediaPipeProvider implements TrackingProvider {
  readonly id = "mediapipe" as const;

  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private trackClone: MediaStreamTrack | null = null;
  private vfcHandle: number | null = null;
  private busy = false;
  private cancelled = false;
  private latest: TrackingFrame | null = null;
  private frames = 0;
  private detectMsSum = 0;
  private fpsWindowStart = 0;
  private skipEvery = 1;
  private unsubMobile: (() => void) | null = null;
  private unsubSync: (() => void) | null = null;
  /** Bitmap path + SYNC: full-size copy of the frame in flight, for display. */
  private pendingDisplay: ImageBitmap | null = null;

  constructor(
    private readonly delegate: DetectDelegate,
    private readonly opts?: {
      onStatus?: (s: "loading" | "ready" | "error", err?: string) => void;
      onFps?: (fps: number) => void;
      onStats?: (s: TrackerStats) => void;
      /** Publish a new TrackingFrame at once (before its SYNC frame is shown). */
      onFrame?: (f: TrackingFrame) => void;
    },
  ) {}

  /** Workers + OffscreenCanvas 2D + createImageBitmap — everything the worker needs. */
  static supported(): boolean {
    return (
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof createImageBitmap === "function"
    );
  }

  getFrame(): TrackingFrame | null {
    return this.latest;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    this.cancelled = false;
    this.video = video;
    this.latest = null;
    this.frames = 0;
    this.detectMsSum = 0;
    this.opts?.onStatus?.("loading");

    // Classic worker on purpose — see the note at the top of detect.worker.ts.
    const worker = new Worker(new URL("./detect.worker.ts", import.meta.url), {
      name: "eyenetra-face-detect",
    });
    this.worker = worker;

    const ready = new Promise<DetectDelegate>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Face tracker worker timed out")), READY_TIMEOUT_MS);
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message || "Face tracker worker failed to load"));
      };
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        if (e.data.type === "ready") {
          clearTimeout(timer);
          resolve(e.data.delegate);
        } else if (e.data.type === "error") {
          clearTimeout(timer);
          reject(new Error(e.data.message));
        }
      };
    });
    this.send({
      type: "init",
      delegate: this.delegate,
      wasmBase: new URL(WASM_BASE_PATH, window.location.origin).href,
      maxSide: DETECT_MAX_SIDE,
    });

    let delegate: DetectDelegate;
    try {
      delegate = await ready;
    } catch (err) {
      this.stop();
      throw err;
    }
    if (this.cancelled) return;
    if (delegate !== this.delegate) {
      console.info(`[EyeNetra:tracking] worker fell back to ${delegate}`);
    }
    worker.onerror = (e) => console.warn("[EyeNetra:tracking] worker error", e.message);
    worker.onmessage = (e: MessageEvent<WorkerOut>) => this.onMessage(e.data);
    this.engine = delegate === "GPU" ? "worker-gpu" : "worker-cpu";
    this.fpsWindowStart = performance.now();

    this.applySkip(useTryOnStore.getState().isMobilePerfMode);
    this.unsubMobile = useTryOnStore.subscribe((s, prev) => {
      if (s.isMobilePerfMode !== prev.isMobilePerfMode) this.applySkip(s.isMobilePerfMode);
    });
    this.send({ type: "sync", on: useUiStore.getState().syncDisplay });
    this.unsubSync = useUiStore.subscribe((s, prev) => {
      if (s.syncDisplay !== prev.syncDisplay) this.send({ type: "sync", on: s.syncDisplay });
    });

    this.opts?.onStatus?.("ready");
    if (!this.startStream(video)) this.scheduleBitmap();
  }

  private engine: TrackerStats["engine"] = "worker-cpu";

  private send(msg: WorkerIn, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  private applySkip(mobile: boolean) {
    this.skipEvery = mobile ? 2 : 1;
    this.send({ type: "skip", every: this.skipEvery });
  }

  /** Chromium: hand the camera track's frames straight to the worker. */
  private startStream(video: HTMLVideoElement): boolean {
    const Processor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor })
      .MediaStreamTrackProcessor;
    const stream = video.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
    if (!Processor || !track) return false;
    try {
      // A clone, so stopping the tracker never stops the camera picture.
      const clone = track.clone();
      const { readable } = new Processor({ track: clone, maxBufferSize: 1 });
      this.send({ type: "stream", readable }, [readable as unknown as Transferable]);
      this.trackClone = clone;
      return true;
    } catch (err) {
      console.info("[EyeNetra:tracking] frame stream unavailable, sending bitmaps", err);
      this.trackClone?.stop();
      this.trackClone = null;
      return false;
    }
  }

  // ---- bitmap path (no MediaStreamTrackProcessor) --------------------------

  private bitmapSkip = 0;

  private scheduleBitmap() {
    const v = this.video as VideoWithFrameCallback | null;
    if (this.cancelled || !v) return;
    if (typeof v.requestVideoFrameCallback === "function") {
      this.vfcHandle = v.requestVideoFrameCallback((now, meta) => this.onVideoFrame(now, meta));
    } else {
      this.vfcHandle = requestAnimationFrame((now) => this.onVideoFrame(now));
    }
  }

  private onVideoFrame(now: number, meta?: VideoFrameMetadata) {
    const v = this.video;
    if (this.cancelled || !v) return;
    this.bitmapSkip += 1;
    if (this.busy || v.readyState < 2 || !v.videoWidth || this.bitmapSkip % this.skipEvery !== 0) {
      this.scheduleBitmap();
      return;
    }
    const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const timeMs = meta?.mediaTime != null ? meta.mediaTime * 1000 : now;
    const frameAtAbs = performance.timeOrigin + now;
    const sync = useUiStore.getState().syncDisplay;
    this.busy = true;
    Promise.all([
      createImageBitmap(v, {
        resizeWidth: Math.round(v.videoWidth * scale),
        resizeHeight: Math.round(v.videoHeight * scale),
        resizeQuality: "medium",
      }),
      // Lock video to tracker: keep the same frame at full size to show
      // when its result comes back.
      sync ? createImageBitmap(v) : Promise.resolve(null),
    ]).then(
      ([bitmap, display]) => {
        if (this.cancelled) {
          bitmap.close();
          display?.close();
          return;
        }
        this.pendingDisplay?.close();
        this.pendingDisplay = display;
        this.send({ type: "frame", bitmap, timeMs, frameAtAbs }, [bitmap]);
      },
      () => {
        this.busy = false;
      },
    );
    this.scheduleBitmap();
  }

  // ---- results -------------------------------------------------------------

  private onMessage(msg: WorkerOut) {
    if (this.cancelled) return;
    if (msg.type === "idle") {
      this.busy = false;
      return;
    }
    if (msg.type === "streamEnded") {
      // The camera track went away under us (camera restarted on the same
      // <video>): keep tracking by sending frames from the video instead.
      this.trackClone?.stop();
      this.trackClone = null;
      if (this.video && this.vfcHandle == null) this.scheduleBitmap();
      return;
    }
    if (msg.type !== "result") return;
    this.busy = false;
    const receivedAtMs = performance.now();
    const origin = performance.timeOrigin;
    devSample("wait", msg.detectStartAbs - msg.frameAtAbs);
    devSample("detect", msg.detectMs);
    devSample("handoff", receivedAtMs - (msg.detectedAtAbs - origin));

    let landmarks: LandmarkPoint[] | null = null;
    if (msg.landmarks) {
      const a = msg.landmarks;
      landmarks = new Array(a.length / 3);
      for (let i = 0; i < landmarks.length; i++) {
        landmarks[i] = { x: a[i * 3], y: a[i * 3 + 1], z: a[i * 3 + 2] };
      }
    }
    const v = this.video;
    try {
      this.latest = mediapipeTrackingFrame({
        landmarks,
        mediapipeMatrix: msg.matrix ? Array.from(msg.matrix) : null,
        // The bitmap path sends a downscaled image; geometry is the camera's.
        videoWidth: v?.videoWidth || msg.width || 1280,
        videoHeight: v?.videoHeight || msg.height || 720,
        timestampMs: msg.timeMs,
        detectedAtMs: msg.detectedAtAbs - performance.timeOrigin,
        frameAtMs: msg.frameAtAbs - origin,
        receivedAtMs,
      });
      this.opts?.onFrame?.(this.latest);
    } catch (err) {
      console.warn("[EyeNetra:tracking] pose skipped", err);
    }
    // Lock video to tracker: show the analysed frame now that its pose is
    // published, so the next draw has both. (No-op when SYNC is off.)
    if (msg.frame) {
      presentVideoFrame(msg.frame); // takes ownership
    } else if (this.pendingDisplay) {
      presentFrame(this.pendingDisplay, this.pendingDisplay.width, this.pendingDisplay.height);
      this.pendingDisplay.close();
    }
    this.pendingDisplay = null;

    this.frames += 1;
    this.detectMsSum += msg.detectMs;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 1000) {
      this.opts?.onFps?.(this.frames);
      this.opts?.onStats?.({ engine: this.engine, detectMs: this.detectMsSum / this.frames });
      this.frames = 0;
      this.detectMsSum = 0;
      this.fpsWindowStart = now;
    }
  }

  stop(): void {
    this.cancelled = true;
    const v = this.video as VideoWithFrameCallback | null;
    if (this.vfcHandle != null && v) {
      if (typeof v.cancelVideoFrameCallback === "function") v.cancelVideoFrameCallback(this.vfcHandle);
      else cancelAnimationFrame(this.vfcHandle);
    }
    this.vfcHandle = null;
    this.unsubMobile?.();
    this.unsubMobile = null;
    this.unsubSync?.();
    this.unsubSync = null;
    this.pendingDisplay?.close();
    this.pendingDisplay = null;
    if (this.worker) {
      this.worker.postMessage({ type: "stop" } satisfies WorkerIn);
      // The worker closes itself; terminate as a backstop for a wedged one.
      const w = this.worker;
      setTimeout(() => w.terminate(), 500);
      this.worker = null;
    }
    this.trackClone?.stop();
    this.trackClone = null;
    this.video = null;
    this.latest = null;
    this.busy = false;
  }
}
