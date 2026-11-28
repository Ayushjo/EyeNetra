/**
 * Face detection off the main thread (MediaPipe's own advice for the web:
 * run detectForVideo in a Web Worker). The page's main thread keeps drawing
 * the 3D scene while this thread runs the detector, so the two no longer take
 * turns.
 *
 * Frames arrive one of two ways (see WorkerMediaPipeProvider):
 *   stream : a ReadableStream<VideoFrame> from MediaStreamTrackProcessor
 *            (Chromium) — the camera feeds this thread directly
 *   frame  : one ImageBitmap at a time, sent by the main thread when this
 *            thread reports it is idle (other browsers)
 * Either way only the newest frame is analysed; older ones are dropped.
 *
 * Out: landmarks as a transferable Float32Array (x, y, z × 478) plus the
 * 4×4 pose matrix. PnP and the fit pose stay on the main thread — they need
 * the app's store and cost well under a millisecond.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  faceLandmarkerOptions,
  filterMediapipeConsoleNoise,
} from "@/lib/mediapipe/faceLandmarker";
import type { WorkerIn, WorkerOut } from "@/tracking/detectWorkerProtocol";

/**
 * The bits of DedicatedWorkerGlobalScope used here (the project's TS lib is
 * "dom"). This is a classic worker, not a module worker: Next's chunks end
 * with a bare `_N_E = …` assignment that throws in a module's strict mode,
 * and classic workers let MediaPipe load its WASM glue with importScripts.
 */
const scope = self as unknown as {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
  close(): void;
};

filterMediapipeConsoleNoise();

let landmarker: FaceLandmarker | null = null;
let maxSide = 960;
let skipEvery = 1;
/** Lock video to tracker: send each analysed VideoFrame back with its result. */
let returnFrames = false;
let frameCount = 0;
let lastTs = 0;
let stopped = false;
let canvas: OffscreenCanvas | null = null;
let ctx2d: OffscreenCanvasRenderingContext2D | null = null;

function post(msg: WorkerOut, transfer: Transferable[] = []) {
  scope.postMessage(msg, transfer);
}

async function init(delegate: "CPU" | "GPU", wasmBase: string, side: number) {
  maxSide = side;
  const vision = await FilesetResolver.forVisionTasks(wasmBase);
  try {
    landmarker = await FaceLandmarker.createFromOptions(vision, faceLandmarkerOptions(delegate));
    return delegate;
  } catch (err) {
    if (delegate !== "GPU") throw err;
    console.warn("[EyeNetra:worker] GPU delegate failed, using CPU", err);
    landmarker = await FaceLandmarker.createFromOptions(vision, faceLandmarkerOptions("CPU"));
    return "CPU" as const;
  }
}

/** The image to detect on: the source itself if small, else a GPU-side downscale. */
function detectSource(src: VideoFrame | ImageBitmap, w: number, h: number): TexImageSource {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  if (scale >= 1) return src;
  const dw = Math.round(w * scale), dh = Math.round(h * scale);
  if (!canvas || canvas.width !== dw || canvas.height !== dh) {
    canvas = new OffscreenCanvas(dw, dh);
    ctx2d = canvas.getContext("2d", { alpha: false });
  }
  if (!ctx2d) return src;
  ctx2d.drawImage(src, 0, 0, dw, dh);
  return canvas;
}

const absNow = () => performance.timeOrigin + performance.now();

/**
 * Detect on one frame and post the result. With `giveBack`, the VideoFrame is
 * transferred back with it (and must not be closed here): returns true then.
 */
