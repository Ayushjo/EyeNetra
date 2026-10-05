"use client";

import { useTryOnStore } from "@/store/tryOnStore";
import type { TrackingProviderId } from "@/tracking/types";

/** Dev-only: switch TrackingProvider. Stops the inactive engine fully. */
export function TrackingProviderToggle() {
  const id = useTryOnStore((s) => s.trackingProviderId) ?? "mediapipe";
  const setTrackingProviderId = useTryOnStore(
    (s) => s.setTrackingProviderId,
  );

  if (process.env.NODE_ENV !== "development") return null;

  const select = (next: TrackingProviderId) => {
    if (typeof setTrackingProviderId !== "function") {
      console.error(
        "[EyeNetra:tracking] setTrackingProviderId missing — hard-refresh the page",
      );
      return;
    }
    if (next === id) return;
    console.info(
      `[EyeNetra:tracking] switch ${id} → ${next} (exclusive stop/start)`,
    );
    setTrackingProviderId(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
      <span className="text-xs font-medium text-zinc-500">Dev · tracker</span>
      <div
        role="tablist"
        aria-label="Tracking provider"
        className="inline-flex overflow-hidden rounded-lg border border-zinc-300"
      >
        <button
          type="button"
          role="tab"
          aria-selected={id === "mediapipe"}
          onClick={() => select("mediapipe")}
          className={`px-3 py-1.5 text-xs font-medium ${
            id === "mediapipe"
              ? "bg-zinc-900 text-white"
              : "bg-white text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          MediaPipe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={id === "jeeliz"}
          onClick={() => select("jeeliz")}
          className={`border-l border-zinc-300 px-3 py-1.5 text-xs font-medium ${
            id === "jeeliz"
              ? "bg-teal-800 text-white"
              : "bg-white text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          Jeeliz (exp)
        </button>
      </div>
      {id === "jeeliz" ? (
        <span className="text-xs text-amber-700">
          Experimental — product fit is MediaPipe only.
        </span>
      ) : (
        <span className="text-xs text-zinc-500">
          Product path · MediaPipe (iris mm + landmarks)
        </span>
      )}
    </div>
  );
}
