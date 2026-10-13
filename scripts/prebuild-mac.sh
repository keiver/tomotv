#!/usr/bin/env bash
# Expo writes ios/. Park that tree while generating Catalyst, then install Pods
# from their final macos/ path. A failed or interrupted run restores the iOS tree.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-build-lock.sh
STATE=".prebuild-mac-backup"

recover() {
  [ -d "$STATE" ] || return 0
  if [ -f "$STATE/pid" ] && [ "$(cat "$STATE/pid")" != "$$" ] && kill -0 "$(cat "$STATE/pid")" 2>/dev/null; then
    echo "Catalyst prebuild is already running (PID $(cat "$STATE/pid"))." >&2
    return 1
  fi
  if [ -d "$STATE/ios" ] || [ -f "$STATE/active" ]; then
    if [ -d ios ]; then
      rm -rf macos
      mv ios macos
    fi
    rm -f "$STATE/active"
    if [ -d "$STATE/ios" ]; then mv "$STATE/ios" ios; fi
  fi
  rm -rf "$STATE"
}
recover
[ "${1:-}" != "--recover" ] || exit 0
[ $# -eq 0 ] || { echo "Usage: $0 [--recover]" >&2; exit 1; }
bash scripts/check-xcode-tools.sh
python3 scripts/check-catalyst-frameworks.py

hash_files() {
  for f in "$@"; do echo "$f"; cat "$f"; done | shasum -a 256 | cut -d' ' -f1
}
PROJECT_HASH="$(hash_files app.json package.json package-lock.json scripts/prebuild-mac.sh scripts/make-dual-workspace.sh scripts/link-platform-pods.js scripts/catalyst-frameworks.rb scripts/fix-catalyst-framework.py \
  $(find plugins patches assets/brand -type f -not -name .DS_Store | LC_ALL=C sort))"
PODS_HASH="$(
  {
    hash_files packages/tomo-engine/ffmpeg-lock.json $(find packages modules -path '*/Frameworks' -prune -o -path '*/.build' -prune -o -type f \( -name '*.podspec' -o -name expo-module.config.json \) -print | LC_ALL=C sort)
    find packages modules -path '*/Frameworks' -prune -o -path '*/.build' -prune -o -type f \( -name '*.swift' -o -name '*.m' -o -name '*.h' -o -name '*.c' \) -print | LC_ALL=C sort
    pod --version
    stat -f '%m' node_modules/.package-lock.json
  } | shasum -a 256 | cut -d' ' -f1
)"
INCREMENTAL=0
RUN_PODS=1
if [ -f macos/.prebuild-inputs ] && [ "$(cat macos/.prebuild-inputs)" = "$PROJECT_HASH" ] \
  && [ -d macos/TomoTV-macOS.xcodeproj ] && [ -d macos/Pods/Pods-macOS.xcodeproj ]; then
  INCREMENTAL=1
  if [ -f macos/.pods-inputs ] && [ "$(cat macos/.pods-inputs)" = "$PODS_HASH" ]; then RUN_PODS=0; fi
fi
rm -f macos/.prebuild-inputs macos/.pods-inputs
mkdir "$STATE"
echo "$$" > "$STATE/pid"
trap 'recover; [ -z "${MTIMES:-}" ] || rm -f "$MTIMES"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -d ios ]; then mv ios "$STATE/ios"; fi
touch "$STATE/active"

MTIMES="$(mktemp)"
if [ "$INCREMENTAL" = 1 ]; then
  /usr/bin/python3 scripts/preserve-mtimes.py snapshot "$MTIMES" macos
  mv macos ios
  mv ios/TomoTV-macOS.xcodeproj ios/TomoTV.xcodeproj
  mv ios/Pods/Pods-macOS.xcodeproj ios/Pods/Pods.xcodeproj
  sed -i '' 's|Pods-macOS.xcodeproj|Pods.xcodeproj|g' ios/TomoTV.xcodeproj/project.pbxproj
  SCHEMES=ios/TomoTV.xcodeproj/xcshareddata/xcschemes
  mv "$SCHEMES/TomoTV-macOS.xcscheme" "$SCHEMES/TomoTV.xcscheme"
  sed -i '' 's|container:TomoTV-macOS.xcodeproj|container:TomoTV.xcodeproj|g' "$SCHEMES/TomoTV.xcscheme"
  CLEAN=--no-clean
else
  CLEAN=--clean
fi
EXPO_TV=0 EXPO_MACCATALYST=1 npx expo prebuild "$CLEAN" --platform ios --no-install
rm -rf macos
mv ios macos
rm -f "$STATE/active"
if [ -d "$STATE/ios" ]; then mv "$STATE/ios" ios; fi
rm -rf "$STATE"
trap 'rm -f "$MTIMES"' EXIT
trap - INT TERM

if [ "$RUN_PODS" = 1 ]; then
  bash scripts/rn-artifact-cache.sh seed macos
  ( cd macos && EXPO_TV=0 EXPO_MACCATALYST=1 pod install )
  bash scripts/rn-artifact-cache.sh save macos
fi
bash scripts/make-dual-workspace.sh --mac-only
if [ "$INCREMENTAL" = 1 ]; then /usr/bin/python3 scripts/preserve-mtimes.py restore "$MTIMES"; fi
rm -f "$MTIMES"
echo "$PROJECT_HASH" > macos/.prebuild-inputs
echo "$PODS_HASH" > macos/.pods-inputs
