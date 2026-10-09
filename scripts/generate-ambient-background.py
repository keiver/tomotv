#!/usr/bin/env python3
"""Bake the ambient background canvases.

  assets/images/ambient-background-shade.png             1920x1080 default vignette mask
  assets/images/ambient-background-shade-portrait.png    1080x1920 default vignette mask
  assets/images/ambient-background-glow.png              1920x1080 default glow mask
  assets/images/ambient-background-glow-portrait.png     1080x1920 default glow mask
  assets/images/ambient-background-filters.png           1920x1080 Filters screen canvas
  assets/images/ambient-background-filters-portrait.png  1080x1920 Filters screen canvas

The default canvas ships as two alpha masks the app composites over its own base field:
a black shade mask carrying the vignette, then a white glow mask carrying both veils.
The glow draws as a template image (expo-image tintColor: colour from the tint, shape
from alpha), so the chosen theme hues the light at runtime; the neutral tint #DEE4F0
reproduces the single-canvas look within a count.

Each orientation gets its own bake: cover-fit would crop a landscape canvas to its center
slice on a portrait window and lose every corner glow. Gradients are composited in float
and TPDF-dithered BEFORE 8-bit quantization, so the assets cannot band on 8-bit panels;
the app draws no runtime gradients over them. Deterministic seeds: rerunning produces
byte-identical assets."""
import os
import struct
import zlib

import numpy as np

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "images")


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: str, arr: np.ndarray) -> None:
    height, width = arr.shape[:2]
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(height))
    color_type = 6 if arr.shape[2] == 4 else 2
    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {len(png)} bytes to {os.path.normpath(path)}")


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# Palette. Depth is luminance-only (the visionOS material language): a barely-cool white
# so the light reads neutral on warm-shifted panels, never a hue.
WHITE = (222, 228, 240)
GRAY = (175, 184, 198)
ACID = (170, 252, 7)
RUST = (199, 79, 52)

# Default canvas, "overhead veil": one soft neutral light washing down from above the
# frame, a broader whisper spreading it, and a neutral vignette sinking the floor and
# edges to theater black. Anchors are (w, h) -> center, so both orientations hang the
# light from their own top-center.
DEFAULT_LAYERS = [
    (WHITE, lambda w, h: (w / 2, -300), 1500, 0.06),
    (GRAY, lambda w, h: (w / 2, -100), 2200, 0.03),
]

# Filters canvas: dim acid/rust pair on a near-black base, no vignette.
FILTERS_LAYERS = [
    (ACID, lambda w, h: (w + 120, -120), 920, 0.035),
    (RUST, lambda w, h: (-120, h + 180), 1000, 0.05),
]


def bake(name: str, w: int, h: int, base: tuple[int, int, int], layers, vignette: tuple[float, float] | None) -> None:
    X, Y = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    canvas = np.full((h, w, 3), np.array(base, dtype=np.float64))

    def over(rgb, alpha):
        a = alpha[..., None]
        return canvas * (1.0 - a) + np.array(rgb, dtype=np.float64) * a

    if vignette is not None:
        # Elliptical farthest-corner falloff: clear through `start`, `opacity` black at the corners.
        opacity, start = vignette
        t = np.sqrt(((X - w / 2) / (w / 2)) ** 2 + ((Y - h / 2) / (h / 2)) ** 2) / np.sqrt(2.0)
        canvas = over((0, 0, 0), opacity * smoothstep((t - start) / (1.0 - start)))
    for rgb, anchor, radius, opacity in layers:
        cx, cy = anchor(w, h)
        # Flat core through 35% of the radius, smooth fade to nothing at 100%.
        r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) / radius
        canvas = over(rgb, opacity * (1.0 - smoothstep((r - 0.35) / 0.65)))
    rng = np.random.default_rng(20260817)
    # TPDF dither (±1 LSB triangular) before rounding: randomized quantization carries the
    # gradient's sub-LSB information as noise instead of collapsing it into bands. No film
    # grain on top; the dither alone keeps the gradient smooth, and it stays invisible.
    dither = rng.random((h, w, 3)) - rng.random((h, w, 3))
    write_png(os.path.join(OUT_DIR, name), np.clip(np.rint(canvas + dither), 0, 255).astype(np.uint8))


# The gray veil's contribution folded into the white glow mask, scaled by its relative
# luminance so a neutral-tinted draw matches the two-colour composite within a count.
GRAY_INTENSITY = float(np.mean(np.array(GRAY, dtype=np.float64) / np.array(WHITE, dtype=np.float64)))


def bake_default_masks(shade_name: str, glow_name: str, w: int, h: int) -> None:
    X, Y = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    # Elliptical farthest-corner falloff: clear through 42%, half black at the corners.
    t = np.sqrt(((X - w / 2) / (w / 2)) ** 2 + ((Y - h / 2) / (h / 2)) ** 2) / np.sqrt(2.0)
    shade_alpha = 0.50 * smoothstep((t - 0.42) / (1.0 - 0.42))
    layer_alphas = []
    for _rgb, anchor, radius, opacity in DEFAULT_LAYERS:
        cx, cy = anchor(w, h)
        r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) / radius
        layer_alphas.append(opacity * (1.0 - smoothstep((r - 0.35) / 0.65)))
    white_a, gray_a = layer_alphas
    glow_alpha = white_a * (1.0 - gray_a) + GRAY_INTENSITY * gray_a
    rng = np.random.default_rng(20260817)
    for name, rgb, alpha in ((shade_name, 0, shade_alpha), (glow_name, 255, glow_alpha)):
        arr = np.full((h, w, 4), rgb, dtype=np.float64)
        # Dither only the alpha: the colour channels are flat (the tint supplies the hue).
        arr[..., 3] = alpha * 255.0 + (rng.random((h, w)) - rng.random((h, w)))
        write_png(os.path.join(OUT_DIR, name), np.clip(np.rint(arr), 0, 255).astype(np.uint8))


# Base #1C1C1E: the app's intended dark field; the veil lifts a little above it and the
# vignette sinks the frame edges below it.
bake_default_masks("ambient-background-shade.png", "ambient-background-glow.png", 1920, 1080)
bake_default_masks("ambient-background-shade-portrait.png", "ambient-background-glow-portrait.png", 1080, 1920)
bake("ambient-background-filters.png", 1920, 1080, (13, 13, 15), FILTERS_LAYERS, vignette=None)
bake("ambient-background-filters-portrait.png", 1080, 1920, (13, 13, 15), FILTERS_LAYERS, vignette=None)
