"use client";

import { FitCalibration } from "@/components/FitCalibration";
import { PoseSnapshotControl } from "@/components/PoseSnapshotControl";
import { TrackingProviderToggle } from "@/components/TrackingProviderToggle";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Customer-facing controls stay minimal (capture, fit calibration). Every
 * tuning/debug knob lives behind the "Dev" toggle so the kiosk screen reads
 * as a product, not a lab bench.
 */
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
  const renderMode = useTryOnStore((s) => s.renderMode);
  const setRenderMode = useTryOnStore((s) => s.setRenderMode);
  const perspTune = useTryOnStore((s) => s.perspTune);
  const setPerspTune = useTryOnStore((s) => s.setPerspTune);
  const showDevControls = useTryOnStore((s) => s.showDevControls);
  const setShowDevControls = useTryOnStore((s) => s.setShowDevControls);

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
        <span className="ml-auto text-xs text-zinc-500">
          {trackingStatus === "loading" && "Loading face model…"}
          {trackingStatus === "ready" &&
            `${fps || "—"} fps · ${hasFace ? "face locked" : "looking for face"}`}
          {trackingStatus === "error" && (trackingError ?? "Tracking error")}
          {isMobilePerfMode ? " · mobile perf" : ""}
        </span>
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showDevControls}
            onChange={(e) => setShowDevControls(e.target.checked)}
          />
          Dev
        </label>
      </div>

      <FitCalibration />

      {showDevControls ? (
        <div className="flex flex-col gap-3 border-t border-zinc-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
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
              tracker: {trackingProviderId ?? "mediapipe"}
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

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-zinc-500">Render</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-xs">
              <button
                type="button"
                onClick={() => setRenderMode("perspective")}
                className={`px-3 py-1.5 ${renderMode === "perspective" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600"}`}
              >
                Perspective 3D
              </button>
              <button
                type="button"
                onClick={() => setRenderMode("ortho")}
                className={`px-3 py-1.5 ${renderMode === "ortho" ? "bg-zinc-900 text-white" : "bg-white text-zinc-600"}`}
              >
                Ortho (legacy)
              </button>
            </div>
          </div>

          {renderMode === "perspective" ? (
            <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600">
              <span className="font-medium text-zinc-500">Perspective trims (residual only)</span>
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0">Down (cm)</span>
                <input
                  type="range"
                  min={-2}
                  max={4}
                  step={0.1}
                  value={perspTune.yOffsetCm}
                  onChange={(e) => setPerspTune({ yOffsetCm: Number(e.target.value) })}
                  className="w-full"
                />
                <span className="w-10 tabular-nums">{perspTune.yOffsetCm.toFixed(1)}</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0">Forward (cm)</span>
                <input
                  type="range"
                  min={-2}
                  max={4}
                  step={0.1}
                  value={perspTune.zOffsetCm}
                  onChange={(e) => setPerspTune({ zOffsetCm: Number(e.target.value) })}
                  className="w-full"
                />
                <span className="w-10 tabular-nums">{perspTune.zOffsetCm.toFixed(1)}</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0">Size ×</span>
                <input
                  type="range"
                  min={0.6}
                  max={1.6}
                  step={0.02}
                  value={perspTune.scaleTune}
                  onChange={(e) => setPerspTune({ scaleTune: Number(e.target.value) })}
                  className="w-full"
                />
                <span className="w-10 tabular-nums">{perspTune.scaleTune.toFixed(2)}</span>
              </label>
            </div>
          ) : null}

          <TrackingProviderToggle />
          <PoseSnapshotControl />
        </div>
      ) : null}
    </div>
  );
}
