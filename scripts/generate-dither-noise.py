#!/usr/bin/env python3
"""Regenerate assets/images/dither-noise.png — the 128px grayscale noise tile that
AmbientBackground tiles over its gradients to hide 8-bit banding on TV panels.
Deterministic seed: rerunning produces a byte-identical asset."""
import os
import random
import struct
import zlib

random.seed(20260817)
SIZE = 128
rows = []
for _ in range(SIZE):
    row = bytearray([0])  # PNG filter type 0 (None)
    row.extend(random.randrange(256) for _ in range(SIZE))
    rows.append(bytes(row))
raw = b"".join(rows)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 0, 0, 0, 0)  # 8-bit grayscale
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

out = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "dither-noise.png")
with open(out, "wb") as f:
    f.write(png)
print(f"wrote {len(png)} bytes to {os.path.normpath(out)}")
