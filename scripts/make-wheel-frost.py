"""Frosted-glass circles for the frame dial (FrameWheel.tsx).

The dial used two live backdrop blurs over the camera picture (2 px across
the disc, 20 px fading in toward the rim). Re-blurring the moving video every
frame was one of the biggest GPU costs on the try-on page and slowed face
tracking, so the blur is now baked into transparency instead: two still
images, stacked under the dial's dark tint.

  wheel-frost-centre.png : a faint, even haze over the whole disc (was the
                           light 2 px blur) with a soft mottle, like glass
  wheel-frost-rim.png    : clear in the middle, fading in from FADE_FROM to
                           FADE_TO of the radius to a milky haze that hides
                           the detail behind the rim (was the 20 px blur)

Smooth alpha only (no per-pixel grain) so the files stay small; a light
ordered dither keeps the long gradients free of banding. 2048 px square, so
the disc stays crisp on large kiosk screens at 2× pixel ratio.

    python scripts/make-wheel-frost.py public/images

Needs Pillow + numpy (both in voice_agent/.venv).
"""
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "public/images")
SIZE = 2048
S = 2  # supersample the circle edge, then downscale

# Same fade band as the old blur mask (fractions of the drawn radius).
FADE_FROM = 0.45
FADE_TO = 0.85

# Haze colour: light scattered by frosted glass reads as a cool, desaturated
# grey; the dial's dark tint on top brings it back down to the disc's tone.
CENTRE_RGB = (196, 200, 210)
CENTRE_ALPHA = 0.14
RIM_RGB = (120, 124, 134)
RIM_ALPHA = 0.80
# Soft low-frequency mottle (± alpha) so the surface doesn't look like a flat
# sticker; frosted glass is never perfectly even.
MOTTLE = 0.035


def radius_grid(n: int) -> np.ndarray:
    c = (n - 1) / 2
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return np.hypot(x - c, y - c) / (n / 2)


def mottle(n: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    small = rng.standard_normal((n // 64, n // 64)).astype(np.float32)
    img = Image.fromarray(((small - small.min()) / (np.ptp(small) or 1) * 255).astype(np.uint8))
    img = img.resize((n, n), Image.BICUBIC).filter(ImageFilter.GaussianBlur(n / 80))
    m = np.asarray(img, dtype=np.float32) / 255.0
    return (m - m.mean()) / (np.ptp(m) or 1) * 2  # roughly −1…1


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bayer(n: int) -> np.ndarray:
    m = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32)
    return (np.tile(m, (n // 4, n // 4)) + 0.5) / 16 - 0.5


def save(name: str, rgb: tuple, alpha: np.ndarray) -> None:
    big = SIZE * S
    r = radius_grid(big)
    edge = np.clip((1.0 - r) * big / 2, 0, 1)  # 1 px anti-aliased rim
    a_big = Image.fromarray((np.clip(alpha, 0, 1) * edge * 65535).astype(np.uint16))
    # Downscale the alpha in float for an even edge.
    a = np.asarray(
        Image.fromarray(np.asarray(a_big, np.float32)).resize((SIZE, SIZE), Image.BOX),
        np.float32,
    ) / 65535
    a8 = np.clip(np.floor(a * 255 + 0.5 + bayer(SIZE) * 0.9), 0, 255).astype(np.uint8)
    out = np.zeros((SIZE, SIZE, 4), np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = rgb
    out[..., 3] = a8
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    Image.fromarray(out, "RGBA").save(path, optimize=True)
    print(f"{path}  {path.stat().st_size / 1024:.0f} KB")


big = SIZE * S
r = radius_grid(big)
mot = np.asarray(
    Image.fromarray(mottle(SIZE, 7)).resize((big, big), Image.BICUBIC), np.float32
)

centre = CENTRE_ALPHA * (1 + 0.15 * smoothstep(0.0, 1.0, r)) + MOTTLE * 0.5 * mot
save("wheel-frost-centre.png", CENTRE_RGB, np.where(r <= 1, centre, 0))

rim = RIM_ALPHA * smoothstep(FADE_FROM, FADE_TO, r) + MOTTLE * mot * smoothstep(FADE_FROM, FADE_TO, r)
save("wheel-frost-rim.png", RIM_RGB, np.where(r <= 1, rim, 0))
