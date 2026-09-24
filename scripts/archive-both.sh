#!/usr/bin/env bash
#
# archive-both.sh -- build App Store artifacts for iOS and tvOS in one run.
#
# Usage:
#   npm run archive -- <buildNumber>            # archive + export + validate, no upload
#   npm run archive -- <buildNumber> --upload   # same, then upload both to App Store Connect
#                                               # (--upload also composes and uploads the
#                                               #  screenshots and the listing text, every
#                                               #  store language)
#   npm run archive -- <buildNumber> --upload --notes
#                                               # and translate missing release notes first
#   --nuke-node-modules                         # any mode: wipe node_modules and `npm ci`
#                                               # (default `npm i` keeps the tested tree;
#                                               #  the lockfile is never deleted)
#
# Per platform: expo prebuild -> xcodebuild archive (lands in Xcode Organizer)
# -> export signed .ipa -> local verification -> App Store validation, or with
# --upload a single upload (Apple validates it) confirmed by its delivery id.
# iOS runs first; tvOS runs last so the working tree is
# left in tvOS state for normal development.
#
# Validation and upload authenticate with an App Store Connect API key,
# configured in a gitignored .env.archive at the repo root:
#
#   ASC_KEY_ID=XXXXXXXXXX
#   ASC_ISSUER_ID=<uuid from ASC > Users and Access > Integrations>
#   API_PRIVATE_KEYS_DIR=/absolute/path/to/dir/containing/AuthKey_XXXXXXXXXX.p8
#   NTFY_TOPIC=<optional ntfy.sh topic, pinged when a run fails>
#
# Without credentials the script still produces signed, locally verified
# .ipas and skips ASC validation with a notice. --upload requires them.
#
# Signing: the export signs manually with the local "Apple Distribution"
# identity plus a named App Store profile, per platform (exportOptions-ios.plist,
# exportOptions-tvos.plist). Nothing in the export path needs an Xcode Apple ID
# session. Before 2026-08-27 there was no distribution certificate on this
# machine at all and Xcode signed through Apple's cloud signing service, which
# silently made every release depend on a keychain session token that no machine
# migration can carry. The certificate and its private key now live in the login
# keychain, backed up at ~/nogit/tomotv-signing/.

set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- args / env

