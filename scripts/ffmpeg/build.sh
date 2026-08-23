#!/usr/bin/env bash
#
# Builds the FFmpeg xcframeworks the local remux engine links against, from
# upstream sources, with our own configure line.
#
# Why this exists: we used to fetch MPVKit's prebuilt FFmpeg. MPVKit builds for
# mpv, with `--disable-decoders` behind a 60-entry allowlist and `--enable-vulkan`
# (which makes its libswscale reference shaderc and refuse to link on tvOS). Both
# choices cost us playback coverage. Owning the build is the fix.
#
# This does NOT run on `npm install`. `postinstall` downloads the release these
# artifacts are published to. Run this to cut a new release, or to reproduce one.
#
# Usage:
#   scripts/ffmpeg/build.sh              # everything, then package
#   scripts/ffmpeg/build.sh --slice tvos-arm64   # one slice, no packaging
#   scripts/ffmpeg/build.sh --clean      # start from an empty work dir
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/scripts/ffmpeg"
WORK="${FFMPEG_BUILD_DIR:-$ROOT/.ffmpeg-build}"
SRC="$WORK/src"
DIST="$WORK/dist"
OUT="$ROOT/native/ios/Frameworks"

# shellcheck source=./sources.sh
source "$HERE/sources.sh"

IOS_MIN="15.1"    # matches TomoFFmpeg.podspec s.ios.deployment_target
TVOS_MIN="16.4"   # matches s.tvos.deployment_target and app.json tvosDeploymentTarget
MACOS_MIN="12.0"  # probe slice only, never linked into the app

# The six libraries the app links. Names are load-bearing: FFmpeg's own headers
# say `#include "libavutil/avutil.h"`, and that only resolves because the
# framework is named Libavutil and the filesystem is case-insensitive. Renaming
# any of these breaks every header in the set.
FF_LIBS=(Libavcodec Libavformat Libavutil Libswresample Libswscale Libavfilter)
EXTRA_LIBS=(Libdav1d Libuavs3d Libass Mbedtls)

# expo-image -> libavif/libdav1d links a second dav1d (1.2.0) into the same
# binary. Static linking has one flat symbol namespace, so two versions of
# dav1d_* is an ODR hazard. Ours is built under this prefix instead; the pod's
# copy keeps its own names and keeps decoding AVIF.
DAV1D_PREFIX="tomo_dav1d_"

# slice | sdk | arch | min-version flag | cmake system | meson cpu_family | meson cpu
SLICES=(
  "tvos-arm64|appletvos|arm64|-mappletvos-version-min=$TVOS_MIN|tvOS|aarch64|aarch64"
  "tvos-sim-arm64|appletvsimulator|arm64|-mappletvsimulator-version-min=$TVOS_MIN|tvOS|aarch64|aarch64"
  "tvos-sim-x86_64|appletvsimulator|x86_64|-mappletvsimulator-version-min=$TVOS_MIN|tvOS|x86_64|x86_64"
  "ios-arm64|iphoneos|arm64|-miphoneos-version-min=$IOS_MIN|iOS|aarch64|aarch64"
  "ios-sim-arm64|iphonesimulator|arm64|-mios-simulator-version-min=$IOS_MIN|iOS|aarch64|aarch64"
  "ios-sim-x86_64|iphonesimulator|x86_64|-mios-simulator-version-min=$IOS_MIN|iOS|x86_64|x86_64"
  # Not shipped in the app: scripts/probe-codecs.mjs compiles against the macOS
  # slice so `npm run probe:codecs` can enumerate the registered codec set with
  # no prebuild, no simulator and no device. Same configure line, so the same
  # answer. Dropping it would cost us the only cheap way to check the build.
  "macos-arm64|macosx|arm64|-mmacosx-version-min=$MACOS_MIN|Darwin|aarch64|aarch64"
)

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m fail\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight

