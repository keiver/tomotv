#!/usr/bin/env bash
# Clears caches, prebuilds, and starts Metro.
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
  npm i --before="$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"
fi

case "$PLATFORM" in
  dual) yes | npm run prebuild:dual ;;
  tv) yes | EXPO_TV=1 npx expo prebuild --clean ;;
  ios) yes | npx expo prebuild --clean ;;
esac

bash scripts/check-firewall.sh
npx expo start --clear --dev-client