BUILD_NUMBER="${1:-}"
UPLOAD=0
NOTES=0
NUKE_NODE_MODULES=0
for arg in "${@:2}"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    --notes) NOTES=1 ;;
    --nuke-node-modules) NUKE_NODE_MODULES=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [[ ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Usage: npm run archive -- <buildNumber> [--upload [--notes]] [--nuke-node-modules]" >&2
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
API_PRIVATE_KEYS_DIR="${API_PRIVATE_KEYS_DIR:-}"
HAVE_CREDS=0
[[ -n "$ASC_KEY_ID" && -n "$ASC_ISSUER_ID" ]] && HAVE_CREDS=1

# Any failed exit pings NTFY_TOPIC (ntfy.sh), when .env.archive sets one.
FAILED_STEP=""
FAILED_LOG=""
notify_failure() {
  local rc=$?
  [[ $rc -eq 0 || -z "${NTFY_TOPIC:-}" ]] && return
  curl -s --max-time 10 -H "Title: TomoTV archive failed" -H "Priority: high" -H "Tags: rotating_light" \
    -d "${VERSION:-?} (${BUILD_NUMBER}): ${FAILED_STEP:-exit $rc}${FAILED_LOG:+
Log: $FAILED_LOG}" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || true
}
trap notify_failure EXIT

# Sign archive+export with the App Store Connect API key, not the Xcode account.
# The account's session token (Xcode-Token, in the data-protection keychain) has
# proven unreliable since the 2026-08 clean install: it loaded for one export and
# was gone for the next, failing with "No Accounts / No signing certificate". The
# API key is a file on disk, so -allowProvisioningUpdates no longer needs a
# signed-in Apple ID at all. Empty when no key configured -> unchanged behaviour.
XCODE_API_AUTH=()
if [[ -n "$ASC_KEY_ID" && -n "$ASC_ISSUER_ID" && -f "$API_PRIVATE_KEYS_DIR/AuthKey_${ASC_KEY_ID}.p8" ]]; then
  XCODE_API_AUTH=(
    -authenticationKeyPath "$API_PRIVATE_KEYS_DIR/AuthKey_${ASC_KEY_ID}.p8"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
fi

# The export signs manually against this identity. Without it xcodebuild falls
# back to cloud signing, which needs a live Xcode Apple ID session -- the exact
# dependency this pipeline removed. Fail here with a fix, not 40 lines of
# "No signing certificate iOS Distribution found" after a 20-minute build.
if ! security find-identity -v -p codesigning | grep -q "Apple Distribution: "; then
  {
    echo ""
    echo "No \"Apple Distribution\" identity in the keychain."
    echo "The export cannot sign without it. Restore or recreate it:"
    echo "  security import ~/nogit/tomotv-signing/dist.p12 -k ~/Library/Keychains/login.keychain-db \\"
    echo "    -P <passphrase from that folder's README.txt> -T /usr/bin/codesign"
    echo "If the certificate expired, create a new one and rebuild its profiles."
    echo ""
  } >&2
  exit 1
fi

if [[ $NOTES -eq 1 && $UPLOAD -eq 0 ]]; then
  echo "--notes only runs with --upload." >&2
  exit 1
fi

if [[ $UPLOAD -eq 1 && $HAVE_CREDS -eq 0 ]]; then
  echo "--upload requires ASC_KEY_ID and ASC_ISSUER_ID (see .env.archive template in the script header)." >&2
  exit 1
fi

# The listing text is checked before the build, not after the uploads it would follow.
# --notes translates the other languages later, so only the English has to exist yet.
if [[ $UPLOAD -eq 1 ]]; then
  if [[ $NOTES -eq 1 ]]; then
    node scripts/appstore-upload-meta.mjs --check --locale en-US
  else
    node scripts/appstore-upload-meta.mjs --check
  fi
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
    FAILED_STEP="$*"
    FAILED_LOG="$log"
    echo "" >&2
    echo "FAILED: $*" >&2
    echo "Last 40 log lines:" >&2
    tail -40 "$log" >&2
    echo "Full log: $log" >&2
    exit 1
  fi
}

# altool drops Apple's connection on flaky networks; a fresh session usually gets through.
run_retried() {
  local log="$LOG_DIR/$1" attempt
  for attempt in 1 2; do
    echo "  -> [attempt $attempt/3] ${*:2}"
    echo "=== attempt $attempt/3 ===" >>"$log"
    "${@:2}" >>"$log" 2>&1 && return 0
    echo "     failed, retrying in 60s" >&2
    sleep 60
  done
  echo "=== attempt 3/3 ===" >>"$log"
  run_logged "$@"
}

# altool has been reported exiting 0 on a rejected upload, so App Store Connect has the last word.
delivered() {
  local json
  json=$(xcrun altool --build-status --delivery-id "$1" --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID" \
    --output-format json) || { printf '%s\n' "$json"; return 1; }
  printf '%s\n' "$json"
  [[ $(plutil -extract is-on-app-store-connect raw -o - - <<<"$json" 2>/dev/null) == true ]]
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

# build_platform <label> <xcodebuild destination> <altool type> <DTPlatformName> <EXPO_TV value> <exportOptions plist>
build_platform() {
  local label="$1" dest="$2" alt_type="$3" dt_platform="$4" expo_tv="$5" export_plist="$6"
  local archive="$ORGANIZER_DIR/TomoTV-$label-$TS.xcarchive"
  local export_dir="$EXPORT_ROOT/$label"
  local validated="skipped (no ASC credentials)" uploaded="-"

  echo "[$label]"
  run_logged "$label-prebuild.log" env CI=1 EXPO_TV="$expo_tv" npx expo prebuild --clean -p ios
  run_logged "$label-archive.log" xcodebuild archive \
    -workspace ios/TomoTV.xcworkspace -scheme TomoTV -configuration Release \
    -destination "$dest" -archivePath "$archive" \
    ${XCODE_API_AUTH[@]+"${XCODE_API_AUTH[@]}"} -allowProvisioningUpdates
  # Export copies with openrsync, which runs `rsync` from PATH as its server; a
  # Homebrew rsync there rejects openrsync's flags and the IPA step dies with "Copy failed".
  #
  # No credentials and no -allowProvisioningUpdates here on purpose: the export
  # plists sign manually against the local "Apple Distribution" identity with a
  # named profile, so this step is fully offline. See exportOptions-ios.plist.
  run_logged "$label-export.log" env PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    xcodebuild -exportArchive -archivePath "$archive" \
    -exportOptionsPlist "$export_plist" -exportPath "$export_dir"

  local ipa
  ipa=$(ls "$export_dir"/*.ipa | head -1)
  echo "  -> verifying signature, platform, build number"
  verify_ipa "$ipa" "$dt_platform"

  # The upload runs Apple's validation itself, so validating first would send the .ipa twice.
  if [[ $HAVE_CREDS -eq 1 && $UPLOAD -eq 1 ]]; then
    run_retried "$label-upload.log" xcrun altool --upload-app -f "$ipa" -t "$alt_type" \
      --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID"
    local delivery
    delivery=$(grep -oE 'Delivery UUID: [0-9a-f-]{36}' "$LOG_DIR/$label-upload.log" | tail -1 | cut -d' ' -f3 || true)
    [[ -n "$delivery" ]] || run_logged "$label-upload.log" false "no Delivery UUID in the upload output"
    run_retried "$label-delivery.log" delivered "$delivery"
    validated="passed (on upload)"
    uploaded="uploaded"
  elif [[ $HAVE_CREDS -eq 1 ]]; then
    run_retried "$label-validate.log" xcrun altool --validate-app -f "$ipa" -t "$alt_type" \
      --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID"
    validated="passed"
  fi

  RESULTS+=("$label | $archive | $ipa | validation: $validated | upload: $uploaded")
  echo ""
}

# ---------------------------------------------------------------- pipeline

echo "[1/4] Stamping build number $BUILD_NUMBER into app.json"
node -e 'const fs=require("fs");const n=process.argv[1];const s=fs.readFileSync("app.json","utf8");const out=s.replace(/("buildNumber":\s*")[^"]*(")/,"$1"+n+"$2");if(!out.includes(`"buildNumber": "${n}"`))throw new Error("buildNumber not stamped in app.json");fs.writeFileSync("app.json",out);' "$BUILD_NUMBER"

# Never deletes package-lock.json: without it npm resolves the newest version in
# every range and ships dependencies nobody tested.
if [[ $NUKE_NODE_MODULES -eq 1 ]]; then
  echo "[2/4] Reinstall node_modules from scratch (npm ci)"
  rm -rf .expo node_modules
  run_logged "npm-install.log" npm ci
else
  echo "[2/4] Install (npm i, lockfile versions)"
  run_logged "npm-install.log" npm i
fi
echo ""

echo "[3/4] iOS"
build_platform iOS "generic/platform=iOS" ios iphoneos 0 scripts/exportOptions-ios.plist

echo "[4/4] tvOS"
build_platform tvOS "generic/platform=tvOS" appletvos appletvos 1 scripts/exportOptions-tvos.plist

# ---------------------------------------------------------------- summary

# ------------------------------------------------------- store screenshots
#
# --upload carries the listing, not just the binary: `npm run shots` composes
# every language from the screenshots staged for it, then they go up. Composed
# here rather than trusted, because generated/ is gitignored and what sits on
# this disk may predate the .ipa that just went up.
#
# Deliberately the plain run, never --capture: driving the simulators is
# unreliable on some screens, so the captures are taken by hand and this step
# only composes and uploads them.
if [[ $UPLOAD -eq 1 ]]; then
  echo "[5/6] Screenshots"
  npm run shots || { echo "Screenshot composition failed; the build is uploaded, the shots are not." >&2; exit 1; }
  # --create-version: the binary for this version just went up, so opening its
  # draft to hang the shots on is intended, not the silent open the flag guards.
  npm run shots:upload -- --create-version || { echo "Screenshot upload failed; the build is uploaded, the shots are not." >&2; exit 1; }
  RESULTS+=("screenshots | composed and uploaded, every store language")

  # Opt-in via --notes, never fatal: it needs ollama, and the blocks already in the
  # document go up either way.
  if [[ $NOTES -eq 1 ]]; then
    echo "      Release notes in the other languages"
    if npm run notes -- --write; then
      RESULTS+=("release notes | translated, the metadata document is up to date")
    else
      echo "Translation skipped; the document keeps the notes it already has. See the output above." >&2
      RESULTS+=("release notes | SKIPPED, the metadata document keeps the blocks it had")
    fi
  fi

  # A language with screenshots and no description cannot be submitted, so the
  # text goes up in the same run as the pictures.
  echo "[6/6] Listing text"
  npm run meta:upload || { echo "Listing text upload failed; the build and shots are uploaded, the text is not." >&2; exit 1; }
  RESULTS+=("listing text | uploaded, every store language, both platforms")
fi

echo "Done. TomoTV $VERSION ($BUILD_NUMBER)"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo ""
echo "Archives are in Xcode Organizer. Working tree is in tvOS state."
echo "Remember to commit the app.json build number bump."
