"use client";

import { useEffect, useRef } from "react";
import { loadFaceProfile } from "@/lib/faceProfile";
import { loadHeadAnchors } from "@/lib/headAnchors";
import { loadCameraCalib } from "@/lib/cameraCalib";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Load the saved fit size (face profile, head anchors, camera calibration)
 * from localStorage once. Lives on the stage, not in the staff-only fit
 * panel, so customers get the stored fit without that panel mounted.
 *
 * Runs once — does NOT re-run when faceProfile flips (that previously fought
 * Clear / HMR and looked like silent re-calibration).
 */
export function useFitProfileHydration() {
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const store = useTryOnStore.getState();
    if (!store.faceProfile) {
      const stored = loadFaceProfile();
      if (stored) {
        console.info("[EyeNetra:calib:write] hydrate from localStorage", {
          ipdMm: stored.ipdMm,
          faceWidthMm: stored.faceWidthMm,
          refEyeSpanScene: stored.refEyeSpanScene,
        });
        store.setFaceProfile(stored);
        const anchors = loadHeadAnchors();
        if (anchors) store.setHeadAnchors(anchors);
      }
    }
    const calib = loadCameraCalib();
    if (calib) {
      store.setCameraCalib(calib);
      console.info("[EyeNetra:calib:write] hydrate cameraCalib", calib);
    }
  }, []);
}
