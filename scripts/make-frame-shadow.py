"""Generic spectacle ground shadow for the frame dial (FrameWheel.tsx).

Traced from the design sketch (scripts/assets/frame-shadow-sketch.png): the
frame front with its two lens shapes along a slanted line, and two straight,
parallel arms running back to the upper right — the dial's three-quarter
view. The sketch's dark pixels become the shape; it is scaled into a fixed
footprint, edge-smoothed, then blurred, on a transparent background — saved
twice: white (frame-shadow-light.png, for frames on the dark disc) and black
(frame-shadow-dark.png, for the selected frame in the light box). The dial
crossfades between them as a frame moves in or out of the box.

    python scripts/make-frame-shadow.py public/images

Needs Pillow + numpy (both in voice_agent/.venv).
"""
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "public/images")
SKETCH = pathlib.Path(__file__).parent / "assets" / "frame-shadow-sketch.png"

S = 3  # supersample, then downscale for smooth edges
W0, H0 = 800, 380  # canvas; room around the shape so the blur isn't cut off
# Where the shape goes in the canvas (FrameWheel.tsx places the canvas so
# this footprint sits under the frame).
FOOT_X, FOOT_Y, FOOT_W = 66, 64, 667
# (file name, colour, density 0–255: how strong the shadow is)
VERSIONS = [
    ("frame-shadow-light.png", (255, 255, 255), 95),
    ("frame-shadow-dark.png", (0, 0, 0), 95),
]
SOFTNESS = 20  # blur (px at final size)

# 1. The sketch's dark pixels → a crisp mask, cropped to the shape.
sketch = np.array(Image.open(SKETCH).convert("L"))
ys, xs = np.where(sketch < 128)
crop = sketch[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
mask = Image.fromarray(np.where(crop < 128, 255, 0).astype(np.uint8))

# 2. Scale into the footprint (keeping the sketch's proportions) and smooth
#    the pixel-art edges before re-thresholding.
fw = FOOT_W * S
fh = round(fw * mask.height / mask.width)
mask = mask.resize((fw, fh), Image.LANCZOS).filter(ImageFilter.GaussianBlur(2.5 * S))
mask = mask.point(lambda v: 255 if v >= 128 else 0)

# 3. Place, blur, then one file per colour.
alpha = Image.new("L", (W0 * S, H0 * S), 0)
alpha.paste(mask, (FOOT_X * S, FOOT_Y * S))
alpha = alpha.filter(ImageFilter.GaussianBlur(SOFTNESS * S))

for name, colour, density in VERSIONS:
    img = Image.new("RGB", (W0 * S, H0 * S), colour)
    img.putalpha(alpha.point(lambda v: v * density // 255))
    img = img.resize((W0, H0), Image.LANCZOS)
    img.save(out_dir / name, "PNG", optimize=True)
    print("saved", out_dir / name, img.size)
