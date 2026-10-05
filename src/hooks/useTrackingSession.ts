"use client";

import { useEffect, useRef } from "react";
import { MediaPipeProvider } from "@/tracking/MediaPipeProvider";
import { JeelizProvider } from "@/tracking/JeelizProvider";
import type { TrackingProvider } from "@/tracking/types";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Starts exactly one TrackingProvider. On provider id change: stop old fully,
 * then start new — never run MediaPipe + Jeeliz together.
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
      };

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
    videoRef,
    setTrackingStatus,
    setFps,
    setTrackingFrame,
  ]);
}
