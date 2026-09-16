# Astra try-on corrections

Branch: `codex/astra`, based on `meta-level-tryon`.

## What changed

- The installed MediaPipe tessellation provides 852 triangles as consecutive
  directed edge triplets. Use those fixed triangles, excluding iris vertices,
  instead of first-frame Delaunay triangulation.
- Reconstruct relative landmark depth using image-width camera units; invalid
  samples hide the mask instead of generating spikes.
- Express the surface in the raw glasses anchor space, then inherit the same
  filtered anchor as the glasses. This removes rigid-pose timing disagreement.
- Conservatively inset lateral mask vertices to prevent an uncertain estimated
  cheek from bisecting the visible temple. Posterior cap size follows cheek
  measurements instead of the selected product's nominal width.
- Map lenses by explicit authored material names. Preserve transparent nose
  pads, respect requested lens opacity, reduce reflection intensity, and dispose
  replaced material instances. The old mesh-name heuristic painted several lenses opaque.
- Remove Sport's extra 180-degree rotation: its GLB already contains the axis
  conversion. Restore a normal vertical offset rather than compensating for inversion.
- Reset smoothing on render-mode switches and reject corrupt legacy calibration.
- Enable WebGL antialiasing for thin rims/arms.

## Adding frames

Each `FrameSku.fit.lensMaterialNames` lists the lens material names actually in
its GLB. Do not name every transparent material a lens (nose pads and decals can
also be transparent). Validate authored orientation, width, bridge/pivot and
open-temple geometry. The occluder is shared; product fit metadata still needs
validation. Bounding-box normalization does not establish the true nose bridge.

## Validation and limits

27 unit tests pass; TypeScript and changed-file ESLint pass. Live Chrome checks
showed roughly 27–31 fps. A held Aviator side view showed a continuous temple
where a gap was previously visible. Round and Studio lens transparency and
Sport's corrected orientation were visually inspected.

Ear-tip coverage still needs bilateral tests after the final posterior-cap
adjustment. Do not interpret one user's front/side view as validation across
all people, models, cameras, or distances. The fixed virtual FOV and canonical
face-derived depth are estimates, not independently measured user dimensions.
The perspective path still does not use the saved iris calibration for size.

MediaPipe does not supply ear/hair geometry, and full profile can lose tracking.
The posterior mask is an approximation, not an ear scan. No Ray-Ban parity claim
has been established. Next validation: both yaw directions, pitch, near/far,
all SKUs and variants; then different people and camera aspect ratios. A proper
camera/scale calibration and validated product bridge/hinge anchors remain needed
for purchase-grade physical-fit accuracy.

Reference: https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md
