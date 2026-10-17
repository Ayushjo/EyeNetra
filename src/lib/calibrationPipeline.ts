import {
  computeScaleCorrection,
  estimateFocalFit,
  saveCameraCalib,
} from "@/lib/cameraCalib";
import { saveFaceProfile, type FaceProfile } from "@/lib/faceProfile";
import { CANONICAL_PD_MM } from "@/lib/canonicalFace";
import {
  canonicalHeadAnchors,
  clearHeadAnchors,
  refineHeadAnchors,
  saveHeadAnchors,
  type AnchorSample,
} from "@/lib/headAnchors";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Apply a measured face profile to the running session: persist it, derive
 * the iris scale correction and the per-user head anchors from the same
 * frames, and log the solver-FOV self-check. Shared by the manual
 * "Recalibrate" button and the background auto-calibrator so both paths
 * produce identical state.
 */
/** Canonical PD / user PD, clamped; null if the PD is implausible. */
export function pdScaleCorrection(ipdMm: number | undefined): number | null {
  if (!(typeof ipdMm === "number") || !(ipdMm > 45) || !(ipdMm < 80)) return null;
  return Math.min(1.4, Math.max(0.7, CANONICAL_PD_MM / ipdMm));
}

export function applyCalibration(
  profile: FaceProfile,
  samples: AnchorSample[],
  aspect: number,
): { scaleCorrection: number; anchorsRefined: boolean } {
  const store = useTryOnStore.getState();
  saveFaceProfile(profile);
  store.setFaceProfile(profile);

  const fovDeg = store.cameraCalib.fovDeg;
  let rms: number | null = null;
  let scaleCorrection = 1;
  let anchorsRefined = false;
  if (samples.length) {
    const last = samples[samples.length - 1];
    const focal = estimateFocalFit(last.landmarks, last.transformMatrix, aspect);
    if (focal) {
      rms = focal.rms;
      console.info(
        `[EyeNetra:calib] solver-FOV self-check: fit=${focal.fovDeg.toFixed(1)}° (render=${fovDeg}°) rms=${focal.rms.toFixed(4)}`,
      );
    }
    let corrSum = 0;
    let corrN = 0;
    for (const s of samples) {
      const c = computeScaleCorrection(s.landmarks, s.transformMatrix, aspect, fovDeg, profile);
      if (c !== 1) {
        corrSum += c;
        corrN++;
      }
    }
    scaleCorrection = corrN ? Math.min(1.4, Math.max(0.7, corrSum / corrN)) : 1;
    // Primary: canonical-face PD ÷ user's PD (Meta's scale rule). The PnP
    // pose fits a canonical-size face, so this ratio is exactly how much a
    // real frame must grow in that space — no depth or FOV involved.
    const pdScale = pdScaleCorrection(profile.ipdMm);
    if (pdScale != null) scaleCorrection = pdScale;
    store.setCameraCalib({ scaleCorrection, rms });
    saveCameraCalib({ fovDeg, scaleCorrection, rms });
    console.info(`[EyeNetra:calib] scaleCorrection=${scaleCorrection.toFixed(3)} (n=${corrN})`);

    const refined = refineHeadAnchors(samples, aspect, fovDeg, canonicalHeadAnchors(store.tragionTune));
    if (refined) {
      store.setHeadAnchors(refined);
      saveHeadAnchors(refined);
      anchorsRefined = true;
      console.info(
        `[EyeNetra:calib] headAnchors calibrated: seat=(${refined.seatHeadCm.x.toFixed(2)}, ${refined.seatHeadCm.y.toFixed(2)}, ${refined.seatHeadCm.z.toFixed(2)})cm`,
      );
    } else {
      store.setHeadAnchors(canonicalHeadAnchors(store.tragionTune));
      clearHeadAnchors();
    }
  }
  return { scaleCorrection, anchorsRefined };
}
