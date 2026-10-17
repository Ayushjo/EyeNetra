import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { CANONICAL_MESH_CM } from "@/lib/canonicalFaceMesh";

/**
 * Head pose by Perspective-n-Point on rigid face landmarks.
 *
 * Technique observed in Meta's web try-on (docs/meta-vto-analysis.md): pose
 * is solved by minimising pixel reprojection error of 33 rigid MediaPipe
 * landmarks against the canonical face model, under the SAME pinhole camera
 * (vertical FOV, centred principal point, no distortion) used to render. The
 * MediaPipe matrix is only the initial guess. Rigid points (nose bridge, eye
 * corners, cheekbones, temples, ear junctions) exclude the mouth/jaw, so
 * expressions do not tilt the glasses.
 *
 * Our own implementation: Levenberg–Marquardt on (rotation increment ω,
 * translation t) in MediaPipe's camera convention (x right, y up, camera
 * looking down −z), so the result drops in wherever transformMatrix is used.
 */
export const PNP_LANDMARKS = [
  2, 6, 20, 31, 33, 34, 47, 54, 64, 99, 133, 162, 164, 167, 188, 207, 230, 234,
  250, 261, 263, 264, 277, 284, 294, 328, 362, 389, 393, 412, 427, 450, 454,
] as const;

const MODEL = PNP_LANDMARKS.map(
  (i) => new Vector3(CANONICAL_MESH_CM[i * 3], CANONICAL_MESH_CM[i * 3 + 1], CANONICAL_MESH_CM[i * 3 + 2]),
);

export type PnPResult = {
  /** Column-major 4×4 (MediaPipe facialTransformationMatrix layout). */
  matrix: number[];
  /** RMS reprojection error in pixels. */
  rmsPx: number;
  iterations: number;
};

const _r = new Matrix3();
const _pc = new Vector3();
const _tmp = new Vector3();
const _q = new Quaternion();
const _m4 = new Matrix4();

/** Rotation matrix for the rotation vector w (Rodrigues). */
function expSO3(w: [number, number, number], out: Matrix3): Matrix3 {
  const th = Math.hypot(w[0], w[1], w[2]);
  if (th < 1e-12) return out.identity();
  _tmp.set(w[0] / th, w[1] / th, w[2] / th);
  _q.setFromAxisAngle(_tmp, th);
  _m4.makeRotationFromQuaternion(_q);
  return out.setFromMatrix4(_m4);
}

