"use client";

import { useEffect } from "react";
import { TryOnControls } from "@/components/TryOnControls";
import { freezeCaptureFromStage } from "@/components/CaptureStudio";
import { hydrateUiStore, useUiStore } from "@/store/uiStore";
import { useTryOnStore } from "@/store/tryOnStore";
import type { DetectEngine } from "@/tracking/types";

const ENGINE_LABEL: Record<DetectEngine, string> = {
  "worker-cpu": "Worker · CPU",
  "worker-gpu": "Worker · GPU",
  main: "Main thread",
};

/** Client start-up for page preferences + the staff-mode shortcut (Ctrl+Shift+S). */
export function UiBootstrap() {
  useEffect(() => {
    hydrateUiStore();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setStaffMode(!ui.staffMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/**
 * Staff tools — capture, fit-size calibration, tracking/debug knobs. Hidden
 * from customers; switch on by holding the EyeNetra wordmark on the mirror,
 * Ctrl+Shift+S, or ?staff=1.
 */
export function StaffPanel() {
  const staffMode = useUiStore((s) => s.staffMode);
  const setStaffMode = useUiStore((s) => s.setStaffMode);
  const syncDisplay = useUiStore((s) => s.syncDisplay);
  const setSyncDisplay = useUiStore((s) => s.setSyncDisplay);
  const trackingStatus = useTryOnStore((s) => s.trackingStatus);
  const fps = useTryOnStore((s) => s.fps);
  const detectEngine = useUiStore((s) => s.detectEngine);
  const setDetectEngine = useUiStore((s) => s.setDetectEngine);
  const trackerStats = useUiStore((s) => s.trackerStats);
  const predictFromCapture = useUiStore((s) => s.predictFromCapture);
  const setPredictFromCapture = useUiStore((s) => s.setPredictFromCapture);
  const lowLag = useUiStore((s) => s.lowLagSmoothing);
  const setLowLag = useUiStore((s) => s.setLowLagSmoothing);
  const paceRender = useUiStore((s) => s.paceRenderToCamera);
  const setPaceRender = useUiStore((s) => s.setPaceRenderToCamera);
  if (!staffMode) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-amber-400/30 bg-zinc-900/80 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Staff tools</p>
        <button
          type="button"
          onClick={() => setStaffMode(false)}
          className="rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
        >
          Exit staff mode
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-300">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={syncDisplay}
            onChange={(e) => setSyncDisplay(e.target.checked)}
          />
          Lock video to tracker
          <span className="text-xs text-zinc-500">
            (shows the frame each pose came from: no glasses lag; picture at tracker speed)
          </span>
        </label>
        <label className={`inline-flex items-center gap-2 ${syncDisplay ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            checked={predictFromCapture}
            disabled={syncDisplay}
            onChange={(e) => setPredictFromCapture(e.target.checked)}
          />
          Predict from capture time
          <span className="text-xs text-zinc-500">(unlocked: lead the glasses by the pose&apos;s real age)</span>
        </label>
        <label className={`inline-flex items-center gap-2 ${syncDisplay ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            checked={lowLag}
            disabled={syncDisplay}
            onChange={(e) => setLowLag(e.target.checked)}
          />
          Low-lag smoothing
          <span className="text-xs text-zinc-500">(unlocked: less trailing, more jitter at rest)</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={paceRender}
            onChange={(e) => setPaceRender(e.target.checked)}
          />
          Pace 3D to camera
          <span className="text-xs text-zinc-500">(redraw only on new camera frames — more GPU for tracking)</span>
        </label>
        <label className="inline-flex items-center gap-2">
          Face detection
          <select
            value={detectEngine}
            onChange={(e) => setDetectEngine(e.target.value as DetectEngine)}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 disabled:opacity-50"
          >
            {(Object.keys(ENGINE_LABEL) as DetectEngine[]).map((id) => (
              <option key={id} value={id}>
                {ENGINE_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
        {trackingStatus === "ready" ? (
          <span data-testid="tracker-readout" className="text-xs tabular-nums text-zinc-400">
            tracker {fps || "—"} fps
            {trackerStats
              ? ` · ${ENGINE_LABEL[trackerStats.engine]}${
                  trackerStats.detectMs != null ? ` · ${trackerStats.detectMs.toFixed(1)} ms` : ""
                }`
              : ""}
          </span>
        ) : null}
      </div>
      {trackingStatus === "idle" ? (
        <p className="text-sm text-zinc-400">Start the camera to use capture and fit tools.</p>
      ) : (
        <TryOnControls
          onCapture={() => {
            const stage = document.getElementById("tryon-stage");
            if (!(stage instanceof HTMLDivElement)) return;
            const snap = freezeCaptureFromStage(stage);
            if (snap) useTryOnStore.getState().setCapture(snap);
          }}
        />
      )}
    </section>
  );
}
