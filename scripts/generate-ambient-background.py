#!/usr/bin/env python3
"""Bake the ambient background canvases and the grain tile.

  assets/images/ambient-background.png          1920x1080 default canvas
  assets/images/ambient-background-filters.png  1920x1080 Filters screen canvas
  assets/images/dither-noise.png                128px grayscale grain tile

Gradients are composited in float and TPDF-dithered BEFORE 8-bit quantization, so the
assets cannot band on 8-bit panels; the app draws no runtime gradients over them.
Deterministic seeds: rerunning produces byte-identical assets."""
import os
import random
import struct
import zlib

import numpy as np

W, H = 1920, 1080
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


X, Y = np.meshgrid(np.arange(W, dtype=np.float64), np.arange(H, dtype=np.float64))


def glow_alpha(cx: float, cy: float, radius: float, opacity: float) -> np.ndarray:
    """Flat core through 35% of the radius, smooth fade to nothing at 100%."""
    r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2) / radius
    return opacity * (1.0 - smoothstep((r - 0.35) / 0.65))


def vignette_alpha(start: float, opacity: float) -> np.ndarray:
    """Elliptical farthest-corner falloff: clear through `start`, `opacity` black at the corners."""
    nx = (X - W / 2) / (W / 2)
    ny = (Y - H / 2) / (H / 2)
    t = np.sqrt(nx**2 + ny**2) / np.sqrt(2.0)
    return opacity * smoothstep((t - start) / (1.0 - start))


def over(canvas: np.ndarray, rgb: tuple[int, int, int], alpha: np.ndarray) -> np.ndarray:
    a = alpha[..., None]
    return canvas * (1.0 - a) + np.array(rgb, dtype=np.float64) * a


def bake(name: str, base: tuple[int, int, int], layers: list[tuple[tuple[int, int, int], np.ndarray]]) -> None:
    canvas = np.full((H, W, 3), np.array(base, dtype=np.float64))
    for rgb, alpha in layers:
        canvas = over(canvas, rgb, alpha)
    # TPDF dither (±1 LSB triangular) before rounding: randomized quantization carries the
    # gradient's sub-LSB information as noise instead of collapsing it into bands.
    rng = np.random.default_rng(20260817)
    dither = rng.random((H, W, 3)) - rng.random((H, W, 3))
    out = np.clip(np.rint(canvas + dither), 0, 255).astype(np.uint8)
    write_png(os.path.join(OUT_DIR, name), out)


# Default canvas: #141414 base, blue-black vignette sinking the frame edges, four corner
# glows from the app palette — #A3CB38 lime canopy top-right over #2f3542 slate and
# #222f3e navy, with an #F79F1F amber whisper bottom-right.
bake(
    "ambient-background.png",
    base=(20, 20, 20),
    layers=[
        ((4, 7, 12), vignette_alpha(start=0.45, opacity=0.42)),
        ((47, 53, 66), glow_alpha(cx=-120, cy=-120, radius=1000, opacity=0.55)),
        ((163, 203, 56), glow_alpha(cx=W + 120, cy=-120, radius=1200, opacity=0.22)),
        ((34, 47, 62), glow_alpha(cx=-120, cy=H + 180, radius=1250, opacity=0.50)),
        ((247, 159, 31), glow_alpha(cx=W + 120, cy=H + 180, radius=1000, opacity=0.14)),
    ],
)

# Filters canvas: dimmer acid/rust pair on a near-black base, no vignette.
bake(
    "ambient-background-filters.png",
    base=(13, 13, 15),
    layers=[
        ((170, 252, 7), glow_alpha(cx=W + 120, cy=-120, radius=920, opacity=0.035)),
        ((199, 79, 52), glow_alpha(cx=-120, cy=H + 180, radius=1000, opacity=0.05)),
    ],
)

# 128px grayscale grain tile, drawn 1:1 over the baked canvas as film texture. random (not
# numpy) with this exact loop keeps the asset byte-identical across regenerations.
random.seed(20260817)
SIZE = 128
tile = np.array([[random.randrange(256) for _ in range(SIZE)] for _ in range(SIZE)], dtype=np.uint8)
write_png(os.path.join(OUT_DIR, "dither-noise.png"), tile, grayscale=True)