preflight() {
  local missing=()
  for t in cmake meson ninja nasm pkg-config git curl xcrun lipo; do
    command -v "$t" >/dev/null || missing+=("$t")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "missing host tools: ${missing[*]}
  brew install cmake meson ninja nasm pkg-config"
  fi
  xcrun --sdk appletvos --show-sdk-path >/dev/null 2>&1 || die "no tvOS SDK; install the Apple TV platform in Xcode"
  xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1 || die "no iOS SDK"
}

# ------------------------------------------------------------------ sources

fetch() { # name url sha
  # Separate statements on purpose: bash 3.2 (what macOS ships) declares every
  # name in a `local` before assigning any of them, so a later initialiser that
  # reads an earlier one sees it unset and trips `set -u`.
  local name="$1" url="$2" sha="$3"
  local file="$SRC/$(basename "$url")"
  if [ ! -f "$file" ]; then
    log "fetch $name"
    curl -fsSL -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  local got
  got="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || die "$name checksum mismatch
  expected $sha
  got      $got"
  local dir="$SRC/$name"
  if [ ! -d "$dir" ]; then
    log "unpack $name"
    mkdir -p "$dir"
    tar -xf "$file" -C "$dir" --strip-components=1
  fi
}

clone() { # name repo tag
  local name="$1" repo="$2" tag="$3"
  local dir="$SRC/$name"
  if [ ! -d "$dir" ]; then
    log "clone $name@$tag"
    # --shallow-submodules matters: mbedtls-framework otherwise clones its full
    # history and adds minutes to every cold build, CI included.
    git clone --quiet --depth 1 --branch "$tag" \
      --recurse-submodules --shallow-submodules "$repo" "$dir"
  fi
}

sources() {
  mkdir -p "$SRC"
  fetch ffmpeg   "$FFMPEG_URL"   "$FFMPEG_SHA"
  fetch dav1d    "$DAV1D_URL"    "$DAV1D_SHA"
  fetch freetype "$FREETYPE_URL" "$FREETYPE_SHA"
  fetch fribidi  "$FRIBIDI_URL"  "$FRIBIDI_SHA"
  fetch harfbuzz "$HARFBUZZ_URL" "$HARFBUZZ_SHA"
  fetch libass   "$LIBASS_URL"   "$LIBASS_SHA"
  clone mbedtls  "$MBEDTLS_REPO" "$MBEDTLS_TAG"
  clone uavs3d   "$UAVS3D_REPO"  "$UAVS3D_TAG"
}

# ------------------------------------------------------------------- slices

# Set per-slice toolchain state. Everything below reads these.
slice_env() { # slice-spec
  IFS='|' read -r SLICE SDK ARCH MINFLAG CMAKE_SYSTEM MESON_FAMILY MESON_CPU <<<"$1"
  SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"
  CC="$(xcrun -f clang)"
  CXX="$(xcrun -f clang++)"
  AR="$(xcrun -f ar)"
  RANLIB="$(xcrun -f ranlib)"
  STRIP="$(xcrun -f strip)"
  NM="$(xcrun -f nm)"
  case "$CMAKE_SYSTEM" in
    tvOS)   MESON_SUBSYSTEM="tvos";  MIN_VERSION="$TVOS_MIN" ;;
    iOS)    MESON_SUBSYSTEM="ios";   MIN_VERSION="$IOS_MIN" ;;
    Darwin) MESON_SUBSYSTEM="macos"; MIN_VERSION="$MACOS_MIN" ;;
  esac
  PREFIX="$WORK/prefix/$SLICE"
  BUILD="$WORK/build/$SLICE"
  CFLAGS_COMMON="-arch $ARCH -isysroot $SYSROOT $MINFLAG -fno-common -O2"
  LDFLAGS_COMMON="-arch $ARCH -isysroot $SYSROOT $MINFLAG"
  mkdir -p "$PREFIX" "$BUILD"
  export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
  export PKG_CONFIG_PATH=""
}

