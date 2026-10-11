#!/usr/bin/env bash
# Shared by development, archives, and the FFmpeg builder. A missing optional
# Xcode component is installed only after terminal consent or explicit opt-in.
set -euo pipefail
# Follow the caller's selected Xcode. Release archives pin DEVELOPER_DIR before
# calling us; interactive prebuild and the library builder follow xcode-select.
INSTALL="${TOMOTV_INSTALL_XCODE_COMPONENTS:-0}"
case "${1:-}" in
  --install) INSTALL=1 ;;
  "") ;;
  *) echo "Usage: $0 [--install]" >&2; exit 1 ;;
esac
if OUTPUT=$(xcrun --sdk macosx metal --version 2>&1); then exit 0; fi
# xcrun caches failed lookups, including ones made before a component download.
if [[ "$OUTPUT" == *"missing Metal Toolchain"* ]]; then
  xcrun --kill-cache
  if OUTPUT=$(xcrun --sdk macosx metal --version 2>&1); then exit 0; fi
fi
if [[ "$OUTPUT" != *"missing Metal Toolchain"* ]]; then
  printf '%s\n' "$OUTPUT" >&2
  echo "Xcode's Metal compiler could not run. Check DEVELOPER_DIR and the Xcode installation." >&2
  exit 1
fi
echo "Xcode's Metal Toolchain is missing. TomoTV's native builds need this optional Xcode component." >&2
if [ "$INSTALL" != 1 ]; then
  if [ -t 0 ] || [ -t 1 ]; then
    printf 'Download and install the Metal Toolchain now? [y/N] ' > /dev/tty
    read -r ANSWER < /dev/tty
    case "$ANSWER" in y|Y|yes|YES) INSTALL=1 ;; esac
  fi
fi
if [ "$INSTALL" != 1 ]; then
  echo "Installation was not authorized. Run npm run setup:xcode -- --install, or set TOMOTV_INSTALL_XCODE_COMPONENTS=1 for an unattended build." >&2
  exit 1
fi
xcodebuild -downloadComponent MetalToolchain
xcrun --kill-cache
xcrun --sdk macosx metal --version
