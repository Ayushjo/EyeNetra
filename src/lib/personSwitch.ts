/**
 * Detects that the tracker switched to a DIFFERENT face (another person in
 * frame — common in a shop). MediaPipe tracks one face and can hop between
 * people; a real head cannot move > 6 cm between samples ~100 ms apart, so a
 * translation jump that large means accumulated per-user measurements
 * (fit size, ear width) must restart. Live 7 Oct: two people in view mixed
 * their ear/calibration data.
 */
export const PERSON_SWITCH_CM = 6;

export function headTranslation(m: number[] | null | undefined): [number, number, number] | null {
  if (!m || m.length < 16) return null;
  // Column-major facialTransformationMatrix: translation in m[12..14].
  const t: [number, number, number] = [m[12], m[13], m[14]];
  return t.every(Number.isFinite) ? t : null;
}

export class PersonSwitchDetector {
  private last: [number, number, number] | null = null;
  /** Feed one sample; true when it looks like a different person than the last. */
  update(m: number[] | null | undefined): boolean {
    const t = headTranslation(m);
    if (!t) return false;
    const prev = this.last;
    this.last = t;
    if (!prev) return false;
    return Math.hypot(t[0] - prev[0], t[1] - prev[1], t[2] - prev[2]) > PERSON_SWITCH_CM;
  }
}
