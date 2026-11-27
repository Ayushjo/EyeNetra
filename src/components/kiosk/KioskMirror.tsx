"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { WebcamFeed } from "@/components/WebcamFeed";
import { useTrackingSession } from "@/hooks/useTrackingSession";
import { useLightEstimate } from "@/hooks/useLightEstimate";
import { useAutoFitCalibration } from "@/hooks/useAutoFitCalibration";
import { useEarTracking } from "@/hooks/useEarTracking";
import { useWebcam } from "@/hooks/useWebcam";
import { detectCapabilities } from "@/lib/capabilities";
import { useTryOnStore } from "@/store/tryOnStore";

const TryOnCanvas = dynamic(() => import("@/components/TryOnCanvas").then((m) => m.TryOnCanvas), { ssr: false });

/**
 * The try-on mirror for the kiosk. The camera and face tracker warm up as
 * soon as a conversation starts (`warm`) so there is no wait later, but the
 * customer's face is only shown once the assistant has understood them and
 * reached the try-on stage (`visible`) — the SOP: talk first, then show.
 */
export function KioskMirror({ warm, visible }: { warm: boolean; visible: boolean }) {
  const { status, errorMessage, videoRef, start, stop } = useWebcam();
  const setCapabilities = useTryOnStore((s) => s.setCapabilities);
  const setMobilePerfMode = useTryOnStore((s) => s.setMobilePerfMode);
  const capabilities = useTryOnStore((s) => s.capabilities);
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const faceDetected = useTryOnStore((s) => s.hasFace);
  const videoWidth = useTryOnStore((s) => s.videoWidth);
  const videoHeight = useTryOnStore((s) => s.videoHeight);

  useEffect(() => {
    const caps = detectCapabilities();
    setCapabilities({ webgl2: caps.webgl2, camera: caps.camera });
    setMobilePerfMode(caps.preferMobilePerf);
  }, [setCapabilities, setMobilePerfMode]);

  useEffect(() => {
    if (warm && status === "idle") void start();
    if (!warm && status === "ready") stop();
  }, [warm, status, start, stop]);

  const ready = status === "ready";
  useTrackingSession(videoRef, ready);
  useLightEstimate(videoRef, ready);
  useAutoFitCalibration(ready);
  useEarTracking(ready);

  const webglBlocked = capabilities && !capabilities.webgl2;
  const aspect = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 4 / 3;

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center transition-opacity duration-700 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!visible}
      data-testid="kiosk-mirror"
      data-visible={visible}
    >
      <div
        id="tryon-stage"
        className={`relative max-h-full max-w-full overflow-hidden rounded-[28px] bg-[#16120E] shadow-[0_30px_80px_-30px_rgba(40,25,10,0.55)] ring-1 ring-black/10 ${visible ? "kiosk-mirror-in" : ""}`}
        style={{ aspectRatio: `${aspect}`, height: "100%" }}
      >
        <WebcamFeed videoRef={videoRef} className={`absolute inset-0 ${ready ? "" : "invisible"}`} />
        {ready && !webglBlocked ? <TryOnCanvas /> : null}

        {visible && ready && trackingStatus === "loading" ? (
          <MirrorNote text="आईना तैयार हो रहा है…" />
        ) : null}
        {visible && ready && trackingStatus !== "loading" && !faceDetected ? (
          <MirrorNote text="कैमरे की तरफ़ सीधे देखिए" soft />
        ) : null}
        {visible && !ready && status !== "requesting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center text-white/85">
            <p className="font-[family-name:var(--font-display)] text-2xl">कैमरा चालू नहीं हो पाया</p>
            <p className="max-w-sm text-base text-white/60">
              {status === "denied" ? "कैमरे की अनुमति दीजिए, या हमारे स्टाफ़ से मदद लीजिए।" : errorMessage ?? ""}
            </p>
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-full bg-white px-6 py-3 text-base font-medium text-ink"
            >
              फिर से कोशिश करें
            </button>
          </div>
        ) : null}
        {visible && webglBlocked ? <MirrorNote text="इस ब्राउज़र में 3D आईना नहीं चल सकता" /> : null}
      </div>
    </div>
  );
}

function MirrorNote({ text, soft = false }: { text: string; soft?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center">
      <span
        className={`rounded-full px-5 py-2 text-base font-medium backdrop-blur-md ${
          soft ? "bg-black/35 text-white/90" : "bg-white/85 text-ink"
        }`}
      >
        {text}
      </span>
    </div>
  );
}
