#!/usr/bin/env python3
"""Fail before prebuild when the installed media release lacks universal Catalyst."""
import json
import pathlib
import plistlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
engine = root / "packages/tomo-engine"
lock = json.loads((engine / "ffmpeg-lock.json").read_text())
frameworks = engine / "ios/Frameworks"
try:
    installed = json.loads((frameworks / ".installed.json").read_text())
except (OSError, ValueError):
    installed = {}
problems = []
for name, checksum in lock["artifacts"].items():
    try:
        info = plistlib.loads((frameworks / f"{name}.xcframework/Info.plist").read_bytes())
        slices = [s for s in info["AvailableLibraries"] if s.get("SupportedPlatformVariant") == "maccatalyst"]
        valid = len(slices) == 1 and slices[0]["SupportedPlatform"] == "ios" and set(slices[0]["SupportedArchitectures"]) == {"arm64", "x86_64"}
        if not valid or installed.get(name) != checksum:
            problems.append(name)
    except (OSError, ValueError, KeyError):
        problems.append(name)
if problems:
    print(f"Missing or outdated universal Catalyst frameworks: {', '.join(problems)}", file=sys.stderr)
    print(f"Install {lock['tag']} with npm run fetch:ffmpeg. For unpublished local artifacts, see docs/RELEASING.md.", file=sys.stderr)
    sys.exit(1)