meson_cross_file() { # [tag [extra-c-arg...]]
  local tag="default"
  if [ $# -gt 0 ]; then tag="$1"; shift; fi
  local f="$BUILD/cross-$tag.ini"
  local extra=""
  local a
  for a in "$@"; do extra="$extra, '$a'"; done
  cat >"$f" <<EOF
[binaries]
c = '$CC'
cpp = '$CXX'
ar = '$AR'
strip = '$STRIP'
pkg-config = '$(command -v pkg-config)'
nasm = '$(command -v nasm)'

[built-in options]
c_args = ['-arch', '$ARCH', '-isysroot', '$SYSROOT', '$MINFLAG', '-O2', '-fno-common'$extra]
c_link_args = ['-arch', '$ARCH', '-isysroot', '$SYSROOT', '$MINFLAG']
cpp_args = ['-arch', '$ARCH', '-isysroot', '$SYSROOT', '$MINFLAG', '-O2']
cpp_link_args = ['-arch', '$ARCH', '-isysroot', '$SYSROOT', '$MINFLAG']

[host_machine]
system = 'darwin'
subsystem = '$MESON_SUBSYSTEM'
kernel = 'xnu'
cpu_family = '$MESON_FAMILY'
cpu = '$MESON_CPU'
endian = 'little'
EOF
  echo "$f"
}

meson_build() { # name -- extra args
  local name="$1"; shift
  local dir="$BUILD/$name"
  [ -f "$PREFIX/.done-$name" ] && return 0
  log "[$SLICE] $name"
  rm -rf "$dir"
  meson setup "$dir" "$SRC/$name" \
    --cross-file "$(meson_cross_file)" \
    --prefix "$PREFIX" \
    --buildtype release \
    --default-library static \
    "$@" >"$BUILD/$name.log" 2>&1 || { tail -40 "$BUILD/$name.log"; die "$name: meson setup failed ($BUILD/$name.log)"; }
  ninja -C "$dir" >>"$BUILD/$name.log" 2>&1 || { tail -40 "$BUILD/$name.log"; die "$name: build failed"; }
  ninja -C "$dir" install >>"$BUILD/$name.log" 2>&1 || die "$name: install failed"
  touch "$PREFIX/.done-$name"
}

# CMAKE_POLICY_VERSION_MINIMUM is set for every project below: CMake 4 removed
# compatibility with `cmake_minimum_required` under 3.5, and uavs3d still
# declares 3.1. Without it the configure step refuses outright.
cmake_build() { # name [--target T] -- extra args
  local name="$1"; shift
  local target=""
  if [ "${1:-}" = "--target" ]; then target="$2"; shift 2; fi
  local dir="$BUILD/$name"
  [ -f "$PREFIX/.done-$name" ] && return 0
  log "[$SLICE] $name"
  rm -rf "$dir"
  # CMAKE_SYSTEM_PROCESSOR is not derived from CMAKE_OSX_ARCHITECTURES when
  # cross-compiling, and projects that pick their assembly by CPU (uavs3d) will
  # silently compile none of it and then fail to link the init symbol.
  cmake -S "$SRC/$name" -B "$dir" -G Ninja \
    -DCMAKE_SYSTEM_NAME="$CMAKE_SYSTEM" \
    -DCMAKE_SYSTEM_PROCESSOR="$ARCH" \
    -DCMAKE_OSX_SYSROOT="$SYSROOT" \
    -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_VERSION" \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    "$@" >"$BUILD/$name.log" 2>&1 || { tail -40 "$BUILD/$name.log"; die "$name: cmake configure failed ($BUILD/$name.log)"; }
  cmake --build "$dir" ${target:+--target "$target"} >>"$BUILD/$name.log" 2>&1 || { tail -40 "$BUILD/$name.log"; die "$name: build failed"; }
  cmake --install "$dir" >>"$BUILD/$name.log" 2>&1 || die "$name: install failed"
  touch "$PREFIX/.done-$name"
}

# Only dav1d's exported symbols can collide: the project builds with
# -fvisibility=hidden and its arm/x86 kernels are .private_extern on Mach-O, so
# everything except the DAV1D_API surface is already local to the linkage unit.
# The list is read out of the archive rather than transcribed from the headers,
# so an API added upstream cannot slip through. __ASSEMBLER__ keeps the defines
# away from .S files, which name their symbols through PRIVATE_PREFIX instead.
# Definitions another translation unit could bind to. Undefined rows are dropped
# because nm -m prints them as "(undefined) external" and they are references,
# not exports; private externs are dropped because the linker makes them local,
# so two copies of one never meet.
dav1d_external_syms() { # archive
  "$NM" -m "$1" 2>/dev/null \
    | grep -v "(undefined)" \
    | grep -v "private external" \
    | awk '/ external / { print $NF }' \
    | sort -u
}

dav1d_rename_header() { # archive out
  {
    echo "#pragma once"
    echo "#ifndef __ASSEMBLER__"
    "$NM" -g "$1" 2>/dev/null \
      | awk 'NF == 3 && $2 ~ /^[TDBSR]$/ { print $3 }' \
      | sed -n 's/^_\(dav1d_.*\)$/\1/p' \
      | sort -u \
      | awk -v p="$DAV1D_PREFIX" '{ n = substr($0, 7); print "#define " $0 " " p n }'
    echo "#endif"
  } >"$2"
}

# Two passes over the same source: the first is thrown away and exists only to
# enumerate the exported names, the second is the one that installs.
build_dav1d() {
  local probe="$BUILD/dav1d-probe"
  local final="$BUILD/dav1d"
  local hdr="$BUILD/dav1d-rename.h"
  # The marker carries the prefix so changing it forces a rebuild, and the header
  # is checked too: ffmpeg -include's it, and it cannot be regenerated from the
  # installed archive because those symbols are already renamed.
  local stamp="$PREFIX/.done-dav1d-$DAV1D_PREFIX"
  [ -f "$stamp" ] && [ -f "$hdr" ] && return 0
  log "[$SLICE] dav1d (prefix $DAV1D_PREFIX)"
  local opts=(--prefix "$PREFIX" --buildtype release --default-library static
              -Denable_tools=false -Denable_tests=false)
  # Assembly names are pasted together by assembler macros from PRIVATE_PREFIX,
  # so a C #define can never reach them. arm64 sets that prefix directly. The
  # x86 slices take theirs from a meson-generated header instead, and they are
  # simulator-only, so they drop assembly rather than patch upstream.
  local prefix_args=(-include "$hdr")
  case "$ARCH" in
    x86_64) opts+=(-Denable_asm=false) ;;
    *)      prefix_args+=("-DPRIVATE_PREFIX=$DAV1D_PREFIX") ;;
  esac

  rm -rf "$probe"
  meson setup "$probe" "$SRC/dav1d" --cross-file "$(meson_cross_file default)" "${opts[@]}" \
    >"$BUILD/dav1d-probe.log" 2>&1 || { tail -40 "$BUILD/dav1d-probe.log"; die "dav1d: probe setup failed"; }
  ninja -C "$probe" >>"$BUILD/dav1d-probe.log" 2>&1 || { tail -40 "$BUILD/dav1d-probe.log"; die "dav1d: probe build failed"; }

  local plain
  plain="$(find "$probe" -name libdav1d.a | head -1)"
  [ -n "$plain" ] || die "dav1d: probe produced no archive"
  dav1d_rename_header "$plain" "$hdr"
  grep -q '^#define dav1d_open ' "$hdr" || die "dav1d: rename header missing the API ($hdr)"

  rm -rf "$final"
  meson setup "$final" "$SRC/dav1d" \
    --cross-file "$(meson_cross_file prefixed "${prefix_args[@]}")" "${opts[@]}" \
    >"$BUILD/dav1d.log" 2>&1 || { tail -40 "$BUILD/dav1d.log"; die "dav1d: setup failed"; }
  ninja -C "$final" >>"$BUILD/dav1d.log" 2>&1 || { tail -40 "$BUILD/dav1d.log"; die "dav1d: build failed"; }
  ninja -C "$final" install >>"$BUILD/dav1d.log" 2>&1 || die "dav1d: install failed"

  # Only truly external symbols can cross-wire with the pod's copy; the private
  # externs the rest of the archive is full of go local at link time. A leftover
  # here is the actual bug this build exists to prevent.
  local leaked
  leaked="$(dav1d_external_syms "$PREFIX/lib/libdav1d.a" | grep -c '^_dav1d_')" || leaked=0
  [ "$leaked" -eq 0 ] || {
    dav1d_external_syms "$PREFIX/lib/libdav1d.a" | grep '^_dav1d_' | head -10
    die "dav1d: $leaked externally visible symbols still bare dav1d_"
  }
  # A rename that reached the C references but not their asm definitions leaves
  # the prefixed name undefined, which only surfaces when the app links. Compared
  # across the whole archive, since one member referencing another member's
  # symbol is normal and resolves at link time.
  local nmout dangling
  nmout="$("$NM" "$PREFIX/lib/libdav1d.a" 2>/dev/null)"
  dangling="$(comm -23 \
    <(printf '%s\n' "$nmout" | awk '$1 == "U" { print $2 }' | sort -u) \
    <(printf '%s\n' "$nmout" | awk 'NF == 3 { print $3 }' | sort -u) \
    | grep -c "^_${DAV1D_PREFIX}")" || dangling=0
  [ "$dangling" -eq 0 ] || die "dav1d: $dangling prefixed symbols referenced but never defined"
  touch "$stamp"
}

