#!/usr/bin/env bash
# Clears caches, prebuilds, opens the workspace in Xcode, and starts Metro.
# Usage: npm run clear [-- --npm] [-- --tv|--ios]
#   --npm   also nuke node_modules + package-lock.json and reinstall
#   --tv    prebuild tvOS only (default: dual)
#   --ios   prebuild iOS only (default: dual)
set -eu
cd "$(dirname "$0")/.."

NUKE_NPM=0
PLATFORM="dual"
for arg in "$@"; do
  case "$arg" in
    --npm) NUKE_NPM=1 ;;
    --tv) PLATFORM="tv" ;;
    --ios) PLATFORM="ios" ;;
    *) echo "Unknown arg: $arg (supported: --npm, --tv, --ios)" && exit 1 ;;
  esac
done

rm -rf .expo .metro-cache

if [ "$NUKE_NPM" = "1" ]; then
  rm -rf node_modules package-lock.json
  npm i
fi

case "$PLATFORM" in
  dual) yes | npm run prebuild:dual ;;
  tv) yes | EXPO_TV=1 npx expo prebuild --clean ;;
  ios) yes | npx expo prebuild --clean ;;
esac

case "$PLATFORM" in
  dual) WORKSPACE="$PWD/TomoTV.xcworkspace" ;;
  *) WORKSPACE="$PWD/ios/TomoTV.xcworkspace" ;;
esac

xcode_has_workspace() {
  pgrep -f 'Xcode.app/Contents/MacOS/Xcode$' >/dev/null || return 1
  osascript -e 'tell application "Xcode" to get path of every workspace document' 2>/dev/null \
    | tr ',' '\n' | sed 's/^ *//' | grep -qxF "$1"
}

# Xcode drops a still-open workspace whose bundle prebuild replaced on disk instead of
# reloading it, so the fresh one needs a second open after the drop (measured: ~5s).
if xcode_has_workspace "$WORKSPACE"; then
  open -a Xcode "$WORKSPACE"
  for _ in $(seq 1 30); do
    sleep 1
    xcode_has_workspace "$WORKSPACE" || break
  done
fi
open -a Xcode "$WORKSPACE"

bash scripts/check-firewall.sh
npx expo start --clear --dev-client
