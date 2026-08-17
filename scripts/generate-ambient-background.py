#!/usr/bin/env python3
"""Bake the ambient background canvases and the grain tile.

  assets/images/ambient-background.png                   1920x1080 default canvas
  assets/images/ambient-background-portrait.png          1080x1920 default canvas
  assets/images/ambient-background-filters.png           1920x1080 Filters screen canvas
  assets/images/ambient-background-filters-portrait.png  1080x1920 Filters screen canvas
  assets/images/dither-noise.png                         128px grayscale grain tile

Each orientation gets its own bake: cover-fit would crop a landscape canvas to its center
slice on a portrait window and lose every corner glow. Gradients are composited in float
and TPDF-dithered BEFORE 8-bit quantization, so the assets cannot band on 8-bit panels;
the app draws no runtime gradients over them. Deterministic seeds: rerunning produces
byte-identical assets."""
import os
import random
import struct
import zlib

import numpy as np

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "images")


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: str, arr: np.ndarray, grayscale: bool = False) -> None:
    height, width = arr.shape[:2]
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(height))
    color_type = 0 if grayscale else 2
    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {len(png)} bytes to {os.path.normpath(path)}")


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# Palette
NAVY = (34, 47, 62)  # #222f3e
SLATE = (47, 53, 66)  # #2f3542
LIME = (163, 203, 56)  # #A3CB38
AMBER = (247, 159, 31)  # #F79F1F
ACID = (170, 252, 7)
RUST = (199, 79, 52)
VIGNETTE_BLACK = (4, 7, 12)

# Default canvas: vignette sinking the frame edges, lime canopy top-right over slate and
# navy, an amber whisper bottom-right. Layers as (color, corner, radius, opacity); corner
# anchors sit just off-screen so only each glow's falloff is visible.
DEFAULT_LAYERS = [
    (SLATE, "TL", 1000, 0.55),
    (LIME, "TR", 1200, 0.22),
    (NAVY, "BL", 1250, 0.50),
    (AMBER, "BR", 1000, 0.14),
]

# Filters canvas: dim acid/rust pair on a near-black base, no vignette.
FILTERS_LAYERS = [
    (ACID, "TR", 920, 0.035),
    (RUST, "BL", 1000, 0.05),
]


def bake(name: str, w: int, h: int, base: tuple[int, int, int], layers, vignette: bool) -> None:
    X, Y = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    anchors = {"TL": (-120, -120), "TR": (w + 120, -120), "BL": (-120, h + 180), "BR": (w + 120, h + 180)}
    canvas = np.full((h, w, 3), np.array(base, dtype=np.float64))

    def over(rgb, alpha):
        a = alpha[..., None]
        return canvas * (1.0 - a) + np.array(rgb, dtype=np.float64) * a

    if vignette:
        # Elliptical farthest-corner falloff: clear through 45%, 42% black at the corners.
        t = np.sqrt(((X - w / 2) / (w / 2)) ** 2 + ((Y - h / 2) / (h / 2)) ** 2) / np.sqrt(2.0)
        canvas = over(VIGNETTE_BLACK, 0.42 * smoothstep((t - 0.45) / 0.55))
    for rgb, corner, radius, opacity in layers:
        cx, cy = anchors[corner]
        # Flat core through 35% of the radius, smooth fade to nothing at 100%.
        r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) / radius
        canvas = over(rgb, opacity * (1.0 - smoothstep((r - 0.35) / 0.65)))
    # TPDF dither (±1 LSB triangular) before rounding: randomized quantization carries the
    # gradient's sub-LSB information as noise instead of collapsing it into bands.
    rng = np.random.default_rng(20260817)
    dither = rng.random((h, w, 3)) - rng.random((h, w, 3))
    write_png(os.path.join(OUT_DIR, name), np.clip(np.rint(canvas + dither), 0, 255).astype(np.uint8))


bake("ambient-background.png", 1920, 1080, (20, 20, 20), DEFAULT_LAYERS, vignette=True)
bake("ambient-background-portrait.png", 1080, 1920, (20, 20, 20), DEFAULT_LAYERS, vignette=True)
bake("ambient-background-filters.png", 1920, 1080, (13, 13, 15), FILTERS_LAYERS, vignette=False)
bake("ambient-background-filters-portrait.png", 1080, 1920, (13, 13, 15), FILTERS_LAYERS, vignette=False)

# 128px grayscale grain tile, drawn 1:1 over the baked canvas as film texture. random (not
# numpy) with this exact loop keeps the asset byte-identical across regenerations.
random.seed(20260817)
SIZE = 128
tile = np.array([[random.randrange(256) for _ in range(SIZE)] for _ in range(SIZE)], dtype=np.uint8)
write_png(os.path.join(OUT_DIR, "dither-noise.png"), tile, grayscale=True)
