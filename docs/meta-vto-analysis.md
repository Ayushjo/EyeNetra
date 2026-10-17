# Meta / Ray-Ban Meta web virtual try-on — technique analysis

Studied 2026-10-17 with REA (passive CDP capture of the user's own Brave
session on `https://www.meta.com/in/virtual-try-on/`, Wayfarer Gen 1).
Purpose: learn the *techniques* and reimplement them in our own code. No
Meta code, models, GLBs or the head-occluder asset are copied into this repo.

Evidence: REA capture `ev_030096f9…b16c8b07` (24 scripts from
`static.xx.fbcdn.net`, exported to the session scratchpad, not committed).
Labels: **[O]** observed in shipped code/config · **[I]** inference.

## Pipeline

| Stage | Meta | Ours (codex/temple-realism) |
|---|---|---|
| Landmarks | [O] MediaPipe Tasks Vision `FaceLandmarker`, VIDEO, 1 face, blendshapes off, transformation matrix on, GPU→CPU fallback, all confidences 0.9 (`FaceLandmarksProvider`, `ShopVirtualTryOnConfig`) | same library; confidences 0.5 |
| Head pose | [O] **OpenCV.js `solvePnP` (ITERATIVE)** on **33 rigid landmarks** → canonical-face vertices; pinhole K with f = (H/2)/tan(63°/2), centre principal point, zero distortion; Rodrigues → 4×4, flipped diag(1,−1,−1). MediaPipe's matrix only as fallback (`ShopVirtualTryOnFacePosePnPSolver`) | MediaPipe matrix + iris-midpoint ray + near-eye blend |
| PnP landmarks | [O] 2,6,20,31,33,34,47,54,64,99,133,162,164,167,188,207,230,234,250,261,263,264,277,284,294,328,362,389,393,412,427,450,454 | — |
| Video / glasses sync | [O] per `requestVideoFrameCallback`: draw video frame to a canvas, detect on it, render that canvas as the background plane (z = −500) with the glasses → **zero lag between face and glasses** (`ShopVirtualTryOnVideoCanvas`) | live `<video>` + overlay from an older detection + constant-velocity prediction |
| Smoothing | [O] none on the pose in this path (`SMOOTHING_ALPHA 0.9` defined; bending angle smoothed α 0.5) | one-euro + prediction |
| Camera | [O] Perspective 63° vertical FOV, near 1 / far 1e4; wide containers recompute FOV so the video plane covers width | 63° |
| Scale | [O] glasses scale = `CANONICAL_FACE_PD 63.2 / userPD`; default PD 63 mm | `scaleCorrection` from iris-calibrated canthal width vs matrix width |
| PD estimate | [O] Kasa circle fit to iris contour 4 pts per eye (474–477, 469–472) in pixels; PD = 1.02625 × (centre distance / (rL + rR)) × 11.77 mm; coarse: median of 30 → refit prompt if \|PD−63\| > 5 mm; calibration: median of 60 while centred, 60–100 % size, \|yaw\|≤6°, \|pitch\|≤8°, \|roll\|≤6°, eye aspect ratio > 0.175 | median of 40, iris 11.7 mm, frontal ≤12° |
| Glasses placement | [O] glasses authored in canonical-face space; group matrix = pose; offset (0, 2.33, 6) cm, rotationX −3.5°, scale 100 × PD scale; **per-product offsets** (translation/rotation) from server GraphQL override (`ShopVirtualTryOnOffsetsUtils`) | lens-centre pivot at pupil-line − 0.3 cm, z sellion; pantoscopic solved per user (~−9°) |
| Temple bending | [O] rigged GLB joints `bridge_L/R`, `arm_L/R`; α = asin(((templeW − hingeW)/2)/meanTempleLen) × 0.75; only when head wider (α>0): bridge = min(4°, 0.5α), arm = min(10°, 0.5α); exp-smoothed α 0.5. Temple targets: (2·389 + 356)/3 and (2·162 + 127)/3 from the metric face mesh, transformed by the pose | CPU yaw fold ±20° to tragion estimate |
| Temple fade | [O] TSL smoothstep on temple meshes over model z −0.10 → −0.11 | fade around solved ear depth |
| Occlusion | [O] full **head occluder GLB** (colorWrite off, offset (0, 2.49, 7.18)) + static canonical face mesh moved by the pose (colorWrite off) | per-frame metric face mesh + skull ellipsoid + temple walls + ear proxies |
| Lenses | [O] glTF `KHR_materials_variants` per frame/lens colour; lens material state with transmission / clearcoat; per-product HDRI environment | MeshPhysical with variant tint |
| Renderer | [O] three.js-derived `GalaxyThreeGpu`, WebGPU with WebGL2 fallback | three.js WebGL2 |

## What to adopt (ranked by expected effect on perceived precision)

1. **Frame-synchronous rendering** — display the exact frame the pose was
   computed on (canvas texture), drop prediction. Removes swimming on motion.
2. **Own PnP on the 33 rigid landmarks** with the same 63° intrinsics as the
   renderer, replacing the MediaPipe matrix / iris-ray hybrid. One consistent
   camera model for pose and render.
3. **PD from iris circle-fit ratio** (FOV- and depth-independent) with the
   convergence factor; scale = 63.2 / PD.
4. Temple bending caps (outward only, ≤10°) and fade window per Meta values.
5. Per-SKU offsets (translation/rotation) in our catalogue, tuned once per GLB.
