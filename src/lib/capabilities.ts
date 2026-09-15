/** Detect WebGL2 and rough mobile heuristics for perf mode. */
export function detectCapabilities(): {
  webgl2: boolean;
  camera: boolean;
  preferMobilePerf: boolean;
} {
  const camera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  let webgl2 = false;
  try {
    const canvas = document.createElement("canvas");
    webgl2 = !!canvas.getContext("webgl2");
  } catch {
    webgl2 = false;
  }

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const preferMobilePerf =
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (typeof window !== "undefined" && window.innerWidth < 768);

  return { webgl2, camera, preferMobilePerf };
}

export function captureComposite(
  root: HTMLElement,
  filename = "eyenetra-try-on.png",
): void {
  const video = root.querySelector("video");
  const webglCanvas = root.querySelector("canvas");
  if (!video || !webglCanvas) return;

  const w = webglCanvas.clientWidth || video.clientWidth;
  const h = webglCanvas.clientHeight || video.clientHeight;
  const out = document.createElement("canvas");
  out.width = w * (window.devicePixelRatio || 1);
  out.height = h * (window.devicePixelRatio || 1);
  const ctx = out.getContext("2d");
  if (!ctx) return;

  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  // Mirror to match on-screen preview.
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  ctx.drawImage(webglCanvas, 0, 0, w, h);

  const link = document.createElement("a");
  link.download = filename;
  link.href = out.toDataURL("image/png");
  link.click();
}