/** Solve the 6×6 system A x = b in place (Gaussian elimination, partial pivoting). */
function solve6(A: number[][], b: number[]): number[] | null {
  const n = 6;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

function residuals(
  R: Matrix3, t: Vector3, obs: { u: number; v: number }[], f: number, cx: number, cy: number,
): number {
  let ss = 0;
  for (let i = 0; i < MODEL.length; i++) {
    _pc.copy(MODEL[i]).applyMatrix3(R).add(t);
    const z = -_pc.z;
    if (!(z > 1e-3)) return Infinity;
    const du = cx + (f * _pc.x) / z - obs[i].u;
    const dv = cy - (f * _pc.y) / z - obs[i].v;
    ss += du * du + dv * dv;
  }
  return ss;
}

/**
 * Refine the head pose. `init` is MediaPipe's column-major matrix (rotation +
 * translation in cm, possibly with a uniform scale that is dropped).
 * Landmarks are normalised image coordinates (unmirrored). Returns null when
 * the inputs are unusable or the solve diverges.
 */
export function solveHeadPosePnP(
  landmarks: { x: number; y: number }[],
  init: number[] | null | undefined,
  videoWidth: number,
  videoHeight: number,
  fovDeg: number,
  maxIterations = 12,
): PnPResult | null {
  if (!init || init.length < 16 || !(videoWidth > 0) || !(videoHeight > 0)) return null;
  const obs: { u: number; v: number }[] = [];
  for (const i of PNP_LANDMARKS) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x + lm.y)) return null;
    obs.push({ u: lm.x * videoWidth, v: lm.y * videoHeight });
  }
  const f = videoHeight / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180);
  const cx = videoWidth / 2, cy = videoHeight / 2;

  // Initial pose from the MediaPipe matrix (column-major), scale removed.
  const m = new Matrix4().fromArray(init);
  const pos = new Vector3(), quat = new Quaternion(), scl = new Vector3();
  m.decompose(pos, quat, scl);
  if (!(pos.z < -1)) return null;
  const R = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quat));
  const t = pos.clone();

  let cost = residuals(R, t, obs, f, cx, cy);
  if (!Number.isFinite(cost)) return null;
  let lambda = 1e-3;
  let it = 0;
  const dR = new Matrix3();
  for (; it < maxIterations; it++) {
    // Normal equations JᵀJ δ = −Jᵀr over 2N residuals, 6 unknowns (ω, t).
    const JtJ = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const Jtr = new Array(6).fill(0);
    for (let i = 0; i < MODEL.length; i++) {
      _pc.copy(MODEL[i]).applyMatrix3(R); // rotated model point (before +t)
      const rx = _pc.x, ry = _pc.y, rz = _pc.z;
      const X = rx + t.x, Y = ry + t.y, Z = rz + t.z;
      const z = -Z;
      if (!(z > 1e-3)) return null;
      const ru = cx + (f * X) / z - obs[i].u;
      const rv = cy - (f * Y) / z - obs[i].v;
      // d(u,v)/d(X,Y,Z)
      const duX = f / z, duZ = (f * X) / (z * z);
      const dvY = -f / z, dvZ = (-f * Y) / (z * z);
      // dP/dω = −[Rp]× : columns for ωx, ωy, ωz
      // [Rp]× = [[0,−rz,ry],[rz,0,−rx],[−ry,rx,0]]; −[Rp]× ⇒
      const dPdw = [
        [0, rz, -ry], // dX/dω
        [-rz, 0, rx], // dY/dω
        [ry, -rx, 0], // dZ/dω
      ];
      const Ju = [
        duX * dPdw[0][0] + duZ * dPdw[2][0],
        duX * dPdw[0][1] + duZ * dPdw[2][1],
        duX * dPdw[0][2] + duZ * dPdw[2][2],
        duX, 0, duZ,
      ];
      const Jv = [
        dvY * dPdw[1][0] + dvZ * dPdw[2][0],
        dvY * dPdw[1][1] + dvZ * dPdw[2][1],
        dvY * dPdw[1][2] + dvZ * dPdw[2][2],
        0, dvY, dvZ,
      ];
      for (let a = 0; a < 6; a++) {
        Jtr[a] += Ju[a] * ru + Jv[a] * rv;
        for (let b = 0; b < 6; b++) JtJ[a][b] += Ju[a] * Ju[b] + Jv[a] * Jv[b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-9 : v)));
      const step = solve6(A, Jtr.map((v) => -v));
      if (!step) return null;
      expSO3([step[0], step[1], step[2]], dR);
      const Rn = dR.clone().multiply(R);
      const tn = t.clone().add(_tmp.set(step[3], step[4], step[5]));
      const c = residuals(Rn, tn, obs, f, cx, cy);
      if (c < cost) {
        R.copy(Rn);
        t.copy(tn);
        const gain = cost - c;
        cost = c;
        lambda = Math.max(1e-7, lambda / 3);
        improved = true;
        if (gain < 1e-6 * cost) it = maxIterations; // converged
      } else {
        lambda *= 8;
      }
    }
    if (!improved) break;
  }
  _r.copy(R);
  const out = new Matrix4().setFromMatrix3(_r).setPosition(t);
  return { matrix: out.toArray() as number[], rmsPx: Math.sqrt(cost / MODEL.length), iterations: it };
}
