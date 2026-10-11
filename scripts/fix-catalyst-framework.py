#!/usr/bin/env python3
"""Restore the versioned layout of the embedded React Native dependency framework.

The published Debug and Release tarballs contain dereferenced copies of the
framework's links. Repair only the embedded copy, after rsync and before lipo
and codesign, so configuration switches and cached Pods use the same fix.
"""

import filecmp
from pathlib import Path
import plistlib
import shutil
import sys


def identical(left, right):
    if left.is_symlink() or right.is_symlink():
        return left.is_symlink() and right.is_symlink() and left.readlink() == right.readlink()
    if left.is_file() and right.is_file():
        return filecmp.cmp(left, right, shallow=False)
    if left.is_dir() and right.is_dir():
        names = {p.name for p in left.iterdir()}
        return names == {p.name for p in right.iterdir()} and all(
            identical(left / name, right / name) for name in names
        )
    return False


def repair(framework):
    name = "ReactNativeDependencies"
    if framework.name != f"{name}.framework":
        raise ValueError(f"Unexpected framework: {framework}")
    version = framework / "Versions/A"
    info = plistlib.loads((version / "Resources/Info.plist").read_bytes())
    if info.get("CFBundlePackageType") != "FMWK" or info.get("CFBundleExecutable") != name:
        raise ValueError(f"Unexpected framework metadata: {framework}")
    links = [
        (framework / "Versions/Current", "A", version),
        (framework / name, f"Versions/Current/{name}", version / name),
        (framework / "Resources", "Versions/Current/Resources", version / "Resources"),
    ]
    # Validate all duplicate contents before replacing any of them with links.
    for duplicate, _, original in links:
        if duplicate.is_symlink():
            if duplicate.resolve() != original.resolve():
                raise ValueError(f"Unexpected framework link: {duplicate}")
        elif duplicate.exists() and not identical(duplicate, original):
            raise ValueError(f"Framework copies differ; refusing to discard {duplicate}")
        if not original.exists():
            raise ValueError(f"Missing framework contents: {original}")
    for duplicate, target, _ in links:
        if duplicate.is_symlink():
            continue
        if duplicate.is_dir():
            shutil.rmtree(duplicate)
        elif duplicate.exists():
            duplicate.unlink()
        duplicate.symlink_to(target)

    # Preserve the packaged privacy manifests inside the signed version's resources.
    # No root aliases: codesign requires each root link to point to its namesake
    # directly in Versions/Current, not to a child of that version's Resources.
    for bundle in framework.glob(f"{name}_*.bundle"):
        destination = version / "Resources" / bundle.name
        if bundle.is_symlink():
            # Remove aliases left by the previous repair without losing their data.
            if not destination.is_dir() or bundle.resolve() != destination.resolve():
                raise ValueError(f"Unexpected framework resource link: {bundle}")
            bundle.unlink()
            continue
        if destination.exists():
            if not identical(bundle, destination):
                raise ValueError(f"Framework resource copies differ: {bundle}")
            shutil.rmtree(bundle)
        else:
            bundle.rename(destination)


if __name__ == "__main__":
    try:
        repair(Path(sys.argv[1]))
    except (IndexError, OSError, ValueError) as error:
        sys.exit(f"error: Catalyst framework layout: {error}")
