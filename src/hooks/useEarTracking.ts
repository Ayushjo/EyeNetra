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
/** The junction cannot be further than this from the canonical vertex (cm). */
const MAX_DELTA_CM = 1.5;

const SIDES = [
  { idx: 234, side: -1 as const, key: "tragionLHeadCm" as const, tragion: "L" as const },
  { idx: 454, side: 1 as const, key: "tragionRHeadCm" as const, tragion: "R" as const },
];

/**
 * Track the user's ear junctions (234/454) by multi-view triangulation over
 * the live stream (see lib/earTracking) and move the tragion anchors with
 * them, so temple fold / tilt / fade aim at THIS user's ears rather than a
 * one-off estimate. Head turns are what make the ear's depth observable.
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
      const anchors = state.headAnchors;
      const next = { ...anchors };
      let moved = false;
      for (const { idx, key, tragion } of SIDES) {
        if (rays[idx].length < MIN_RAYS) continue;
        const prior = new Vector3(...(CANONICAL_CM[idx] as [number, number, number]));
        const delta = triangulateWithPrior(rays[idx], prior).sub(prior);
        delta.clampScalar(-MAX_DELTA_CM, MAX_DELTA_CM);
        const target = canonicalTragion(tragion, state.tragionTune).add(delta);
        if (target.distanceTo(anchors[key]) > UPDATE_THRESHOLD_CM) {
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
