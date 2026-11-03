"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { FramePicker } from "@/components/FramePicker";
import { LandmarkOverlay } from "@/components/LandmarkOverlay";
import { TryOnControls } from "@/components/TryOnControls";
import {
  CaptureStudio,
  freezeCaptureFromStage,
} from "@/components/CaptureStudio";
import { WebcamFeed } from "@/components/WebcamFeed";
import { VoiceStageOverlay } from "@/components/voice/VoiceStageOverlay";
import { useTrackingSession } from "@/hooks/useTrackingSession";
import { useLightEstimate } from "@/hooks/useLightEstimate";
import { useAutoFitCalibration } from "@/hooks/useAutoFitCalibration";
import { useEarTracking } from "@/hooks/useEarTracking";
import { useWebcam } from "@/hooks/useWebcam";
import { detectCapabilities } from "@/lib/capabilities";
import { useTryOnStore } from "@/store/tryOnStore";

const TryOnCanvas = dynamic(
  () => import("@/components/TryOnCanvas").then((m) => m.TryOnCanvas),
  { ssr: false },
);

function StatusPanel({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl bg-white/90 px-8 py-10 text-center shadow-lg backdrop-blur-sm">
      <h2 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h2>
      <p className="text-sm leading-relaxed text-zinc-600">{body}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function TryOnStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const { status, errorMessage, videoRef, start } = useWebcam();
  const capabilities = useTryOnStore((s) => s.capabilities);
  const setCapabilities = useTryOnStore((s) => s.setCapabilities);
  const setMobilePerfMode = useTryOnStore((s) => s.setMobilePerfMode);
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const videoWidth = useTryOnStore((s) => s.videoWidth);
  const videoHeight = useTryOnStore((s) => s.videoHeight);

  const setCapture = useTryOnStore((s) => s.setCapture);

  useEffect(() => {
    const caps = detectCapabilities();
    setCapabilities({ webgl2: caps.webgl2, camera: caps.camera });
    setMobilePerfMode(caps.preferMobilePerf);
  }, [setCapabilities, setMobilePerfMode]);

  // Apply ?frame=&variant= deep links — the /voice page navigates here with
  // these params when the agent pushes a try_on_frame suggestion. Reads
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

  useTrackingSession(videoRef, status === "ready");
  useLightEstimate(videoRef, status === "ready");
  useAutoFitCalibration(status === "ready");
  useEarTracking(status === "ready");

  const webglBlocked = capabilities && !capabilities.webgl2;
  // Match stage to camera aspect so landmarks ↔ pixels stay 1:1 (no cover crop).
  const stageAspect =
    videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 4 / 3;

  return (
    <div className="space-y-4">
      <CaptureStudio />
      <div
        id="tryon-stage"
        ref={stageRef}
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-zinc-900 shadow-xl ring-1 ring-zinc-200"
        style={{ aspectRatio: `${stageAspect}` }}
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
            <VoiceStageOverlay />
            <div className="pointer-events-none absolute left-4 top-4 z-30 rounded-md bg-black/55 px-3 py-1.5 text-xs font-medium tracking-wide text-white">
              {trackingStatus === "loading"
                ? "Loading face tracker…"
                : "Live try-on"}
            </div>
            {trackingStatus === "loading" ? (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35">
                <div className="rounded-xl bg-white px-5 py-4 text-sm text-zinc-800 shadow-lg">
                  Loading MediaPipe WASM + face model…
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {status !== "ready" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 p-6">
            {status === "idle" ? (
              <StatusPanel
                title="Virtual try-on"
                body="Allow camera access to try on frames in real time. Video stays on your device."
                actionLabel="Enable camera"
                onAction={() => void start()}
              />
            ) : null}
            {status === "requesting" ? (
              <StatusPanel
                title="Requesting camera…"
                body="Check the browser prompt and choose Allow."
              />
            ) : null}
            {status === "denied" ? (
              <StatusPanel
                title="Camera blocked"
                body={
                  errorMessage ??
                  "Permission was denied. Update site settings, then try again."
                }
                actionLabel="Try again"
                onAction={() => void start()}
              />
            ) : null}
            {status === "unsupported" ? (
              <StatusPanel
                title="Camera not supported"
                body={
                  errorMessage ??
                  "This browser cannot access a webcam. Try Chrome, Safari, or Edge on HTTPS/localhost."
                }
              />
            ) : null}
            {status === "error" ? (
              <StatusPanel
                title="Camera unavailable"
                body={errorMessage ?? "Could not start the camera."}
                actionLabel="Retry"
                onAction={() => void start()}
              />
            ) : null}
          </div>
        ) : null}

        {status === "ready" && webglBlocked ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-900/80 p-6">
            <StatusPanel
              title="WebGL2 required"
              body="This try-on needs WebGL2 for 3D frame rendering. Try updating your browser or enabling hardware acceleration."
            />
          </div>
        ) : null}
      </div>

      {status === "ready" && !webglBlocked ? (
        <>
          <TryOnControls
            onCapture={() => {
              if (!stageRef.current) return;
              const snap = freezeCaptureFromStage(stageRef.current);
              if (snap) setCapture(snap);
            }}
          />
          <FramePicker />
        </>
      ) : null}
    </div>
  );
}
