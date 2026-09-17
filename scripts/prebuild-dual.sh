#!/usr/bin/env bash
# Prebuilds both platforms into ios/ + tvos/ and writes the dual workspace.
# Each pod install is bracketed by the RN artifact cache so `--clean` wipes
# don't force a full re-download of the prebuilt tarballs every run.
# Updates the existing trees in place (Xcode keeps compiled Pods) unless the
# prebuild inputs changed since the last successful run, then it goes --clean.
set -euo pipefail
cd "$(dirname "$0")/.."

cache() { bash scripts/rn-artifact-cache.sh "$@"; }

STAMP="tvos/.prebuild-inputs"

# Plugins carry the native file lists, so a removed native file changes this too.
inputs_hash() {
  {
    cat app.json package-lock.json native/ios/TomoFFmpeg.podspec \
      scripts/prebuild-dual.sh scripts/make-dual-workspace.sh
    find plugins patches assets/brand -type f -not -name .DS_Store | LC_ALL=C sort | while IFS= read -r f; do
      echo "$f"
      cat "$f"
    done
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

HASH="$(inputs_hash)"
INCREMENTAL=0
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$HASH" ] && [ ! -e ios.iphone ] \
  && [ -d ios/TomoTV-iOS.xcodeproj ] && [ -d ios/Pods/Pods-iOS.xcodeproj ] \
  && [ -d tvos/TomoTV-tvOS.xcodeproj ] && [ -d tvos/Pods/Pods-tvOS.xcodeproj ]; then
  INCREMENTAL=1
fi
# A run that dies midway leaves no stamp, so the next one starts clean.
rm -f "$STAMP"

if [ "$INCREMENTAL" = "1" ]; then
  echo "prebuild-dual: inputs unchanged, updating ios/ + tvos/ in place"
  # tvOS: expo only writes to ios/, so park the iOS tree while tvOS is updated.
  # pod install runs from tvos/ so Pods record the final path.
  mv ios ios.iphone && mv tvos ios
  unsuffix ios tvOS
  EXPO_TV=1 expo prebuild --platform ios --no-install
  mv ios tvos && mv ios.iphone ios
  cache seed tvos
  ( cd tvos && EXPO_TV=1 pod install )
  cache save tvos

  unsuffix ios iOS
  expo prebuild --platform ios --no-install
  cache seed ios
  ( cd ios && pod install )
  cache save ios
else
  echo "prebuild-dual: prebuild inputs changed or no complete prior run, prebuilding --clean"
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
echo "$HASH" > "$STAMP"
