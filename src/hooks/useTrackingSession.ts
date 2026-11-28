"use client";

import { useEffect, useRef } from "react";
import { MediaPipeProvider } from "@/tracking/MediaPipeProvider";
import { WorkerMediaPipeProvider } from "@/tracking/WorkerMediaPipeProvider";
import { JeelizProvider } from "@/tracking/JeelizProvider";
import type { TrackingFrame, TrackingProvider } from "@/tracking/types";
import { useTryOnStore } from "@/store/tryOnStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Starts exactly one TrackingProvider. On provider id change: stop old fully,
 * then start new — never run MediaPipe + Jeeliz together.
 *
 * MediaPipe runs in a Web Worker unless staff chose the main thread or the
 * worker can't start — then it falls back to the main-thread tracker. Both
 * follow "lock video to tracker" live, without a restart.
 */
export function useTrackingSession(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  const providerId =
    useTryOnStore((s) => s.trackingProviderId) ?? "mediapipe";
  const setTrackingStatus = useTryOnStore((s) => s.setTrackingStatus);
  const setFps = useTryOnStore((s) => s.setFps);
  const setTrackingFrame = useTryOnStore((s) => s.setTrackingFrame);
  const setTrackerStats = useUiStore((s) => s.setTrackerStats);
  const engine = useUiStore((s) => s.detectEngine);
  const providerRef = useRef<TrackingProvider | null>(null);
  const publishRaf = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let lastPublished: object | null = null;
    const publish = () => {
      if (cancelled) return;
      const frame = providerRef.current?.getFrame() ?? null;
      if (frame !== lastPublished) {
        setTrackingFrame(frame);
        lastPublished = frame;
      }
      publishRaf.current = requestAnimationFrame(publish);
    };

    const run = async () => {
      // Tear down any previous provider first (exclusive).
      providerRef.current?.stop();
      providerRef.current = null;
      setTrackingFrame(null);

      const opts = {
        onStatus: (s: "loading" | "ready" | "error", err?: string) => {
          if (!cancelled) setTrackingStatus(s, err ?? null);
        },
        onFps: (fps: number) => {
          if (!cancelled) setFps(fps);
        },
        onStats: (stats: Parameters<typeof setTrackerStats>[0]) => {
          if (!cancelled) setTrackerStats(stats);
        },
        // Publish at once rather than on the next animation frame, so a
        // locked (SYNC) frame and its pose always reach the same draw.
        onFrame: (frame: TrackingFrame) => {
          if (cancelled) return;
          setTrackingFrame(frame);
          lastPublished = frame;
        },
      };
      setTrackerStats(null);

      const useWorker =
        providerId !== "jeeliz" && engine !== "main" && WorkerMediaPipeProvider.supported();
      if (useWorker) {
        const workerProvider = new WorkerMediaPipeProvider(
          engine === "worker-gpu" ? "GPU" : "CPU",
          opts,
        );
        providerRef.current = workerProvider;
        try {
          await workerProvider.start(video);
          if (cancelled) {
            workerProvider.stop();
            return;
          }
          publish();
          return;
        } catch (err) {
          workerProvider.stop();
          providerRef.current = null;
          if (cancelled) return;
          console.warn("[EyeNetra:tracking] worker tracker failed — using the main thread", err);
        }
      }

      const provider: TrackingProvider =
        providerId === "jeeliz"
          ? new JeelizProvider(opts)
          : new MediaPipeProvider(opts);

      providerRef.current = provider;
      try {
        await provider.start(video);
        if (cancelled) {
          provider.stop();
          return;
        }
        publish();
      } catch (err) {
        console.warn("[EyeNetra:tracking] start failed", err);
        provider.stop();
        providerRef.current = null;
        // Don't leave the UI stuck on a dead Jeeliz session with no frames.
        if (providerId === "jeeliz" && !cancelled) {
          const store = useTryOnStore.getState();
          store.setTrackingStatus(
            "error",
            err instanceof Error ? err.message : "Jeeliz failed to start",
          );
          console.info(
            "[EyeNetra:tracking] Jeeliz failed — reverting to MediaPipe",
          );
          store.setTrackingProviderId("mediapipe");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (publishRaf.current != null) {
        cancelAnimationFrame(publishRaf.current);
        publishRaf.current = null;
      }
      providerRef.current?.stop();
      providerRef.current = null;
      setTrackingFrame(null);
    };
  }, [
    enabled,
    providerId,
    engine,
    videoRef,
    setTrackingStatus,
    setFps,
    setTrackingFrame,
    setTrackerStats,
  ]);
}