build_deps() {
  build_dav1d

  # No interdependencies except libass, which wants the three text libraries.
  cmake_build mbedtls \
    -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF \
    -DUSE_STATIC_MBEDTLS_LIBRARY=ON -DUSE_SHARED_MBEDTLS_LIBRARY=OFF

  # --target uavs3d: the project also builds a `uavs3dec` test binary whose
  # utest.c defines no main, so the default target cannot link at all.
  # COMPILE_10BIT is off by default upstream, which would leave 10-bit AVS3
  # undecodable for the sake of a build flag.
  cmake_build uavs3d --target uavs3d -DCOMPILE_10BIT=1

  cmake_build freetype \
    -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON \
    -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_ZLIB=ON

  meson_build fribidi -Ddocs=false -Dtests=false -Dbin=false
  # freetype disabled inside harfbuzz: libass drives both itself, and letting
  # harfbuzz find freetype here creates a circular static-link ordering problem.
  meson_build harfbuzz \
    -Dtests=disabled -Ddocs=disabled -Dutilities=disabled \
    -Dcairo=disabled -Dglib=disabled -Dgobject=disabled \
    -Dicu=disabled -Dfreetype=disabled -Dchafa=disabled
  # CoreText is the font provider on Apple, which is what lets us skip
  # fontconfig and its expat dependency entirely.
  # coretext=enabled plus the default require-system-font-provider=true means
  # this build FAILS rather than quietly shipping a libass with no way to find a
  # font, which is the failure mode that would only surface as blank subtitles.
  meson_build libass \
    -Dfontconfig=disabled -Dcoretext=enabled -Ddirectwrite=disabled \
    -Dlibunibreak=disabled -Dasm=enabled \
    -Dtest=disabled -Dcompare=disabled -Dprofile=disabled \
    -Dfuzz=disabled -Dcheckasm=disabled
}

