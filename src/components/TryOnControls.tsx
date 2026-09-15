"use client";

import { FitCalibration } from "@/components/FitCalibration";
import { PoseSnapshotControl } from "@/components/PoseSnapshotControl";
import { TrackingProviderToggle } from "@/components/TrackingProviderToggle";
import { useTryOnStore } from "@/store/tryOnStore";

export function TryOnControls({
  onCapture,
}: {
  onCapture: () => void;
}) {
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const trackingError = useTryOnStore((s) => s.trackingError);
  const showLandmarks = useTryOnStore((s) => s.showLandmarks);
  const setShowLandmarks = useTryOnStore((s) => s.setShowLandmarks);
  const smoothingFactor = useTryOnStore((s) => s.smoothingFactor);
  const setSmoothingFactor = useTryOnStore((s) => s.setSmoothingFactor);
  const fps = useTryOnStore((s) => s.fps);
  const hasFace = useTryOnStore((s) => s.hasFace);
  const isMobilePerfMode = useTryOnStore((s) => s.isMobilePerfMode);
  const debugPoseLog = useTryOnStore((s) => s.debugPoseLog);
  const setDebugPoseLog = useTryOnStore((s) => s.setDebugPoseLog);
  const showFitDebug = useTryOnStore((s) => s.showFitDebug);
  const setShowFitDebug = useTryOnStore((s) => s.setShowFitDebug);
  const trackingProviderId = useTryOnStore((s) => s.trackingProviderId);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCapture}
          disabled={!hasFace}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          Capture
        </button>
        <button
          type="button"
          onClick={() => setShowLandmarks(!showLandmarks)}
          className="rounded-lg border border-zinc-300 px-3 py-2 hover:border-zinc-500"
          title="Draw landmark dots only — does not change glasses pose math"
        >
          {showLandmarks ? "Hide landmarks" : "Show landmarks"}
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={debugPoseLog}
            onChange={(e) => setDebugPoseLog(e.target.checked)}
          />
          Pose log
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={showFitDebug}
            onChange={(e) => setShowFitDebug(e.target.checked)}
          />
          Anchor axes
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          {trackingStatus === "loading" && "Loading face model…"}
          {trackingStatus === "ready" &&
            `${fps || "—"} fps · ${hasFace ? "face locked" : "looking for face"} · ${trackingProviderId ?? "mediapipe"}`}
          {trackingStatus === "error" && (trackingError ?? "Tracking error")}
          {isMobilePerfMode ? " · mobile perf" : ""}
        </span>
      </div>

      <label className="flex items-center gap-3 text-xs text-zinc-600">
        <span className="w-24 shrink-0">Smoothing</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={smoothingFactor}
          onChange={(e) => setSmoothingFactor(Number(e.target.value))}
          className="w-full"
        />
        <span className="w-10 tabular-nums">{smoothingFactor.toFixed(2)}</span>
      </label>

      <FitCalibration />
      <TrackingProviderToggle />
      <PoseSnapshotControl />
    </div>
  );
}
