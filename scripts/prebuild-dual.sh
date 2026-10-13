#!/usr/bin/env bash
# Prebuilds iOS, optionally Mac Catalyst, then tvOS into separate projects.
# Each pod install is bracketed by the RN artifact cache so `--clean` wipes
# don't force a full re-download of the prebuilt tarballs every run.
# Updates the existing trees in place so Xcode keeps compiled Pods: project
# inputs changed -> --clean, pod inputs changed -> pod install, else neither.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-build-lock.sh
WITH_MAC=0
case "${1:-}" in
  --with-mac) WITH_MAC=1 ;;
  "") ;;
  *) echo "Usage: $0 [--with-mac]" >&2; exit 1 ;;
esac
[ $# -le 1 ] || { echo "Usage: $0 [--with-mac]" >&2; exit 1; }
export EXPO_MACCATALYST=0
export EXPO_TV=0
bash scripts/check-xcode-tools.sh
if [ "$WITH_MAC" = "1" ]; then
  bash scripts/prebuild-mac.sh --recover
  python3 scripts/check-catalyst-frameworks.py
fi

# tvOS temporarily uses ios/. Restore the completed iOS tree after a failure
# or interruption, including a previous process that was killed before cleanup.
recover_ios() {
  [ -d ios.iphone ] || return 0
  if [ -d ios ]; then
    rm -rf tvos
    mv ios tvos
  fi
  mv ios.iphone ios
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  recover_ios
  if [ -n "${MTIMES:-}" ]; then rm -f "$MTIMES"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
recover_ios

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
  hash_files app.json package.json package-lock.json scripts/prebuild-dual.sh scripts/make-dual-workspace.sh scripts/link-platform-pods.js scripts/prebuilt-swift-imports.rb \
    $(find plugins patches assets/brand -type f -not -name .DS_Store | LC_ALL=C sort)
}

# node_modules/.package-lock.json is rewritten by every npm install, which also
# replaces the ExpoModulesJSI stub that pod install stamps. Local modules/ and the tomo-live
# workspace are pods too: only pod install links a new module or registers an added or removed native file.
pods_hash() {
  {
    hash_files packages/tomo-engine/ios/TomoEngine.podspec packages/tomo-engine/ios/TomoLiveSources.podspec packages/tomo-engine/ios/TomoFFmpeg.podspec packages/tomo-engine/ffmpeg-lock.json
    hash_files $(find modules packages/tomo-live \( -name expo-module.config.json -o -name '*.podspec' \) -type f | LC_ALL=C sort)
    find modules packages/tomo-live -path '*/ios/*' -type f -not -name .DS_Store | LC_ALL=C sort
    # The engine pods glob their sources at pod install, so an added or removed engine file is a pod input.
    find packages/tomo-engine/ios -path packages/tomo-engine/ios/Frameworks -prune -o -type f \( -name '*.swift' -o -name '*.m' -o -name '*.h' -o -name '*.c' \) -print | LC_ALL=C sort
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
  sed -i '' "s|Pods-$suffix.xcodeproj|Pods.xcodeproj|g" "$dir/TomoTV.xcodeproj/project.pbxproj"
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
  /usr/bin/python3 scripts/preserve-mtimes.py snapshot "$MTIMES" ios tvos
  if [ "$RUN_PODS" = "1" ]; then
    echo "prebuild-dual: project inputs unchanged, pod inputs changed: updating in place with pod install"
  else
    echo "prebuild-dual: project and pod inputs unchanged: updating in place, skipping pod install"
  fi
else
  echo "prebuild-dual: project inputs changed or no complete prior run: prebuilding --clean"
fi

STEPS=2
if [ "$WITH_MAC" = "1" ]; then STEPS=3; fi
echo "prebuild: [1/$STEPS] iOS"
if [ "$INCREMENTAL" = "1" ]; then
  unsuffix ios iOS
  # Expo SDK 57 clears the tree, Pods included, unless told not to.
  expo prebuild --no-clean --platform ios --no-install
else
  expo prebuild --clean --platform ios --no-install
fi
if [ "$RUN_PODS" = "1" ]; then
  cache seed ios
  ( cd ios && pod install )
  cache save ios
fi

if [ "$WITH_MAC" = "1" ]; then
  echo "prebuild: [2/$STEPS] Mac Catalyst"
  bash scripts/prebuild-mac.sh
fi

echo "prebuild: [$STEPS/$STEPS] tvOS"
# Expo only writes ios/. Park iOS while generating tvOS, then install Pods
# from tvos/ so their generated paths point at the final location.
mv ios ios.iphone
if [ "$INCREMENTAL" = "1" ]; then
  mv tvos ios
  unsuffix ios tvOS
  EXPO_TV=1 expo prebuild --no-clean --platform ios --no-install
else
  EXPO_TV=1 expo prebuild --clean --platform ios --no-install
  rm -rf tvos
fi
mv ios tvos
mv ios.iphone ios
if [ "$RUN_PODS" = "1" ]; then
  cache seed tvos
  ( cd tvos && EXPO_TV=1 pod install )
  cache save tvos
fi

if [ "$WITH_MAC" = "1" ]; then
  bash scripts/make-dual-workspace.sh --all
else
  bash scripts/make-dual-workspace.sh
fi
if [ "$INCREMENTAL" = "1" ]; then
  /usr/bin/python3 scripts/preserve-mtimes.py restore "$MTIMES"
fi
echo "$PROJECT_HASH" > "$PROJECT_STAMP"
echo "$PODS_HASH" > "$PODS_STAMP"
