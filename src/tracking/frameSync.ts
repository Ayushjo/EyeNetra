/**
 * Frame-synchronous display (technique observed in Meta's web try-on,
 * docs/meta-vto-analysis.md): every processed video frame is copied into a
 * display canvas immediately before landmark detection runs on that same
 * frame, and the stage shows the canvas instead of the live <video>. The
 * glasses pose published for that detection therefore belongs to exactly the
 * pixels on screen — no face/glasses drift during head motion, and no need
 * for latency-hiding prediction.
 */
let displayCanvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let painted = false;
/** Increments on every presented frame; the GL background uploads on change. */
let frameSeq = 0;
let glBackground = false;

export function setFrameSyncCanvas(canvas: HTMLCanvasElement | null): void {
  displayCanvas = canvas;
  // alpha: true so an unpainted canvas is transparent and the live <video>
  // underneath stays visible (never a black stage if painting fails).
  ctx = canvas ? canvas.getContext("2d") : null;
  painted = false;
}

/** True once the display canvas is actually showing tracked frames. */
export function frameSyncActive(): boolean {
  return displayCanvas != null && ctx != null && painted;
}

/** Copy the current video frame into the display canvas (same frame the detector sees). */
export function presentFrame(video: HTMLVideoElement): void {
  if (!displayCanvas || !ctx) return;
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
  return painted ? displayCanvas : null;
}

export function getFrameSeq(): number {
  return frameSeq;
}

/**
 * The 3D renderer draws the frame as its own background (same render pass as
 * the glasses — Meta's arrangement), so the DOM canvas can hide.
 */
export function setGlBackgroundActive(active: boolean): void {
  glBackground = active;
  if (displayCanvas) displayCanvas.style.visibility = active ? "hidden" : "visible";
}

export function glBackgroundActive(): boolean {
  return glBackground;
}
