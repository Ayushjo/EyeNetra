"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Quaternion, ShaderMaterial, Vector3, type Group, type Mesh } from "three";
import { perspectiveFaceDepth } from "@/lib/fitPose";
import { FACE_TRIANGLES } from "@/lib/faceMesh";
import { setEarProxy, setPosteriorCap, skullProxyMatrix, writeFaceSurface, writeFaceSurfaceMetric, writeFaceSurfaceRigid } from "@/lib/faceOcclusion";
import { POSE_LOCKED_PLACEMENT } from "@/lib/fitPose";
import { decomposeHeadMatrix, earInGlassesSpace } from "@/lib/headAnchors";
import { useTryOnStore } from "@/store/tryOnStore";

/**
 * Soft contact shadows (alpha-blended black decal — NOT multiply: the canvas
 * alpha-composites over the video). Drawn on the face mask AND the skull
 * proxy, in anchor-local space (uToAnchor maps the mesh's object space there:
 * identity for the face, the skull's placement matrix for the skull):
 *  - nose pads: soft spots on the nose at ±half the bridge width (distance in
 *    the frame's x/y; only surfaces near the frame front, so cheeks behind
 *    are not darkened);
 *  - temples: a narrow strip along each hinge→ear segment.
 * Everything is offset slightly downward (light from above).
 */
