#!/usr/bin/env bash
#
# archive-both.sh -- build App Store artifacts for iOS and tvOS in one run.
#
# Usage:
#   npm run archive -- <buildNumber>            # archive + export + validate, no upload
#   npm run archive -- <buildNumber> --upload   # same, then upload both to App Store Connect
#
# Per platform: expo prebuild -> xcodebuild archive (lands in Xcode Organizer)
# -> export signed .ipa -> local verification -> App Store validation
# -> optional upload. iOS runs first; tvOS runs last so the working tree is
# left in tvOS state for normal development.
#
# Validation and upload authenticate with an App Store Connect API key,
# configured in a gitignored .env.archive at the repo root:
#
#   ASC_KEY_ID=XXXXXXXXXX
#   ASC_ISSUER_ID=<uuid from ASC > Users and Access > Integrations>
#   API_PRIVATE_KEYS_DIR=/absolute/path/to/dir/containing/AuthKey_XXXXXXXXXX.p8
#
# Without credentials the script still produces signed, locally verified
# .ipas and skips ASC validation with a notice. --upload requires them.

set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- args / env

BUILD_NUMBER="${1:-}"
UPLOAD=0
[[ "${2:-}" == "--upload" ]] && UPLOAD=1

if [[ ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Usage: npm run archive -- <buildNumber> [--upload]" >&2
  echo "Build number must be a positive integer (check the last one in App Store Connect)." >&2
  exit 1
fi

# ------------------------------------------------------------- toolchain guard
# 2.2.0 build 2 was rejected with ITMS-90111 after being archived on a macOS 27
# beta. Xcode 26.6 and the iOS 26.5 SDK were identical to the approved 2.1.0
# build; only BuildMachineOSBuild moved, and App Store processing reads it.
#
#   1. Pin DEVELOPER_DIR. Bare xcodebuild/xcrun follow `xcode-select`, which can
#      be aimed at an Xcode beta without anyone noticing.
#   2. Refuse to build on a seed OS or seed Xcode. Apple numbers pre-release
#      builds from 5000 up: 26A5421a and 27A5252f are seeds, 25G83 and 17F113
#      are not. A trailing letter proves nothing on its own, 23F81a ships.

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

if [[ ! -d "$DEVELOPER_DIR" ]]; then
  echo "DEVELOPER_DIR does not exist: $DEVELOPER_DIR" >&2
  echo "Point it at a release Xcode, or install one." >&2
  exit 1
fi

is_seed_build() { # 26A5421a -> yes, 25G83 -> no
  [[ "${1:-}" =~ ^[0-9]+[A-Z]([0-9]+)[a-z]?$ ]] || return 1
  (( 10#${BASH_REMATCH[1]} >= 5000 ))
}

MACOS_BUILD=$(sw_vers -buildVersion)
XCODE_BUILD=$(xcodebuild -version 2>/dev/null | awk '/^Build version/{print $3}')
XCODE_VER=$(xcodebuild -version 2>/dev/null | awk '/^Xcode/{print $2}')

echo "toolchain"
echo "  DEVELOPER_DIR: $DEVELOPER_DIR"
echo "  Xcode:         ${XCODE_VER:-unknown} (${XCODE_BUILD:-unknown})"
echo "  macOS:         $(sw_vers -productVersion) ($MACOS_BUILD)"

SEED=""
if is_seed_build "$MACOS_BUILD"; then SEED="${SEED}  macOS $MACOS_BUILD"$'\n'; fi
if is_seed_build "${XCODE_BUILD:-}"; then SEED="${SEED}  Xcode $XCODE_BUILD"$'\n'; fi

if [[ -n "$SEED" && "${ALLOW_SEED_TOOLCHAIN:-0}" != "1" ]]; then
  {
    echo ""
    echo "REFUSING TO BUILD: pre-release toolchain detected."
    printf '%s' "$SEED"
    echo ""
    echo "App Store processing rejects these with ITMS-90111. It reads"
    echo "BuildMachineOSBuild, so a release Xcode on a beta macOS is still"
    echo "rejected. That is exactly how 2.2.0 build 2 died."
    echo "Archive from a machine running a release macOS."
    echo ""
    echo "ALLOW_SEED_TOOLCHAIN=1 overrides, for TestFlight-only experiments."
  } >&2
  exit 1
fi
if [[ -n "$SEED" ]]; then
  echo "  WARNING: seed toolchain allowed by ALLOW_SEED_TOOLCHAIN=1; App Store will reject." >&2
fi

if [[ -f .env.archive ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.archive
  set +a
fi

ASC_KEY_ID="${ASC_KEY_ID:-}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-}"
HAVE_CREDS=0
[[ -n "$ASC_KEY_ID" && -n "$ASC_ISSUER_ID" ]] && HAVE_CREDS=1

if [[ $UPLOAD -eq 1 && $HAVE_CREDS -eq 0 ]]; then
  echo "--upload requires ASC_KEY_ID and ASC_ISSUER_ID (see .env.archive template in the script header)." >&2
  exit 1
fi

VERSION=$(node -p "require('./app.json').expo.version")
TS=$(date +%Y%m%d-%H%M%S)
ORGANIZER_DIR="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)"
EXPORT_ROOT="build/release/$TS"
LOG_DIR="$EXPORT_ROOT/logs"
mkdir -p "$ORGANIZER_DIR" "$LOG_DIR"

echo "TomoTV release build"
echo "  version:      $VERSION ($BUILD_NUMBER)"
echo "  mode:         $([[ $UPLOAD -eq 1 ]] && echo 'archive + validate + UPLOAD' || echo 'archive + validate (no upload)')"
echo "  asc auth:     $([[ $HAVE_CREDS -eq 1 ]] && echo "key $ASC_KEY_ID" || echo 'none (ASC validation will be skipped)')"
echo "  archives:     $ORGANIZER_DIR"
echo "  ipas + logs:  $EXPORT_ROOT"
echo ""

# The BINARY is what has to carry a correct third-party notice, whatever happens to
# be committed. Regenerated rather than verified, so a release cannot ship a stale
# one; if it changes anything, that diff is worth committing afterwards.
node scripts/generate-licenses.mjs

# ---------------------------------------------------------------- helpers

run_logged() {
  local log="$LOG_DIR/$1"
  shift
  echo "  -> $* "
  if ! "$@" >>"$log" 2>&1; then
    echo "" >&2
    echo "FAILED: $*" >&2
    echo "Last 40 log lines:" >&2
    tail -40 "$log" >&2
    echo "Full log: $log" >&2
    exit 1
  fi
}

# verify_ipa <ipa> <expected DTPlatformName>
verify_ipa() {
  local ipa="$1" expected_platform="$2"
  local tmp app plist sdk build
  tmp=$(mktemp -d)
  unzip -q "$ipa" -d "$tmp"
  app=$(find "$tmp/Payload" -maxdepth 1 -name "*.app" | head -1)
  codesign --verify --deep --strict "$app"
  plist="$app/Info.plist"
  sdk=$(/usr/libexec/PlistBuddy -c "Print :DTPlatformName" "$plist")
  build=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$plist")
  rm -rf "$tmp"
  if [[ "$sdk" != "$expected_platform" ]]; then
    echo "FAILED: $ipa built for '$sdk', expected '$expected_platform'" >&2
    exit 1
  fi
  if [[ "$build" != "$BUILD_NUMBER" ]]; then
    echo "FAILED: $ipa is build $build, expected $BUILD_NUMBER" >&2
    exit 1
  fi
}

RESULTS=()

# build_platform <label> <xcodebuild destination> <altool type> <DTPlatformName> <EXPO_TV value>
build_platform() {
  local label="$1" dest="$2" alt_type="$3" dt_platform="$4" expo_tv="$5"
  local archive="$ORGANIZER_DIR/TomoTV-$label-$TS.xcarchive"
  local export_dir="$EXPORT_ROOT/$label"
  local validated="skipped (no ASC credentials)" uploaded="-"

  echo "[$label]"
  run_logged "$label-prebuild.log" env CI=1 EXPO_TV="$expo_tv" npx expo prebuild --clean -p ios
  run_logged "$label-archive.log" xcodebuild archive \
    -workspace ios/TomoTV.xcworkspace -scheme TomoTV -configuration Release \
    -destination "$dest" -archivePath "$archive" -allowProvisioningUpdates
  run_logged "$label-export.log" xcodebuild -exportArchive -archivePath "$archive" \
    -exportOptionsPlist scripts/exportOptions.plist -exportPath "$export_dir" \
    -allowProvisioningUpdates

  local ipa
  ipa=$(ls "$export_dir"/*.ipa | head -1)
  echo "  -> verifying signature, platform, build number"
  verify_ipa "$ipa" "$dt_platform"

  if [[ $HAVE_CREDS -eq 1 ]]; then
    run_logged "$label-validate.log" xcrun altool --validate-app -f "$ipa" -t "$alt_type" \
      --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID"
    validated="passed"
    if [[ $UPLOAD -eq 1 ]]; then
      run_logged "$label-upload.log" xcrun altool --upload-app -f "$ipa" -t "$alt_type" \
        --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID"
      uploaded="uploaded"
    fi
  fi

  RESULTS+=("$label | $archive | $ipa | validation: $validated | upload: $uploaded")
  echo ""
}

# ---------------------------------------------------------------- pipeline

echo "[1/4] Stamping build number $BUILD_NUMBER into app.json"
node -e 'const fs=require("fs");const n=process.argv[1];const s=fs.readFileSync("app.json","utf8");const out=s.replace(/("buildNumber":\s*")[^"]*(")/,"$1"+n+"$2");if(!out.includes(`"buildNumber": "${n}"`))throw new Error("buildNumber not stamped in app.json");fs.writeFileSync("app.json",out);' "$BUILD_NUMBER"

echo "[2/4] Clean install"
rm -rf .expo .metro-cache node_modules package-lock.json
run_logged "npm-install.log" npm i
echo ""

echo "[3/4] iOS"
build_platform iOS "generic/platform=iOS" ios iphoneos 0

echo "[4/4] tvOS"
build_platform tvOS "generic/platform=tvOS" appletvos appletvos 1

# ---------------------------------------------------------------- summary

echo "Done. TomoTV $VERSION ($BUILD_NUMBER)"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo ""
echo "Archives are in Xcode Organizer. Working tree is in tvOS state."
echo "Remember to commit the app.json build number bump."
