#!/usr/bin/env bash
#
# build-sim-release.sh -- the Release configuration, compiled for a simulator, for the playback suite.
#
# Usage:
#   npm run build:sim-release -- tvos     # from tvos/, the tree npm run prebuild:dual leaves
#   npm run build:sim-release -- ios      # from ios/ (iPhone and iPad)
#
# Prints the .app path last; run it with
#   npm run test:playback -- --udid <UDID> --app <path>

set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/native-build-lock.sh

case "${1:-}" in
  tvos) dir=tvos scheme=TomoTV-tvOS sdk=appletvsimulator destination="generic/platform=tvOS Simulator" ;;
  ios) dir=ios scheme=TomoTV-iOS sdk=iphonesimulator destination="generic/platform=iOS Simulator" ;;
  *)
    echo "Usage: npm run build:sim-release -- tvos|ios" >&2
    exit 1
    ;;
esac

workspace="$dir/TomoTV.xcworkspace"
[[ -d "$workspace" ]] || { echo "No $workspace: run npm run prebuild:dual first" >&2; exit 1; }

derived="build/sim-release/$1"
log="build/sim-release/$1.log"
mkdir -p "$derived"

echo "Building $scheme Release for $sdk (log: $log)"
if ! xcodebuild build -workspace "$workspace" -scheme "$scheme" -configuration Release \
  -sdk "$sdk" -destination "$destination" -derivedDataPath "$derived" ARCHS=arm64 >"$log" 2>&1; then
  grep -E "error:|BUILD FAILED" "$log" | tail -20 >&2
  echo "Build failed, full log: $log" >&2
  exit 1
fi

app=$(find "$derived/Build/Products/Release-$sdk" -maxdepth 1 -name "*.app" -print -quit)
[[ -n "$app" ]] || { echo "No .app under $derived/Build/Products/Release-$sdk" >&2; exit 1; }
[[ -f "$app/main.jsbundle" ]] || { echo "$app has no main.jsbundle: not a Release build" >&2; exit 1; }
echo "$(cd "$(dirname "$app")" && pwd)/$(basename "$app")"
