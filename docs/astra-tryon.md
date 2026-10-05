# Try-on fit — status and evidence (5 Oct 2026)

Branch: `codex/precise-tryon-fit`. All numbers below were measured live in
Chrome on one person (narrow face, iris-derived outer-canthal width 81 mm),
one webcam (1280×720), at 23–45 cm. They are not a multi-person study.

## How placement works now

1. **Head pose**: MediaPipe `facialTransformationMatrix` (column-major in
   this build). With the 63° solver FOV, the matrix-posed canonical face
   reprojects onto the observed landmarks at **6.9 px rms** (50° → 39 px,
   75° → 24 px), so 63° is kept as the render FOV; calibration logs a
   self-check (65.4° fit on this camera).
2. **Fit rule (optician's pupil height)**: GLB pivot = centre of the lens
   meshes (`scanGlassesGeom`); the frame is placed so that centre sits
   3 mm below the pupil line. This fixed the Sport/Studio frames hanging
   ~1.5 cm too high under the old "bridge-top minus 7 mm" pivot.
3. **X/Y**: ray through the observed iris midpoint cast at the **pupil
   depth**, then a head-local offset to the lens plane (1.2 cm vertex
   distance + pad standoff). Casting at the lens depth instead produced
   ~1.5 cm·sin(yaw) of parallax (frame slid forward on turns).
4. **Depth/scale**: matrix depth; width = frameWidthMm × iris scale
   correction (1.15 for this user — the matrix fits an 89 mm canonical
   face, the iris ruler says 81 mm).
5. **Occlusion**: face mask vertices take image x/y from the landmarks and
   depth from the matrix-posed canonical mesh (+0.3 cm clearance). The far
   lens is now hidden by the nose at 35–50° yaw; before, the landmark-z
   mask needed a 1.6 cm push-back and the far lens floated over the nose.
6. **Temples**: pantoscopic pitch solved from hinge → ear-rest (canonical
   cheek-ear junction, pushed back 1.2 cm, down 0.4 cm, +0.2 cm rest).
   Solve lands at −8…−12°. The ear position is an **estimate** — MediaPipe
   has no ear landmarks; calibration refines it from the measured 234/454
   junction only.

## Verified live

- Front, ¾ and ~50° yaw with the aviator, round, sport, studio frames and
  12 parametric rigs (`public/models/param`, exact known dimensions).
- Pupils at lens centre on every shape; widths 122–148 mm scale correctly.
- Roll and pitch follow the head (Sport at 13° pitch, head rolled).
- 25–31 detections/s, render 26–31 fps.

## Known gaps (honest)

- One user, one camera. Needs other faces, cameras, lighting.
- Ear position still estimated; temple may sit a little above/below the
  ear on other people. A real ear detector or user-adjustable trim is the fix.
- The four product GLBs are generic models; the voice catalogue maps SKUs
  onto them "by shape" and the UI says so ("Shown as …").
- Iris ruler (11.7 mm) is ±4 %; a card-based scale check would confirm
  absolute size.
- Jitter/lag numbers depend on the user holding still; see session notes.

## Tools

- `scripts/inspect-glb.mjs` — material/bbox audit of any GLB.
- `scripts/generate-param-frames.mjs` — regenerate the measurement rigs.
- Dev toggle on the page: landmarks, anchor axes, face occluder on/off,
  residual trims, calibration.