# -------------------------------------------------------------------- ffmpeg

build_ffmpeg() {
  local dir="$BUILD/ffmpeg"
  [ -f "$PREFIX/.done-ffmpeg" ] && return 0
  log "[$SLICE] ffmpeg"
  rm -rf "$dir"; mkdir -p "$dir"

  local metal_sdk="$SDK"

  # NOTE: no comments inside the invocation below. It is one backslash-continued
  # command and a `#` line terminates it, which fails as a bare configure run.
  #
  # Encoders match the MPVKit build the playback matrix was validated against:
  # aac, alac, flac, pcm* plus the two VideoToolbox video encoders.
  #
  # `aac_at` is left out even though --enable-audiotoolbox offers it. Not because
  # it is known broken — AudioTranscoder picks by AVCodecID, not by name, so
  # whether avcodec_find_encoder(AV_CODEC_ID_AAC) would return it is untested.
  # It is out because adding an encoder the matrix never ran against is a change
  # to audio output smuggled into a build swap. Enable it in its own change, with
  # `npm run probe:codecs` and the matrix to back it up.
  ( cd "$dir" && "$SRC/ffmpeg/configure" \
      --prefix="$PREFIX" \
      --enable-cross-compile --target-os=darwin --arch="$ARCH" \
      --sysroot="$SYSROOT" \
      --cc="$CC" --cxx="$CXX" --ar="$AR" --ranlib="$RANLIB" --strip="$STRIP" --nm="$NM" \
      --extra-cflags="$CFLAGS_COMMON -I$PREFIX/include -include $BUILD/dav1d-rename.h" \
      --extra-ldflags="$LDFLAGS_COMMON -L$PREFIX/lib" \
      --pkg-config-flags="--static" \
      --metalcc="xcrun -sdk $metal_sdk metal" \
      --metallib="xcrun -sdk $metal_sdk metallib" \
      --enable-static --disable-shared --enable-pic \
      --disable-debug --enable-optimizations --disable-autodetect \
      --enable-version3 \
      --disable-programs --disable-doc \
      --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages \
      --disable-avdevice --disable-devices \
      --enable-swscale --enable-avfilter \
      --enable-videotoolbox --enable-audiotoolbox --enable-metal \
      --enable-mbedtls --enable-libdav1d --enable-libuavs3d --enable-libass \
      --disable-encoders \
      --enable-encoder="h264_videotoolbox,hevc_videotoolbox,aac,alac,flac,pcm*" \
      --disable-muxers --enable-muxer=mp4 \
      --disable-protocols \
      --enable-protocol=http,https,tls,tcp,file \
      --disable-bsfs --enable-bsf=pgs_frame_merge \
      --disable-filters \
      --enable-filter=yadif_videotoolbox,bwdif,yadif,scale_vt,transpose_vt,scale,format,null,copy,ass,subtitles,aresample,anull,aformat,loudnorm,dynaudnorm,compand \
      >"$BUILD/ffmpeg-configure.log" 2>&1 ) || {
        tail -60 "$BUILD/ffmpeg-configure.log"
        warn "config.log tail:"; tail -40 "$dir/ffbuild/config.log" 2>/dev/null || true
        die "ffmpeg: configure failed ($BUILD/ffmpeg-configure.log)"
      }

  make -C "$dir" -j"$(sysctl -n hw.ncpu)" >"$BUILD/ffmpeg.log" 2>&1 || { tail -40 "$BUILD/ffmpeg.log"; die "ffmpeg: build failed"; }
  make -C "$dir" install >>"$BUILD/ffmpeg.log" 2>&1 || die "ffmpeg: install failed"
  touch "$PREFIX/.done-ffmpeg"
}

