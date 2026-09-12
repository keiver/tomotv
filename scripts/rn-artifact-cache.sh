#!/usr/bin/env bash
# Persists RN's prebuilt-tarball cache across `expo prebuild --clean`, which
# deletes ios/ + tvos/ (and the Pods/*-artifacts/ tarballs inside). RN keys its
# cache on File.exist? alone, so a copy kept here is reused verbatim; filenames
# carry the RN version, so stale versions simply stop matching.
# Usage: rn-artifact-cache.sh seed|save <platform-dir>
set -euo pipefail
cd "$(dirname "$0")/.."

CACHE=".rn-artifact-cache"
SUBDIRS=(ReactNativeCore-artifacts ReactNativeDependencies-artifacts)

cmd="${1:-}"
dir="${2:-}"
[ -n "$cmd" ] && [ -n "$dir" ] || { echo "usage: $0 seed|save <platform-dir>" >&2; exit 1; }

case "$cmd" in
  seed)
    for sub in "${SUBDIRS[@]}"; do
      src="$CACHE/$sub"
      [ -d "$src" ] || continue
      dest="$dir/Pods/$sub"
      mkdir -p "$dest"
      # -n: never clobber a fresher tarball pod install may have already written.
      find "$src" -name '*.tar.gz' -exec cp -n {} "$dest/" \;
    done
    ;;
  save)
    for sub in "${SUBDIRS[@]}"; do
      src="$dir/Pods/$sub"
      [ -d "$src" ] || continue
      dest="$CACHE/$sub"
      mkdir -p "$dest"
      find "$src" -name '*.tar.gz' -exec cp -n {} "$dest/" \;
    done
    ;;
  *) echo "usage: $0 seed|save <platform-dir>" >&2; exit 1 ;;
esac
