#!/usr/bin/env python3
"""Keeps the mtime of generated files that prebuild or pod install rewrite byte-identical,
so Xcode does not recompile them. Usage: preserve-mtimes.py snapshot|restore <state> [roots...]"""
import hashlib
import json
import os
import sys

# Under Pods/ and build/, only these are rewritten; the rest is pod sources and build products.
PODS_KEEP = ("Target Support Files", "Local Podspecs", "React-Core-prebuilt")
BUILD_KEEP = ("generated",)


def digest(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def walk(root):
    for dirpath, dirnames, filenames in os.walk(root):
        parent = os.path.basename(dirpath)
        if os.path.dirname(dirpath) == root and parent == "Pods":
            dirnames[:] = [d for d in dirnames if d in PODS_KEEP or (d.startswith("Pods") and d.endswith(".xcodeproj"))]
        elif os.path.dirname(dirpath) == root and parent == "build":
            dirnames[:] = [d for d in dirnames if d in BUILD_KEEP]
        elif parent == "React-Core-prebuilt":
            dirnames[:] = []
        for name in filenames:
            path = os.path.join(dirpath, name)
            if os.path.isfile(path) and not os.path.islink(path):
                yield path


def snapshot(state, roots):
    entries = {}
    for root in roots:
        for path in walk(root):
            st = os.stat(path)
            entries[path] = [digest(path), st.st_atime_ns, st.st_mtime_ns]
    with open(state, "w") as f:
        json.dump(entries, f)


def restore(state):
    with open(state) as f:
        entries = json.load(f)
    kept = 0
    for path, (sha, atime, mtime) in entries.items():
        if os.path.isfile(path) and not os.path.islink(path) and digest(path) == sha:
            os.utime(path, ns=(atime, mtime))
            kept += 1
    print(f"preserve-mtimes: kept {kept} of {len(entries)} generated files unchanged")


if __name__ == "__main__":
    if sys.argv[1] == "snapshot":
        snapshot(sys.argv[2], sys.argv[3:])
    elif sys.argv[1] == "restore":
        restore(sys.argv[2])
    else:
        sys.exit(__doc__)