function detect(
  src: VideoFrame | ImageBitmap,
  timeMs: number,
  width: number,
  height: number,
  frameAtAbs: number,
  giveBack: VideoFrame | null,
): boolean {
  if (!landmarker || !width || !height) {
    post({ type: "idle" });
    return false;
  }
  lastTs = Math.max(lastTs + 1, Math.floor(timeMs));
  const detectStartAbs = absNow();
  const t0 = performance.now();
  try {
    const result = landmarker.detectForVideo(detectSource(src, width, height), lastTs);
    const detectMs = performance.now() - t0;
    const face = result.faceLandmarks[0];
    let landmarks: Float32Array | null = null;
    if (face) {
      landmarks = new Float32Array(face.length * 3);
      for (let i = 0; i < face.length; i++) {
        landmarks[i * 3] = face[i].x;
        landmarks[i * 3 + 1] = face[i].y;
        landmarks[i * 3 + 2] = face[i].z;
      }
    }
    const m = result.facialTransformationMatrixes[0]?.data;
    const matrix = m ? Float64Array.from(m) : null;
    const transfer: Transferable[] = [];
    if (landmarks) transfer.push(landmarks.buffer);
    if (matrix) transfer.push(matrix.buffer);
    if (giveBack) transfer.push(giveBack as unknown as Transferable);
    post(
      {
        type: "result",
        landmarks,
        matrix,
        timeMs,
        width,
        height,
        detectMs,
        // performance.now() differs per thread; send absolute times.
        detectedAtAbs: absNow(),
        frameAtAbs,
        detectStartAbs,
        frame: giveBack ?? undefined,
      },
      transfer,
    );
    return giveBack != null;
  } catch (err) {
    console.warn("[EyeNetra:worker] detect skipped", err);
    post({ type: "idle" });
    return false;
  }
}

/** Yield a macrotask so queued stream chunks (posted messages) get delivered. */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

async function runStream(readable: ReadableStream<VideoFrame>) {
  const reader = readable.getReader();
  // Shared between the pump and the detect loop below.
  const st: {
    latest: VideoFrame | null;
    latestAt: number;
    wake: (() => void) | null;
    ended: boolean;
  } = { latest: null, latestAt: 0, wake: null, ended: false };

  // Pump: keep only the newest frame; close everything older at once so the
  // camera's frame pool never runs dry.
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped) {
          value?.close();
          break;
        }
        st.latest?.close();
        st.latest = value;
        st.latestAt = absNow();
        st.wake?.();
      }
    } catch {
      // stream cancelled / track stopped
    }
    st.ended = true;
    st.wake?.();
  })();

  while (!stopped && !st.ended) {
    if (!st.latest) {
      await new Promise<void>((r) => (st.wake = r));
      st.wake = null;
      continue;
    }
    // Let frames that queued during the last detection arrive, so we take
    // the newest one rather than the oldest.
    await yieldTask();
    const frame = st.latest;
    const frameAt = st.latestAt;
    st.latest = null;
    if (!frame) continue;
    frameCount += 1;
    if (frameCount % skipEvery !== 0) {
      frame.close();
      continue;
    }
    let handedBack = false;
    try {
      handedBack = detect(
        frame,
        frame.timestamp / 1000,
        frame.displayWidth,
        frame.displayHeight,
        frameAt,
        returnFrames ? frame : null,
      );
    } finally {
      if (!handedBack) frame.close();
    }
  }
  st.latest?.close();
  st.latest = null;
  void reader.cancel().catch(() => {});
  if (!stopped) post({ type: "streamEnded" });
}

scope.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      init(msg.delegate, msg.wasmBase, msg.maxSide).then(
        (delegate) => post({ type: "ready", delegate }),
        (err: unknown) =>
          post({ type: "error", message: err instanceof Error ? err.message : String(err) }),
      );
      break;
    case "stream":
      void runStream(msg.readable);
      break;
    case "frame":
      try {
        // Bitmap path: the page keeps its own full-size copy for display.
        detect(msg.bitmap, msg.timeMs, msg.bitmap.width, msg.bitmap.height, msg.frameAtAbs, null);
      } finally {
        msg.bitmap.close();
      }
      break;
    case "sync":
      returnFrames = msg.on;
      break;
    case "skip":
      skipEvery = Math.max(1, msg.every);
      break;
    case "stop":
      stopped = true;
      landmarker?.close();
      landmarker = null;
      scope.close();
      break;
  }
};
