import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { writeFaceSurface, writeFaceSurfaceMetric, setPosteriorCap } from './faceOcclusion';

function face() {
  const lm = Array.from({ length: 468 }, () => ({x:0.5,y:0.5,z:0}));
  lm[234] = {x:0.3,y:0.5,z:0.04};
  lm[454] = {x:0.7,y:0.5,z:0.04};
  return lm;
}
function surface(width: number) {
  const anchor = new Matrix4().compose(new Vector3(0,-0.8,-39.4),new Quaternion(),new Vector3(width,width,width));
  const arr = new Float32Array(468*3);
  expect(writeFaceSurface(face(),40,16/9,anchor.clone().invert(),arr,new Vector3())).toBe(true);
  return {arr,anchor};
}
describe('face-space occlusion', () => {
  it('keeps mask world geometry identical across product widths', () => {
    const a = surface(12), b = surface(16);
    for (const i of [168,234,454]) {
      const va = new Vector3().fromArray(a.arr,i*3).applyMatrix4(a.anchor);
      const vb = new Vector3().fromArray(b.arr,i*3).applyMatrix4(b.anchor);
      expect(va.distanceTo(vb)).toBeLessThan(0.00001);
    }
    const pa=new Vector3(),pb=new Vector3(),sa=new Vector3(),sb=new Vector3();
    setPosteriorCap(a.arr,pa,sa); setPosteriorCap(b.arr,pb,sb);
    expect(pa.applyMatrix4(a.anchor).distanceTo(pb.applyMatrix4(b.anchor))).toBeLessThan(0.00001);
    expect(sa.multiplyScalar(12).distanceTo(sb.multiplyScalar(16))).toBeLessThan(0.00001);
  });
  it('rejects incomplete and non-finite input rather than rendering spikes', () => {
    const arr=new Float32Array(468*3), v=new Vector3(), m=new Matrix4();
    expect(writeFaceSurface([],40,1,m,arr,v)).toBe(false);
    const bad=face();bad[100].z=NaN;
    expect(writeFaceSurface(bad,40,1,m,arr,v)).toBe(false);
    expect(writeFaceSurface(face(),NaN,1,m,arr,v)).toBe(false);
  });
  it('metric surface: landmark x/y, canonical depth through the head matrix', () => {
    const fov = 63, tanHalf = Math.tan(fov / 2 * Math.PI / 180), aspect = 16 / 9;
    // Head 45 cm away, identity rotation (column-major translation).
    const head = new Matrix4().makeTranslation(0, 0, -45);
    const lm = face();
    lm[1] = { x: 0.52, y: 0.55, z: 0 }; // nose tip
    const positions = new Float32Array(468 * 3);
    const anchor = new Matrix4(); // identity → positions are camera space
    expect(writeFaceSurfaceMetric(lm, head, aspect, tanHalf, anchor, positions, new Vector3())).toBe(true);
    // Nose tip depth = 45 - canonical z (7.475604) + clearance 0.3.
    const tip = new Vector3().fromArray(positions, 1 * 3);
    expect(-tip.z).toBeCloseTo(45 - 7.475604 + 0.3, 5);
    // Its x/y re-project onto the observed (mirrored) landmark.
    expect(tip.x).toBeCloseTo((0.5 - 0.52) * 2 * -tip.z * tanHalf * aspect, 5);
    expect(tip.y).toBeCloseTo((0.5 - 0.55) * 2 * -tip.z * tanHalf, 5);
    // The nose tip sits in front of the sellion region (z of 168 = 5.236).
    const mid = new Vector3().fromArray(positions, 168 * 3);
    expect(-tip.z).toBeLessThan(-mid.z);
    // Rejects a head behind the camera.
    expect(writeFaceSurfaceMetric(lm, new Matrix4().makeTranslation(0, 0, 5), aspect, tanHalf, anchor, positions, new Vector3())).toBe(false);
  });
  it('moves the face with the filtered anchor, not the raw landmark frame', () => {
    const raw = new Matrix4().compose(new Vector3(0, 0, -40), new Quaternion(), new Vector3(14, 14, 14));
    const filtered = new Matrix4().compose(new Vector3(2, 0, -40), new Quaternion(), new Vector3(14, 14, 14));
    const positions = new Float32Array(468 * 3);
    expect(writeFaceSurface(face(), 40, 16 / 9, raw.clone().invert(), positions, new Vector3())).toBe(true);
    const world = new Vector3().fromArray(positions, 168 * 3).applyMatrix4(filtered);
    expect(world.x).toBeCloseTo(2, 5);
    // Inverting the filtered pose instead would cancel its 2 cm motion.
    const wrong = new Float32Array(468 * 3);
    expect(writeFaceSurface(face(), 40, 16 / 9, filtered.clone().invert(), wrong, new Vector3())).toBe(true);
    expect(new Vector3().fromArray(wrong, 168 * 3).applyMatrix4(filtered).x).toBeCloseTo(0, 5);
  });
});