const SHADOW_VERT = /* glsl */ `
  uniform mat4 uToAnchor;
  varying vec3 vPos;
  void main() {
    vPos = (uToAnchor * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SHADOW_FRAG = /* glsl */ `
  varying vec3 vPos;
  uniform vec3 uPads[2];
  uniform vec3 uTempleA[2];
  uniform vec3 uTempleB[2];
  uniform float uPadRadius;
  uniform float uTempleRadius;
  uniform float uPadIntensity;
  uniform float uTempleIntensity;
  uniform float uPadMinZ;
  float segDist(vec3 p, vec3 a, vec3 b) {
    vec3 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return distance(p, a + ab * t);
  }
  void main() {
    float f = 0.0;
    if (vPos.z > uPadMinZ) {
      for (int i = 0; i < 2; i++) {
        float d = distance(vPos.xy, uPads[i].xy);
        f += uPadIntensity * exp(-(d * d) / (uPadRadius * uPadRadius));
      }
    }
    for (int i = 0; i < 2; i++) {
      float d = segDist(vPos, uTempleA[i], uTempleB[i]);
      f += uTempleIntensity * exp(-(d * d) / (uTempleRadius * uTempleRadius));
    }
    float a = clamp(f, 0.0, 0.45);
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;
/** Contact-shadow sizes (cm, converted to anchor units per frame). */
export const CONTACT_SHADOW = {
  padRadiusCm: 0.45,
  templeRadiusCm: 0.35,
  padIntensity: 0.3,
  templeIntensity: 0.22,
  dropCm: 0.25,
  /** Pads darken only surfaces within this depth behind the frame front. */
  padDepthCm: 2.5,
} as const;

/** Face vertices are measured in the raw detection's anchor space, then inherit
 * the filtered glasses anchor. Ear/cap geometry remains an approximation.
 */
export function FaceMeshOccluder({ anchorRef }: { anchorRef: React.RefObject<Group | null> }) {
  const meshRef = useRef<Mesh>(null);
  const capRef = useRef<Mesh>(null);
  const earLRef = useRef<Mesh>(null);
  const earRRef = useRef<Mesh>(null);
  const shadowRef = useRef<Mesh>(null);
  const inverse = useRef(new Matrix4());
  const headMatrix = useRef(new Matrix4());
  const vertex = useRef(new Vector3());
  const rawPosition = useRef(new Vector3());
  const rawRotation = useRef(new Quaternion());
  const rawScale = useRef(new Vector3());
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(468 * 3), 3));
    g.setIndex(FACE_TRIANGLES);
    return g;
  }, []);
  const skullShadowRef = useRef<Mesh>(null);
  // Shared contact-point uniforms; each material has its own uToAnchor.
  const shadowUniforms = useMemo(
    () => ({
      uPads: { value: [new Vector3(), new Vector3()] },
      uTempleA: { value: [new Vector3(), new Vector3()] },
      uTempleB: { value: [new Vector3(), new Vector3()] },
      uPadRadius: { value: 0.03 },
      uTempleRadius: { value: 0.025 },
      uPadIntensity: { value: CONTACT_SHADOW.padIntensity },
      uTempleIntensity: { value: CONTACT_SHADOW.templeIntensity },
      uPadMinZ: { value: -0.2 },
    }),
    [],
  );
  const [shadowMaterial, skullShadowMaterial] = useMemo(() => {
    const make = () =>
      new ShaderMaterial({
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        uniforms: { ...shadowUniforms, uToAnchor: { value: new Matrix4() } },
      });
    return [make(), make()];
  }, [shadowUniforms]);

  // Per-frame hot path: 468 vertex updates; geometry/index buffers are reused.
  // Runs after useFitEngine: same default priority, but the parent
  // (GlassesAnchor) registers its useFrame before this child's, so the mask
  // inherits the SAME filtered anchor transform as the glasses each frame.
  // (A positive r3f priority would take over rendering — don't.)
  useFrame(() => {
    const mesh = meshRef.current;
    const cap = capRef.current;
    const earL = earLRef.current;
    const earR = earRRef.current;
    const shadow = shadowRef.current;
    const skullShadow = skullShadowRef.current;
    if (!mesh || !cap || !earL || !earR || !shadow || !skullShadow) return;
    mesh.visible = cap.visible = earL.visible = earR.visible = shadow.visible = skullShadow.visible = false;
    const anchor = anchorRef.current;
    const state = useTryOnStore.getState();
    const { trackingFrame, hasFace, videoWidth, videoHeight, transformMatrix, renderMode, showOccluder } = state;
    if (!showOccluder) return;
    const landmarks = trackingFrame?.landmarks ?? state.landmarks;
    const rawPose = trackingFrame?.anchorPose;
    if (renderMode !== "perspective" || !hasFace || !landmarks || !anchor || !anchor.visible || !rawPose) return;
    const depth = trackingFrame?.depthCm ?? perspectiveFaceDepth(transformMatrix);
    if (depth == null) return;
    const aspect = videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    // Using the filtered anchor inverse here would cancel its smoothing in
    // world space: the mask would remain raw while the glasses move smoothly.
    // The raw anchor inverse keeps the face rigidly attached to the same
    // smoothed/predicted pose as the glasses.
    rawPosition.current.set(rawPose.position.x, rawPose.position.y, rawPose.position.z);
    rawRotation.current.set(rawPose.rotation.x, rawPose.rotation.y, rawPose.rotation.z, rawPose.rotation.w);
    rawScale.current.setScalar(rawPose.scale);
    inverse.current.compose(rawPosition.current, rawRotation.current, rawScale.current).invert();
    const attribute = geometry.getAttribute("position") as BufferAttribute;
    const positions = attribute.array as Float32Array;
    const tanHalf = Math.tan(((state.cameraCalib.fovDeg / 2) * Math.PI) / 180);
    // Metric surface (canonical depth through the head matrix) when the
    // matrix is usable; landmark-z surface as the fallback.
    const metric = decomposeHeadMatrix(transformMatrix, headMatrix.current);
    const ok = metric && POSE_LOCKED_PLACEMENT
      ? writeFaceSurfaceRigid(headMatrix.current, inverse.current, positions, vertex.current)
      : metric
      ? writeFaceSurfaceMetric(landmarks, headMatrix.current, aspect, tanHalf, inverse.current, positions, vertex.current)
      : writeFaceSurface(landmarks, depth, aspect, inverse.current, positions, vertex.current, tanHalf);
    if (!ok) return;
    attribute.needsUpdate = true;
    if (metric) {
      // Head-shaped skull proxy fitted to the (tracked) ear anchors.
      cap.matrixAutoUpdate = false;
      skullProxyMatrix(
        state.headAnchors.tragionLHeadCm,
        state.headAnchors.tragionRHeadCm,
        headMatrix.current,
        inverse.current,
        cap.matrix,
      );
      cap.matrixWorldNeedsUpdate = true;
    } else {
      cap.matrixAutoUpdate = true;
      setPosteriorCap(positions, cap.position, cap.scale);
    }
    setEarProxy(positions, "L", earL.position, earL.scale);
    setEarProxy(positions, "R", earR.position, earR.scale);

    // Contact shadows, in anchor units (cm / rendered scale).
    const sku = state.selectedFrame();
    const geom = state.glassesGeom[sku.id];
    const unit = rawPose.scale > 0 ? rawPose.scale : sku.fit.frameWidthMm / 10;
    const drop = CONTACT_SHADOW.dropCm / unit;
    const u = shadowUniforms;
    u.uPadRadius.value = CONTACT_SHADOW.padRadiusCm / unit;
    u.uTempleRadius.value = CONTACT_SHADOW.templeRadiusCm / unit;
    u.uPadMinZ.value = -CONTACT_SHADOW.padDepthCm / unit;
    const padX = sku.fit.bridgeWidthMm / 20 / unit;
    u.uPads.value[0].set(padX, -drop, 0);
    u.uPads.value[1].set(-padX, -drop, 0);
    const pantoRad = trackingFrame?.pantoRad ?? 0;
    for (const [i, sgn] of [[0, 1], [1, -1]] as const) {
      const hinge = geom?.hingeLocal ?? { x: 0.5, y: 0, z: -0.05 };
      u.uTempleA.value[i].set(sgn * Math.abs(hinge.x), hinge.y - drop, hinge.z);
      const ear = earInGlassesSpace(state.headAnchors, sgn, unit, pantoRad, sku.fit.nosePadOffsetMm);
      u.uTempleB.value[i].set(ear.x, ear.y - drop, ear.z);
    }
    (skullShadowMaterial.uniforms.uToAnchor.value as Matrix4).copy(cap.matrix);
    skullShadow.matrixAutoUpdate = false;
    skullShadow.matrix.copy(cap.matrix);
    skullShadow.matrixWorldNeedsUpdate = true;
    skullShadow.visible = metric;

    mesh.visible = cap.visible = earL.visible = earR.visible = shadow.visible = true;
  });

  return (
    <>
      <mesh ref={meshRef} geometry={geometry} visible={false} renderOrder={0} frustumCulled={false}>
        <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
      </mesh>
      <mesh ref={capRef} visible={false} renderOrder={0} frustumCulled={false}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
      </mesh>
      <mesh ref={earLRef} visible={false} renderOrder={0} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
      </mesh>
      <mesh ref={earRRef} visible={false} renderOrder={0} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
      </mesh>
      {/* Contact shadow: same face geometry, drawn after the depth mask (5)
          and before the glasses (10). */}
      <mesh ref={shadowRef} geometry={geometry} material={shadowMaterial} visible={false} renderOrder={5} frustumCulled={false} />
      <mesh ref={skullShadowRef} material={skullShadowMaterial} visible={false} renderOrder={5} frustumCulled={false}>
        <sphereGeometry args={[1, 32, 24]} />
      </mesh>
    </>
  );
}
