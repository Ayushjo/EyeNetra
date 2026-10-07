"use client";

import { useEffect } from "react";
import { Matrix4, Vector3 } from "three";
import { CANONICAL_CM, canonicalTragion } from "@/lib/canonicalFace";
import { earRay, sideVisible, triangulateWithPrior, type EarRay } from "@/lib/earTracking";
import { decomposeHeadMatrix } from "@/lib/headAnchors";
import { useTryOnStore } from "@/store/tryOnStore";

const SAMPLE_EVERY_MS = 100;
const SOLVE_EVERY_MS = 1000;
/** Sliding window per side (~15 s of qualifying frames). */
const WINDOW = 150;
const MIN_RAYS = 20;
/** Only republish anchors when a tragion moved this much (cm). */
const UPDATE_THRESHOLD_CM = 0.2;
/** Half-width correction cap (cm) vs the canonical 234↔454 half-width. */
const MAX_WIDTH_DELTA_CM = 1.0;

const SIDES = [
  { idx: 234, side: -1 as const, key: "tragionLHeadCm" as const, tragion: "L" as const },
  { idx: 454, side: 1 as const, key: "tragionRHeadCm" as const, tragion: "R" as const },
];

/**
 * Track the user's ear-junction WIDTH (234↔454) by multi-view triangulation
 * over the live stream (see lib/earTracking) and set the tragion anchors' x
 * from it, so the temples aim at THIS user's head width. Only the symmetric
 * width is applied — see the live-data note in the solve below.
 */
export function useEarTracking(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const rays: Record<number, EarRay[]> = { 234: [], 454: [] };
    const head = new Matrix4();
    let lastTs = -Infinity;
    let lastSolve = 0;

    const id = setInterval(() => {
      const state = useTryOnStore.getState();
      const tf = state.trackingFrame;
      if (!tf?.hasFace || !tf.landmarks || !tf.transformMatrix) return;
      if (tf.timestampMs == null || tf.timestampMs <= lastTs) return;
      lastTs = tf.timestampMs;
      if (!decomposeHeadMatrix(tf.transformMatrix, head)) return;
      const aspect = tf.videoWidth / tf.videoHeight;
      const tanHalf = Math.tan(((state.cameraCalib.fovDeg / 2) * Math.PI) / 180);
      for (const { idx, side } of SIDES) {
        const ray = earRay(tf.landmarks[idx], head, aspect, tanHalf);
        if (!ray || !sideVisible(ray, side)) continue;
        rays[idx].push(ray);
        if (rays[idx].length > WINDOW) rays[idx].shift();
      }

      const now = performance.now();
      if (now - lastSolve < SOLVE_EVERY_MS) return;
      lastSolve = now;
      // Live data (7 Oct) showed what is and isn't trustworthy here:
      //  - DEPTH: the triangulated junction ran ≥1.5 cm forward of canonical and
      //    sat on the clamp — 234/454 lie on the face contour, so they slide
      //    with the view instead of being a fixed point. Not used.
      //  - COMMON-MODE X: both sides moved ~+0.5 cm together (head-matrix
      //    offset, not anatomy), which made the temple folds lopsided.
      // What survives is the symmetric HALF-WIDTH (R.x − L.x)/2, so only
      // that is applied, equally to both sides.
      if (rays[234].length < MIN_RAYS || rays[454].length < MIN_RAYS) return;
      const anchors = state.headAnchors;
      const pL = new Vector3(...(CANONICAL_CM[234] as [number, number, number]));
      const pR = new Vector3(...(CANONICAL_CM[454] as [number, number, number]));
      const halfW = (triangulateWithPrior(rays[454], pR).x - triangulateWithPrior(rays[234], pL).x) / 2;
      const delta = Math.max(-MAX_WIDTH_DELTA_CM, Math.min(MAX_WIDTH_DELTA_CM, halfW - (pR.x - pL.x) / 2));
      const next = { ...anchors };
      let moved = false;
      for (const { key, tragion, side } of SIDES) {
        const base = canonicalTragion(tragion, state.tragionTune);
        // Keep calibrated y/z; set x from the canonical tragion + width delta.
        const target = anchors[key].clone().setX(base.x + side * delta);
        if (Math.abs(target.x - anchors[key].x) > UPDATE_THRESHOLD_CM) {
          next[key] = target;
          moved = true;
        }
      }
      if (moved) {
        state.setHeadAnchors(next);
        console.info(
          `[EyeNetra:ears] tragion L=(${next.tragionLHeadCm.toArray().map((v) => v.toFixed(2))}) R=(${next.tragionRHeadCm.toArray().map((v) => v.toFixed(2))}) rays L=${rays[234].length} R=${rays[454].length}`,
        );
      }
    }, SAMPLE_EVERY_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
