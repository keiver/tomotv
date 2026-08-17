#!/usr/bin/env bash
#
# Compiles scripts/ffmpeg/linktest.c against a built slice and runs it.
#
# This is the gate the plan puts in front of every app change: nothing in the
# repo switches to the new frameworks until this links AND runs. The tvOS
# simulator slice is the meaningful one, because a macOS link proves nothing
# about the platform the app ships on.
#
#   scripts/ffmpeg/run-linktest.sh                       # macos-arm64, no https
#   scripts/ffmpeg/run-linktest.sh tvos-sim-arm64        # on the tvOS simulator
#   scripts/ffmpeg/run-linktest.sh tvos-sim-arm64 https://example.com/file.mkv
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${FFMPEG_BUILD_DIR:-$ROOT/.ffmpeg-build}"
SLICE="${1:-macos-arm64}"
URL="${2:-}"
PREFIX="$WORK/prefix/$SLICE"
OUTDIR="$WORK/linktest"

[ -d "$PREFIX/lib" ] || { echo "no build at $PREFIX — run scripts/ffmpeg/build.sh --slice $SLICE" >&2; exit 1; }

case "$SLICE" in
  tvos-sim-*) SDK=appletvsimulator; MIN="-mappletvsimulator-version-min=16.4" ;;
  tvos-*)     SDK=appletvos;        MIN="-mappletvos-version-min=16.4" ;;
  ios-sim-*)  SDK=iphonesimulator;  MIN="-mios-simulator-version-min=15.1" ;;
  ios-*)      SDK=iphoneos;         MIN="-miphoneos-version-min=15.1" ;;
  macos-*)    SDK=macosx;           MIN="-mmacosx-version-min=12.0" ;;
  *) echo "unknown slice: $SLICE" >&2; exit 1 ;;
esac
ARCH="${SLICE##*-}"
SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"

mkdir -p "$OUTDIR"
BIN="$OUTDIR/linktest-$SLICE"

# Static archives, so the link order matters and every transitive dependency has
# to be named. If this list drifts from TomoFFmpeg.podspec, the app will fail to
# link even though this passes.
xcrun --sdk "$SDK" clang -O0 \
  -arch "$ARCH" -isysroot "$SYSROOT" "$MIN" \
  -I"$PREFIX/include" \
  -o "$BIN" "$ROOT/scripts/ffmpeg/linktest.c" \
  "$PREFIX/lib/libavfilter.a" \
  "$PREFIX/lib/libavformat.a" \
  "$PREFIX/lib/libavcodec.a" \
  "$PREFIX/lib/libswscale.a" \
  "$PREFIX/lib/libswresample.a" \
  "$PREFIX/lib/libavutil.a" \
  "$PREFIX/lib/libass.a" \
  "$PREFIX/lib/libdav1d.a" \
  "$PREFIX/lib/libuavs3d.a" \
  "$PREFIX/lib/libharfbuzz.a" \
  "$PREFIX/lib/libfreetype.a" \
  "$PREFIX/lib/libfribidi.a" \
  "$PREFIX/lib/libmbedtls.a" \
  "$PREFIX/lib/libmbedx509.a" \
  "$PREFIX/lib/libmbedcrypto.a" \
  "$PREFIX/lib/libeverest.a" \
  "$PREFIX/lib/libp256m.a" \
  -lz -lbz2 -liconv -llzma -lc++ \
  -framework AudioToolbox -framework VideoToolbox -framework CoreMedia \
  -framework CoreVideo -framework CoreFoundation -framework CoreGraphics \
  -framework CoreText -framework Security -framework Metal

echo "linked: $BIN"

case "$SLICE" in
  macos-*)
    "$BIN" ${URL:+"$URL"} ;;
  tvos-sim-*|ios-sim-*)
    UDID="${SIM_UDID:-$(xcrun simctl list devices booted -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
for rt,devs in d.items():
    for x in devs:
        if x.get("state")=="Booted": print(x["udid"]); raise SystemExit
')}"
    [ -n "$UDID" ] || { echo "no booted simulator; boot one or set SIM_UDID" >&2; exit 1; }
    echo "spawning on $UDID"
    xcrun simctl spawn "$UDID" "$BIN" ${URL:+"$URL"} ;;
  *)
    echo "device slice: linked only, cannot run here" ;;
esac
