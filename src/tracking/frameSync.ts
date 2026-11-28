/**
 * How the camera picture reaches the screen. Two modes:
 *
 * LIVE (default): the 3D renderer draws the <video> itself as its background
 * on every render frame — a GPU-to-GPU texture upload — so the picture runs
 * at the camera's frame rate whatever the tracker's speed. The glasses follow
 * the latest detection with smoothing + constant-velocity prediction
 * (useFitEngine), which hides most of the tracker's latency.
 *
 * SYNC (staff option): frame-synchronous display, the technique observed in
 * Meta's web try-on (docs/meta-vto-analysis.md) — every processed video frame
 * is copied into a display canvas immediately before landmark detection runs
 * on that same frame, and the stage shows that canvas. Glasses and face can
 * never drift apart, but the picture only updates as fast as the tracker:
 * on a slow machine the whole mirror looks like a low-fps camera.
 */
import { devCount } from "@/lib/devMetrics";

let displayCanvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let painted = false;
/** Increments on every presented frame; the GL background uploads on change. */
let frameSeq = 0;
let glBackground = false;
let syncMode = false;
let liveVideo: HTMLVideoElement | null = null;

export function setFrameSyncCanvas(canvas: HTMLCanvasElement | null): void {
  displayCanvas = canvas;
  // alpha: true so an unpainted canvas is transparent and the live <video>
  // underneath stays visible (never a black stage if painting fails).
  ctx = canvas ? canvas.getContext("2d") : null;
  painted = false;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback: (handle: number) => void;
};
let liveFrameHandle: number | null = null;
/** performance.now() when the <video> last got a new camera frame (LIVE). */
let liveFrameAtMs: number | null = null;

/** The camera <video> (registered by WebcamFeed) — the LIVE background source. */
export function setLiveVideo(video: HTMLVideoElement | null): void {
  const prev = liveVideo as VideoWithFrameCallback | null;
  if (prev && liveFrameHandle != null && typeof prev.cancelVideoFrameCallback === "function") {
    prev.cancelVideoFrameCallback(liveFrameHandle);
  }
  liveFrameHandle = null;
  liveFrameAtMs = null;
  liveVideo = video;
  const v = video as VideoWithFrameCallback | null;
  if (!v || typeof v.requestVideoFrameCallback !== "function") return;
  const tick = (now: number) => {
    if (liveVideo !== v) return;
    liveFrameAtMs = now;
    liveFrameHandle = v.requestVideoFrameCallback(tick);
  };
  liveFrameHandle = v.requestVideoFrameCallback(tick);
}

/**
 * When the picture LIVE mode is showing arrived — on the same clock as
 * TrackingFrame.frameAtMs, so the difference is how far the glasses' pose
 * trails the picture ("predict from capture time").
 */
export function getLiveFrameAtMs(): number | null {
  return liveFrameAtMs;
}

export function getLiveVideo(): HTMLVideoElement | null {
  return liveVideo;
}

/** Switch between LIVE (false, default) and frame-synchronous SYNC (true). */
export function setFrameSyncMode(on: boolean): void {
  if (syncMode === on) return;
  syncMode = on;
  painted = false;
  dropSyncFrame();
  if (!on && displayCanvas && ctx) {
    // Leave no stale analysed frame on the DOM canvas.
    ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  }
}

export function frameSyncMode(): boolean {
  return syncMode;
}

/** True once tracked frames are actually being shown (SYNC). */
export function frameSyncActive(): boolean {
  return syncMode && painted && (syncFrame != null || (displayCanvas != null && ctx != null));
}

const presentListeners = new Set<() => void>();
/**
 * SYNC frame handed over by the worker tracker, shown by the 3D background as
 * a texture straight from the VideoFrame (no 2D-canvas copy). Owned here:
 * closed when the next one arrives or SYNC turns off.
 */
let syncFrame: VideoFrame | null = null;

function dropSyncFrame() {
  syncFrame?.close();
  syncFrame = null;
}

function announce() {
  devCount("shown");
  painted = true;
  frameSeq++;
  for (const cb of presentListeners) cb();
}

/**
 * SYNC: copy a camera frame into the display canvas — the very frame the
 * detector analysed. The main-thread tracker passes the <video> just before
 * detecting on it; the worker's bitmap path passes its full-size copy (the
 * caller closes that afterwards).
 */
export function presentFrame(source: CanvasImageSource, w: number, h: number): void {
  if (!syncMode || !displayCanvas || !ctx) return;
  if (!w || !h) return;
  dropSyncFrame();
  drawToCanvas(source, w, h);
  announce();
}

/**
 * SYNC, worker stream path: show this analysed VideoFrame. Takes ownership —
 * the caller must not close it. The 3D background uploads it directly; the
 * DOM canvas gets a copy only while the 3D background isn't running.
 */
export function presentVideoFrame(frame: VideoFrame): void {
  if (!syncMode) {
    frame.close();
    return;
  }
  dropSyncFrame();
  syncFrame = frame;
  if (!glBackground) drawToCanvas(frame, frame.displayWidth, frame.displayHeight);
  announce();
}

function drawToCanvas(source: CanvasImageSource, w: number, h: number) {
  if (!displayCanvas || !ctx || !w || !h) return;
  if (displayCanvas.width !== w || displayCanvas.height !== h) {
    displayCanvas.width = w;
    displayCanvas.height = h;
  }
  ctx.drawImage(source, 0, 0, w, h);
}

/** The worker's current SYNC VideoFrame (3D background texture source), if any. */
export function getSyncVideoFrame(): VideoFrame | null {
  return syncMode && painted ? syncFrame : null;
}

/** Called right after each SYNC frame is painted (the paced 3D loop draws then). */
export function onFramePresented(cb: () => void): () => void {
  presentListeners.add(cb);
  return () => {
    presentListeners.delete(cb);
  };
}

export function getFrameSyncCanvas(): HTMLCanvasElement | null {
  return syncMode && painted ? displayCanvas : null;
}

export function getFrameSeq(): number {
  return frameSeq;
}

/**
 * The 3D renderer draws the frame as its own background (same render pass as
 * the glasses — Meta's arrangement), so the DOM canvas can hide.
 */
export function setGlBackgroundActive(active: boolean): void {
  if (glBackground === active) return; // called every render frame
  glBackground = active;
  if (displayCanvas) displayCanvas.style.visibility = active ? "hidden" : "visible";
}

export function glBackgroundActive(): boolean {
  return glBackground;
}
