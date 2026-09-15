import {
  jeelizDetectToFrame,
  mediapipeCalibBaseScale,
  type JeelizDetectState,
  type JeelizScaleBind,
} from "@/tracking/jeelizPose";
import { useTryOnStore } from "@/store/tryOnStore";
import type { TrackingFrame, TrackingProvider } from "@/tracking/types";

type JeelizApi = {
  init: (opts: Record<string, unknown>) => void;
  destroy: (callback?: () => void) => void;
};

declare global {
  interface Window {
    JEELIZFACEFILTER?: JeelizApi;
    JEEFACEFILTERAPI?: JeelizApi;
  }
}

const JEELIZ_SCRIPT =
  "https://cdn.jsdelivr.net/gh/jeeliz/jeelizFaceFilter@master/dist/jeelizFaceFilter.js";

const SREF_SAMPLES = 24;

let scriptPromise: Promise<void> | null = null;

function getJeelizApi(): JeelizApi | null {
  if (typeof window === "undefined") return null;
  return window.JEELIZFACEFILTER ?? window.JEEFACEFILTERAPI ?? null;
}

function loadJeelizScript(): Promise<JeelizApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Jeeliz requires browser"));
  }
  const existing = getJeelizApi();
  if (existing) return Promise.resolve(existing);
  if (scriptPromise) {
    return scriptPromise.then(() => {
      const api = getJeelizApi();
      if (!api) throw new Error("JEELIZFACEFILTER missing after script load");
      return api;
    });
  }
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = JEELIZ_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load jeelizFaceFilter.js"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise.then(() => {
    const api = getJeelizApi();
    if (!api) throw new Error("JEELIZFACEFILTER missing after script load");
    return api;
  });
}

/**
 * Jeeliz FaceFilter provider — exclusive with MediaPipe.
 *
 * Size accuracy: after MediaPipe “Get your fit size” (and/or last MP scale),
 * we bind Jeeliz `s` → scene scale once per session so frame width matches
 * MediaPipe at switch distance, then tracks lean-in via s/sRef.
 */
export class JeelizProvider implements TrackingProvider {
  readonly id = "jeeliz" as const;

  private latest: TrackingFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private started = false;
  private api: JeelizApi | null = null;
  private onStatus?: (s: "loading" | "ready" | "error", err?: string) => void;
  private onFps?: (fps: number) => void;
  private frames = 0;
  private fpsWindowStart = 0;

  private sSamples: number[] = [];
  private scaleBind: JeelizScaleBind | null = null;

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
    this.onStatus?.("loading");
    this.frames = 0;
    this.fpsWindowStart = performance.now();
    this.sSamples = [];
    this.scaleBind = null;

    const API = await loadJeelizScript();
    this.api = API;

    const canvas = document.createElement("canvas");
    canvas.id = `eyenetra-jeeliz-${Date.now()}`;
    canvas.width = 512;
    canvas.height = 512;
    canvas.style.display = "none";
    document.body.appendChild(canvas);
    this.canvas = canvas;

    await new Promise<void>((resolve, reject) => {
      try {
        API.init({
          canvasId: canvas.id,
          NNCPath:
            "https://cdn.jsdelivr.net/gh/jeeliz/jeelizFaceFilter@master/neuralNets/",
          videoSettings: {
            videoElement: video,
          },
          callbackReady: (errCode: string | false) => {
            if (errCode) {
              this.onStatus?.("error", String(errCode));
              reject(new Error(String(errCode)));
              return;
            }
            this.started = true;
            this.onStatus?.("ready");
            resolve();
          },
          callbackTrack: (detectState: JeelizDetectState) => {
            const store = useTryOnStore.getState();
            const sku = store.selectedFrame();

            // Cross-bind: average Jeeliz `s` then lock to last MediaPipe scale.
            if (
              !this.scaleBind &&
              detectState.detected > 0.6 &&
              detectState.s > 0.05
            ) {
              this.sSamples.push(detectState.s);
              if (this.sSamples.length >= SREF_SAMPLES) {
                const sRef =
                  this.sSamples.reduce((a, b) => a + b, 0) /
                  this.sSamples.length;
                let scale0 = store.lastMediapipeScale;
                if (
                  !(scale0 && scale0 > 0) &&
                  store.faceProfile &&
                  store.faceProfile.faceWidthMm > 0
                ) {
                  scale0 = mediapipeCalibBaseScale(
                    sku.fit.frameWidthMm,
                    store.faceProfile,
                  );
                }
                if (scale0 && scale0 > 0 && sRef > 1e-6) {
                  this.scaleBind = { scale0, sRef };
                  console.info(
                    `[EyeNetra:calib] Jeeliz scale bound scale0=${scale0.toFixed(3)} sRef=${sRef.toFixed(4)} (hold still at calib distance when switching)`,
                  );
                }
              }
            }

            const holdScale =
              store.lastMediapipeScale && store.lastMediapipeScale > 0
                ? store.lastMediapipeScale
                : store.faceProfile && store.faceProfile.faceWidthMm > 0
                  ? mediapipeCalibBaseScale(
                      sku.fit.frameWidthMm,
                      store.faceProfile,
                    )
                  : null;

            this.latest = jeelizDetectToFrame({
              detect: detectState,
              videoWidth: video.videoWidth || 1280,
              videoHeight: video.videoHeight || 720,
              scaleMul: sku.fit.scaleMul,
              yOffsetFrac: sku.fit.yOffsetFrac,
              frameWidthMm: sku.fit.frameWidthMm,
              faceProfile: store.faceProfile,
              scaleBind: this.scaleBind,
              holdScale,
            });

            this.frames += 1;
            const now = performance.now();
            if (now - this.fpsWindowStart >= 1000) {
              this.onFps?.(this.frames);
              this.frames = 0;
              this.fpsWindowStart = now;
            }
          },
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  stop(): void {
    if (this.started && this.api?.destroy) {
      try {
        this.api.destroy();
      } catch {
        /* ignore */
      }
    }
    this.started = false;
    this.api = null;
    this.scaleBind = null;
    this.sSamples = [];
    if (this.canvas?.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.latest = null;
  }
}
