#!/usr/bin/env bash
# Prebuilds both platforms into ios/ + tvos/ and writes the dual workspace.
# Each pod install is bracketed by the RN artifact cache so `--clean` wipes
# don't force a full re-download of the prebuilt tarballs every run.
# Updates the existing trees in place so Xcode keeps compiled Pods: project
# inputs changed -> --clean, pod inputs changed -> pod install, else neither.
set -euo pipefail
cd "$(dirname "$0")/.."

cache() { bash scripts/rn-artifact-cache.sh "$@"; }

PROJECT_STAMP="tvos/.prebuild-inputs"
PODS_STAMP="tvos/.pods-inputs"

hash_files() {
  for f in "$@"; do
    echo "$f"
    cat "$f"
  done | shasum -a 256 | cut -d' ' -f1
}

# Plugins carry the native file lists, so a removed native file changes this too.
project_hash() {
  hash_files app.json package.json package-lock.json scripts/prebuild-dual.sh scripts/make-dual-workspace.sh \
    $(find plugins patches assets/brand -type f -not -name .DS_Store | LC_ALL=C sort)
}

# node_modules/.package-lock.json is rewritten by every npm install, which also
# replaces the ExpoModulesJSI stub that pod install stamps.
pods_hash() {
  {
    hash_files native/ios/TomoFFmpeg.podspec scripts/ffmpeg/ffmpeg-lock.json
    pod --version
    stat -f '%m' node_modules/.package-lock.json
  } | shasum -a 256 | cut -d' ' -f1
}

# Reverts make-dual-workspace's renames so expo prebuild and pod install find
# the stock TomoTV.xcodeproj / Pods.xcodeproj names.
unsuffix() {
  local dir="$1" suffix="$2"
  local schemes="$dir/TomoTV.xcodeproj/xcshareddata/xcschemes"
  mv "$dir/TomoTV-$suffix.xcodeproj" "$dir/TomoTV.xcodeproj"
  mv "$dir/Pods/Pods-$suffix.xcodeproj" "$dir/Pods/Pods.xcodeproj"
  mv "$schemes/TomoTV-$suffix.xcscheme" "$schemes/TomoTV.xcscheme"
  sed -i '' "s|container:TomoTV-$suffix.xcodeproj|container:TomoTV.xcodeproj|g" "$schemes/TomoTV.xcscheme"
}

PROJECT_HASH="$(project_hash)"
PODS_HASH="$(pods_hash)"
INCREMENTAL=0
if [ -f "$PROJECT_STAMP" ] && [ "$(cat "$PROJECT_STAMP")" = "$PROJECT_HASH" ] && [ ! -e ios.iphone ] \
  && [ -d ios/TomoTV-iOS.xcodeproj ] && [ -d ios/Pods/Pods-iOS.xcodeproj ] \
  && [ -d tvos/TomoTV-tvOS.xcodeproj ] && [ -d tvos/Pods/Pods-tvOS.xcodeproj ]; then
  INCREMENTAL=1
fi
RUN_PODS=1
if [ "$INCREMENTAL" = "1" ] && [ -f "$PODS_STAMP" ] && [ "$(cat "$PODS_STAMP")" = "$PODS_HASH" ]; then
  RUN_PODS=0
fi
# A run that dies midway leaves no stamps, so the next one starts clean.
rm -f "$PROJECT_STAMP" "$PODS_STAMP"

if [ "$INCREMENTAL" = "1" ]; then
  MTIMES="$(mktemp)"
  trap 'rm -f "$MTIMES"' EXIT
  /usr/bin/python3 scripts/preserve-mtimes.py snapshot "$MTIMES" ios tvos
  if [ "$RUN_PODS" = "1" ]; then
    echo "prebuild-dual: project inputs unchanged, pod inputs changed: updating in place with pod install"
  else
    echo "prebuild-dual: project and pod inputs unchanged: updating in place, skipping pod install"
  fi
  # tvOS: expo only writes to ios/, so park the iOS tree while tvOS is updated.
  # pod install runs from tvos/ so Pods record the final path.
  mv ios ios.iphone && mv tvos ios
  unsuffix ios tvOS
  # --no-clean: since Expo SDK 57 prebuild clears the tree, Pods included, unless told not to.
  EXPO_TV=1 expo prebuild --no-clean --platform ios --no-install
  mv ios tvos && mv ios.iphone ios
  if [ "$RUN_PODS" = "1" ]; then
    cache seed tvos
    ( cd tvos && EXPO_TV=1 pod install )
    cache save tvos
  fi

  unsuffix ios iOS
  expo prebuild --no-clean --platform ios --no-install
  if [ "$RUN_PODS" = "1" ]; then
    cache seed ios
    ( cd ios && pod install )
    cache save ios
  fi
else
  echo "prebuild-dual: project inputs changed or no complete prior run: prebuilding --clean"
  rm -rf ios.iphone

  # tvOS: prebuild as ios/ (no pods yet), rename to tvos/, then install.
  EXPO_TV=1 expo prebuild --clean --platform ios --no-install
  rm -rf tvos && mv ios tvos
  cache seed tvos
  ( cd tvos && EXPO_TV=1 pod install )
  cache save tvos

  # iOS: prebuild without auto-install so we can seed before pods.
  expo prebuild --clean --platform ios --no-install
  cache seed ios
  ( cd ios && pod install )
  cache save ios
fi

bash scripts/make-dual-workspace.sh
if [ "$INCREMENTAL" = "1" ]; then
  /usr/bin/python3 scripts/preserve-mtimes.py restore "$MTIMES"
fi
echo "$PROJECT_HASH" > "$PROJECT_STAMP"
echo "$PODS_HASH" > "$PODS_STAMP"
