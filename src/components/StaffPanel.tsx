"use client";

import { useEffect } from "react";
import { TryOnControls } from "@/components/TryOnControls";
import { freezeCaptureFromStage } from "@/components/CaptureStudio";
import { hydrateUiStore, useUiStore } from "@/store/uiStore";
import { useTryOnStore } from "@/store/tryOnStore";

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
            (no glasses drift, but the picture runs at tracker speed)
          </span>
        </label>
        {trackingStatus === "ready" ? (
          <span className="text-xs tabular-nums text-zinc-400">tracker {fps || "—"} fps</span>
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
