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

/** The camera <video> (registered by WebcamFeed) — the LIVE background source. */
export function setLiveVideo(video: HTMLVideoElement | null): void {
  liveVideo = video;
}

export function getLiveVideo(): HTMLVideoElement | null {
  return liveVideo;
}

/** Switch between LIVE (false, default) and frame-synchronous SYNC (true). */
export function setFrameSyncMode(on: boolean): void {
  if (syncMode === on) return;
  syncMode = on;
  painted = false;
  if (!on && displayCanvas && ctx) {
    // Leave no stale analysed frame on the DOM canvas.
    ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  }
}

export function frameSyncMode(): boolean {
  return syncMode;
}

/** True once the display canvas is actually showing tracked frames (SYNC). */
export function frameSyncActive(): boolean {
  return syncMode && displayCanvas != null && ctx != null && painted;
}

/** SYNC: copy the current video frame into the display canvas (same frame the detector sees). */
export function presentFrame(video: HTMLVideoElement): void {
  if (!syncMode || !displayCanvas || !ctx) return;
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  if (displayCanvas.width !== w || displayCanvas.height !== h) {
    displayCanvas.width = w;
    displayCanvas.height = h;
  }
  ctx.drawImage(video, 0, 0, w, h);
  painted = true;
  frameSeq++;
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