# ----------------------------------------------------------------- packaging

# Headers must land FLAT in the framework, and the framework must be named
# Libavcodec/Libavutil/... exactly. FFmpeg's public headers include each other as
# `#include "libavutil/avutil.h"`; with flat headers that resolves only as a
# FRAMEWORK include, matched case-insensitively against Libavutil.framework.
# That is how MPVKit's frameworks work and why the naming cannot change.
make_framework() { # module-name static-lib-path header-src-dir dest-dir platform
  local module="$1" lib="$2" headers="$3" dest="$4" platform="$5"
  local fw="$dest/$module.framework"
  rm -rf "$fw"; mkdir -p "$fw/Headers" "$fw/Modules"
  cp "$lib" "$fw/$module"
  [ -d "$headers" ] && cp "$headers"/*.h "$fw/Headers/" 2>/dev/null || true

  # Headers for hardware backends we do not build. Left in the tree by
  # `make install`, and `umbrella "."` would try to compile every one of them.
  local excludes=()
  case "$module" in
    Libavcodec) excludes=(xvmc.h vdpau.h qsv.h dxva2.h d3d11va.h d3d12va.h mediacodec.h jni.h) ;;
    Libavutil)  excludes=(hwcontext_vulkan.h hwcontext_vdpau.h hwcontext_vaapi.h hwcontext_qsv.h
                          hwcontext_opencl.h hwcontext_dxva2.h hwcontext_d3d11va.h hwcontext_d3d12va.h
                          hwcontext_cuda.h hwcontext_amf.h hwcontext_mediacodec.h hwcontext_drm.h) ;;
  esac

  { echo "framework module $module [system] {"
    echo "    umbrella \".\""
    for h in "${excludes[@]:-}"; do
      [ -n "$h" ] && echo "    exclude header \"$h\""
    done
    echo "    export *"
    echo "}"
  } >"$fw/Modules/module.modulemap"

  /usr/libexec/PlistBuddy -c "Clear dict" \
    -c "Add :CFBundleDevelopmentRegion string en" \
    -c "Add :CFBundleExecutable string $module" \
    -c "Add :CFBundleIdentifier string dev.keiver.tomotv.$module" \
    -c "Add :CFBundleInfoDictionaryVersion string 6.0" \
    -c "Add :CFBundleName string $module" \
    -c "Add :CFBundlePackageType string FMWK" \
    -c "Add :CFBundleSupportedPlatforms array" \
    -c "Add :CFBundleSupportedPlatforms:0 string $platform" \
    -c "Add :MinimumOSVersion string ${6}" \
    "$fw/Info.plist" >/dev/null
}

# The four xcframework slices, and which built slices feed each.
# tvos-arm64 and ios-arm64 are single; the two simulator slices are lipo'd pairs.
package() {
  log "packaging xcframeworks"
  rm -rf "$DIST"; mkdir -p "$DIST/staging"

  local groups=(
    "tvos-arm64:tvos-arm64:AppleTVOS:$TVOS_MIN"
    "tvos-arm64_x86_64-simulator:tvos-sim-arm64 tvos-sim-x86_64:AppleTVSimulator:$TVOS_MIN"
    "ios-arm64:ios-arm64:iPhoneOS:$IOS_MIN"
    "ios-arm64_x86_64-simulator:ios-sim-arm64 ios-sim-x86_64:iPhoneSimulator:$IOS_MIN"
    "macos-arm64:macos-arm64:MacOSX:$MACOS_MIN"
  )

  for spec in "${FF_LIBS[@]}" "${EXTRA_LIBS[@]}"; do
    local args=()
    for g in "${groups[@]}"; do
      IFS=':' read -r gname gslices platform minver <<<"$g"
      local dest="$DIST/staging/$spec/$gname"
      mkdir -p "$dest"
      local libs=() headers=""
      for s in $gslices; do
        local p="$WORK/prefix/$s"
        local a; a="$(archive_for "$spec" "$p")" || die "$spec: no archive in $p"
        libs+=("$a")
        headers="$(headers_for "$spec" "$p")"
      done
      local fat="$dest/$spec.a"
      if [ ${#libs[@]} -gt 1 ]; then lipo -create "${libs[@]}" -output "$fat"; else cp "${libs[0]}" "$fat"; fi
      make_framework "$spec" "$fat" "$headers" "$dest" "$platform" "$minver"
      rm -f "$fat"
      args+=(-framework "$dest/$spec.framework")
    done
    rm -rf "$DIST/$spec.xcframework"
    xcodebuild -create-xcframework "${args[@]}" -output "$DIST/$spec.xcframework" >/dev/null
    ( cd "$DIST" && zip -qry "$spec.xcframework.zip" "$spec.xcframework" )
  done

  ( cd "$DIST" && shasum -a 256 ./*.xcframework.zip >checksums.txt )
  log "artifacts in $DIST"
  ( cd "$DIST" && du -sh ./*.xcframework )
}

archive_for() { # module prefix
  case "$1" in
    # libass.a on its own leaves freetype, fribidi and harfbuzz undefined —
    # measured: 23 FT_, 7 fribidi_, 44 hb_ symbols. They are libass's private
    # dependencies and nothing else in the set touches them, so they belong
    # inside this framework rather than as three more podspec entries.
    Libass)
          local parts=()
          local p
          for p in libass libfreetype libfribidi libharfbuzz; do
            [ -f "$2/lib/$p.a" ] || return 1
            parts+=("$2/lib/$p.a")
          done
          local merged="$2/lib/libass-merged.a"
          [ -f "$merged" ] || libtool -static -o "$merged" "${parts[@]}" 2>/dev/null
          echo "$merged" ;;
    # Libavcodec -> libavcodec.a, Libass -> libass.a.
    Lib*) local base; base="$(echo "${1#Lib}" | tr '[:upper:]' '[:lower:]')"
          [ -f "$2/lib/lib$base.a" ] && { echo "$2/lib/lib$base.a"; return 0; }
          return 1 ;;
    # mbedTLS ships five archives, not three: libmbedcrypto leaves Everest x25519
    # and the p256-m curve implementation undefined. Merge the lot into one
    # framework binary so the podspec has a single entry and no link ordering.
    Mbedtls)
          local parts=()
          local p
          for p in libmbedtls libmbedx509 libmbedcrypto libeverest libp256m; do
            [ -f "$2/lib/$p.a" ] && parts+=("$2/lib/$p.a")
          done
          [ ${#parts[@]} -ge 3 ] || return 1
          local merged="$2/lib/libmbedtls-merged.a"
          [ -f "$merged" ] || libtool -static -o "$merged" "${parts[@]}" 2>/dev/null
          echo "$merged" ;;
    *) return 1 ;;
  esac
}

headers_for() { # module prefix
  case "$1" in
    Libavcodec)    echo "$2/include/libavcodec" ;;
    Libavformat)   echo "$2/include/libavformat" ;;
    Libavutil)     echo "$2/include/libavutil" ;;
    Libswresample) echo "$2/include/libswresample" ;;
    Libswscale)    echo "$2/include/libswscale" ;;
    Libavfilter)   echo "$2/include/libavfilter" ;;
    Libass)        echo "$2/include/ass" ;;
    Libdav1d)      echo "$2/include/dav1d" ;;
    Libuavs3d)     echo "$2/include" ;;
    Mbedtls)       echo "$2/include/mbedtls" ;;
  esac
}

# ---------------------------------------------------------------------- main

ONLY_SLICE=""
DO_PACKAGE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) rm -rf "$WORK/prefix" "$WORK/build"; shift ;;
    # Rebuild FFmpeg only, keeping the seven dependency trees. A configure-line
    # change costs ~2 min a slice this way instead of a 24 min full rebuild.
    --refresh-ffmpeg) find "$WORK/prefix" -name ".done-ffmpeg" -delete 2>/dev/null; shift ;;
    --slice) ONLY_SLICE="$2"; DO_PACKAGE=0; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

preflight
sources

started=$SECONDS
for spec in "${SLICES[@]}"; do
  slice_env "$spec"
  [ -n "$ONLY_SLICE" ] && [ "$SLICE" != "$ONLY_SLICE" ] && continue
  build_deps
  build_ffmpeg
done

[ "$DO_PACKAGE" = 1 ] && package

log "done in $(( (SECONDS - started) / 60 ))m $(( (SECONDS - started) % 60 ))s"
