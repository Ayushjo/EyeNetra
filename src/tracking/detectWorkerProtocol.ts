/** Messages between WorkerMediaPipeProvider (main thread) and detect.worker.ts. */

export type DetectDelegate = "CPU" | "GPU";

export type WorkerIn =
  | { type: "init"; delegate: DetectDelegate; wasmBase: string; maxSide: number }
  /** Chromium: camera frames straight from MediaStreamTrackProcessor. */
  | { type: "stream"; readable: ReadableStream<VideoFrame> }
  /** Other browsers: one downscaled frame, sent only while the worker is idle. */
  | { type: "frame"; bitmap: ImageBitmap; timeMs: number; frameAtAbs: number }
  /**
   * Lock video to tracker: hand each analysed VideoFrame back with its result
   * so the page shows exactly that frame (stream path only).
   */
  | { type: "sync"; on: boolean }
  /** Analyse every Nth frame (phones: 2). */
  | { type: "skip"; every: number }
  | { type: "stop" };

export type WorkerOut =
  | { type: "ready"; delegate: DetectDelegate }
  | { type: "error"; message: string }
  | {
      type: "result";
      /** x, y, z per landmark (normalised), or null when no face. */
      landmarks: Float32Array | null;
      /** Column-major 4×4 facial transformation matrix. */
      matrix: Float64Array | null;
      /** Frame time (ms) — monotonic, the tracking filter's time base. */
      timeMs: number;
      width: number;
      height: number;
      detectMs: number;
      /** performance.timeOrigin + performance.now() in the worker. */
      detectedAtAbs: number;
      /** When the analysed frame became available (same absolute clock). */
      frameAtAbs: number;
      /** When detection on it started (same clock) — queue wait = this − frameAtAbs. */
      detectStartAbs: number;
      /** The analysed frame itself, when lock-to-tracker is on (caller closes). */
      frame?: VideoFrame;
    }
  /** A frame was dropped without a result (not ready / error). */
  | { type: "idle" }
  /** The frame stream ended (camera track stopped or replaced). */
  | { type: "streamEnded" };
