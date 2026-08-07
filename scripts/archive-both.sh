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
