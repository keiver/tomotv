#!/usr/bin/env bash
#
# Pinned upstream sources for the FFmpeg build. Sourced by build.sh.
#
# Every tarball is checked against the sha256 recorded here before it is
# unpacked. The two entries without a tarball are cloned at a tag: mbedTLS
# because it publishes no release asset and needs its `framework` submodule,
# uavs3d because it publishes no tarball at all.
#
# Versions are deliberate, not "latest":
# - FFmpeg 8.1.2 is the release MPVKit ships, so the swap changes the build
#   configuration and nothing else.
# - mbedTLS stays on the 3.6 LTS line. FFmpeg 8.1's tls_mbedtls.c has an
#   explicit `mbedtls_version_get_number() == 0x03060000` branch; 4.x moved to
#   PSA crypto and is not what this FFmpeg was written against.

FFMPEG_VERSION="8.1.2"
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_SHA="464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"

# Built under a private symbol prefix; see build_dav1d in build.sh.
DAV1D_VERSION="1.5.4"
DAV1D_URL="https://downloads.videolan.org/pub/videolan/dav1d/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.xz"
DAV1D_SHA="686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5"

FREETYPE_VERSION="2.14.3"
FREETYPE_URL="https://downloads.sourceforge.net/project/freetype/freetype2/${FREETYPE_VERSION}/freetype-${FREETYPE_VERSION}.tar.xz"
FREETYPE_SHA="36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f"

FRIBIDI_VERSION="1.0.16"
FRIBIDI_URL="https://github.com/fribidi/fribidi/releases/download/v${FRIBIDI_VERSION}/fribidi-${FRIBIDI_VERSION}.tar.xz"
FRIBIDI_SHA="1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c"

HARFBUZZ_VERSION="14.3.1"
HARFBUZZ_URL="https://github.com/harfbuzz/harfbuzz/releases/download/${HARFBUZZ_VERSION}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz"
HARFBUZZ_SHA="9dae9538aae2ffdf70cec31f2c27bf68e2aaeeae3112688467697d5faf6194f7"

LIBASS_VERSION="0.17.5"
LIBASS_URL="https://github.com/libass/libass/releases/download/${LIBASS_VERSION}/libass-${LIBASS_VERSION}.tar.gz"
LIBASS_SHA="caab4b993dd7be6187c55623b789ed75dddefea6e65938af134637c732fe094a"

# Cloned, not downloaded.
MBEDTLS_TAG="v3.6.7"
MBEDTLS_REPO="https://github.com/Mbed-TLS/mbedtls.git"

UAVS3D_TAG="1.2"
UAVS3D_REPO="https://github.com/uavs3/uavs3d.git"
