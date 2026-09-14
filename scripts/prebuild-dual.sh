#!/usr/bin/env bash
# Prebuilds both platforms into ios/ + tvos/ and writes the dual workspace.
# Each pod install is bracketed by the RN artifact cache so `--clean` wipes
# don't force a full re-download of the prebuilt tarballs every run.
set -euo pipefail
cd "$(dirname "$0")/.."

cache() { bash scripts/rn-artifact-cache.sh "$@"; }

# tvOS: prebuild as ios/ (no pods yet), rename to tvos/, then install.
EXPO_TV=1 expo prebuild --clean --platform ios --no-install
rm -rf tvos && mv ios tvos
cache seed tvos
( cd tvos && EXPO_TV=1 RCT_IGNORE_PODS_DEPRECATION=1 pod install )
cache save tvos

# iOS: prebuild without auto-install so we can seed before pods.
expo prebuild --clean --platform ios --no-install
cache seed ios
( cd ios && RCT_IGNORE_PODS_DEPRECATION=1 pod install )
cache save ios

bash scripts/make-dual-workspace.sh
