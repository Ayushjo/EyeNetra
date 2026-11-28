"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { LandmarkOverlay } from "@/components/LandmarkOverlay";
import { CaptureStudio } from "@/components/CaptureStudio";
import { WebcamFeed } from "@/components/WebcamFeed";
import { BrandMark, FramingHint } from "@/components/StageHints";
import { FrameWheel } from "@/components/FrameWheel";
import { VoiceStageOverlay } from "@/components/voice/VoiceStageOverlay";
import { useTrackingSession } from "@/hooks/useTrackingSession";
import { useLightEstimate } from "@/hooks/useLightEstimate";
import { useAutoFitCalibration } from "@/hooks/useAutoFitCalibration";
import { useEarTracking } from "@/hooks/useEarTracking";
import { useFitProfileHydration } from "@/hooks/useFitProfileHydration";
import { useWebcam, type WebcamStatus } from "@/hooks/useWebcam";
import { detectCapabilities } from "@/lib/capabilities";
import { useTryOnStore } from "@/store/tryOnStore";

const TryOnCanvas = dynamic(
  () => import("@/components/TryOnCanvas").then((m) => m.TryOnCanvas),
  { ssr: false },
);

const WELCOME: Record<
  Exclude<WebcamStatus, "ready">,
  { title: string; body: string; action?: string; actionSub?: string }
> = {
  idle: {
    title: "चश्मा पहनकर देखिए",
    body: "फ्रेम सीधे आपके चेहरे पर — बोलकर या छूकर चुनिए।",
    action: "शुरू करें",
    actionSub: "Start try-on",
  },
  requesting: {
    title: "कैमरे की अनुमति दीजिए",
    body: "ब्राउज़र के संदेश में Allow चुनिए।",
  },
  denied: {
    title: "कैमरा बंद है",
    body: "ब्राउज़र की settings में Camera को Allow करें, फिर दोबारा कोशिश करें।",
    action: "दोबारा कोशिश करें",
    actionSub: "Try again",
  },
  unsupported: {
    title: "यहाँ कैमरा नहीं खुल सकता",
    body: "Chrome, Edge या Safari में खोलिए।",
  },
  error: {
    title: "कैमरा नहीं खुला",
    body: "कैमरा किसी और app में तो नहीं खुला? बंद करके दोबारा कोशिश करें।",
    action: "दोबारा कोशिश करें",
    actionSub: "Retry",
  },
};

/** Before the camera runs: welcome, permission and camera-problem screens. */
function WelcomeScreen({
  status,
  errorMessage,
  onStart,
}: {
  status: Exclude<WebcamStatus, "ready">;
  errorMessage: string | null;
  onStart: () => void;
}) {
  const w = WELCOME[status];
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-[radial-gradient(ellipse_at_top,#3f3f46_0%,#18181b_55%,#09090b_100%)] p-6 text-center">
      <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">{w.title}</h2>
      <p className="max-w-md text-base leading-relaxed text-zinc-300 sm:text-lg">{w.body}</p>
      {status === "requesting" ? (
        <span className="typing-dot h-2 w-2 rounded-full bg-white/70" aria-hidden />
      ) : null}
      {w.action ? (
        <button
          type="button"
          onClick={onStart}
          className="mt-2 flex flex-col items-center rounded-2xl bg-white px-8 py-3 text-zinc-900 shadow-[0_10px_40px_rgba(255,255,255,0.12)] transition hover:bg-zinc-100 active:scale-[0.98]"
        >
          <span className="text-lg font-semibold">{w.action}</span>
          {w.actionSub ? <span className="text-xs text-zinc-500">{w.actionSub}</span> : null}
        </button>
      ) : null}
      {status === "idle" ? (
        <p className="text-xs text-zinc-500">कैमरे का वीडियो इसी डिवाइस पर रहता है · Video stays on this device</p>
      ) : null}
      {errorMessage && status !== "idle" ? (
        <p className="max-w-md text-xs text-zinc-500">{errorMessage}</p>
      ) : null}
    </div>
  );
}

/**
 * The mirror: camera, glasses and the assistant overlay, sized to fill the
 * screen height at the camera's aspect ratio (landmarks ↔ pixels stay 1:1 —
 * no cover crop). Staff tools and the frame list live below it on the page.
 */
export function TryOnStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const { status, errorMessage, videoRef, start } = useWebcam();
  const capabilities = useTryOnStore((s) => s.capabilities);
  const setCapabilities = useTryOnStore((s) => s.setCapabilities);
  const setMobilePerfMode = useTryOnStore((s) => s.setMobilePerfMode);
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const videoWidth = useTryOnStore((s) => s.videoWidth);
  const videoHeight = useTryOnStore((s) => s.videoHeight);

  useEffect(() => {
    const caps = detectCapabilities();
    setCapabilities({ webgl2: caps.webgl2, camera: caps.camera });
    setMobilePerfMode(caps.preferMobilePerf);
  }, [setCapabilities, setMobilePerfMode]);

  // Apply ?frame=&variant= deep links (old /voice links). Reads
  // window.location directly instead of useSearchParams so the page needs
  // no Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const frameId = params.get("frame");
    const variantId = params.get("variant");
    if (!frameId && !variantId) return;
    // setFrame before setVariant — setFrame resets the variant to default.
    if (frameId) useTryOnStore.getState().setFrame(frameId);
    if (variantId) useTryOnStore.getState().setVariant(variantId);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useFitProfileHydration();
  useTrackingSession(videoRef, status === "ready");
  useLightEstimate(videoRef, status === "ready");
  useAutoFitCalibration(status === "ready");
  useEarTracking(status === "ready");

  const webglBlocked = capabilities && !capabilities.webgl2;
  // Match stage to camera aspect so landmarks ↔ pixels stay 1:1 (no cover crop).
  const stageAspect =
    videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 4 / 3;

  return (
    <>
      <CaptureStudio />
      <div
        id="tryon-stage"
        ref={stageRef}
        className="relative mx-auto overflow-hidden bg-zinc-900 shadow-2xl ring-1 ring-white/10 sm:rounded-3xl"
        style={{
          aspectRatio: `${stageAspect}`,
          // As large as the screen allows: full width, or full height (less
          // the page padding) — whichever binds first.
          width: `min(100%, calc((100svh - 2rem) * ${stageAspect}))`,
        }}
      >
        {/* Always mounted so getUserMedia can attach before ready UI. */}
        <WebcamFeed
          videoRef={videoRef}
          className={`absolute inset-0 ${status === "ready" ? "" : "invisible"}`}
        />

        {status === "ready" && !webglBlocked ? (
          <>
            <LandmarkOverlay />
            <TryOnCanvas />
            <FramingHint />
            <VoiceStageOverlay />
            <FrameWheel />
            {trackingStatus === "loading" ? (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
                <div className="flex items-center gap-3 rounded-full bg-white/90 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-lg">
                  <span className="typing-dot h-2 w-2 rounded-full bg-zinc-500" aria-hidden />
                  चेहरा पहचानने की तैयारी…
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {status !== "ready" ? (
          <WelcomeScreen status={status} errorMessage={errorMessage} onStart={() => void start()} />
        ) : null}

        {status === "ready" && webglBlocked ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/85 p-6 text-center">
            <div className="max-w-md space-y-2">
              <h2 className="text-xl font-semibold text-white">3D के लिए WebGL2 चाहिए</h2>
              <p className="text-sm text-zinc-400">
                This try-on needs WebGL2. Update the browser or turn on hardware acceleration.
              </p>
            </div>
          </div>
        ) : null}

        <BrandMark />
      </div>
    </>
  );
}
