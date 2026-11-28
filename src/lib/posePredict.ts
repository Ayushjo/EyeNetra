import { Quaternion, Vector3 } from "three";

/** Max rotation applied by prediction per render frame (rad ≈ 4°). */
export const PREDICT_MAX_STEP_RAD = (4 * Math.PI) / 180;
/** Max extrapolation horizon (ms) — about one 30 fps detection interval. */
export const PREDICT_MAX_MS = 34;
/**
 * Cap for "predict from capture time": the analysed frame's real age vs the
 * frame on screen (detection + hand-off + up to a frame of waiting), ~2–3
 * camera frames. Past this, extrapolation does more harm than lag.
 */
export const PREDICT_CAPTURE_MAX_MS = 100;

const _dq = new Quaternion();
const _axis = new Vector3();

/**
 * Constant-velocity pose extrapolation from the last two raw samples.
 * Applied POST-filter: advances `outPos`/`outQuat` (the filtered pose) by the
 * raw velocity over `predictMs`, with the rotation step clamped so overshoot
 * never pops. Pure and allocation-free (module scratch).
 */
export function predictPose(
  p0: Vector3,
  q0: Quaternion,
  t0Ms: number,
  p1: Vector3,
  q1: Quaternion,
  t1Ms: number,
  predictMs: number,
  outPos: Vector3,
  outQuat: Quaternion,
  maxMs: number = PREDICT_MAX_MS,
): void {
  const dtMs = t1Ms - t0Ms;
  if (!(dtMs > 1) || !(predictMs > 0)) return;
  const s = Math.min(predictMs, maxMs) / dtMs;

  // Linear velocity.
  outPos.x += (p1.x - p0.x) * s;
  outPos.y += (p1.y - p0.y) * s;
  outPos.z += (p1.z - p0.z) * s;

  // Angular velocity: delta = q0⁻¹·q1, scaled by s, clamped.
  _dq.copy(q0).invert().multiply(q1);
  if (_dq.w < 0) _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
  const halfAngle = Math.acos(Math.min(1, _dq.w));
  if (halfAngle < 1e-6) return;
  const sinHalf = Math.sin(halfAngle);
  _axis.set(_dq.x / sinHalf, _dq.y / sinHalf, _dq.z / sinHalf);
  const stepAngle = Math.min(2 * halfAngle * s, PREDICT_MAX_STEP_RAD);
  _dq.setFromAxisAngle(_axis, stepAngle);
  outQuat.multiply(_dq).normalize();
}
