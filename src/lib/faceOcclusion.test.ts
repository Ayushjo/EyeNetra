import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { writeFaceSurface, setPosteriorCap } from './faceOcclusion';

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
});
