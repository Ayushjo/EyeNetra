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
}
