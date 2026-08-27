#!/usr/bin/env bash
#
# check-cocoapods.sh -- postinstall: make sure `pod` runs, installing it with
# Homebrew when missing. The formula ships its own Ruby, so the macOS system
# Ruby (2.6, too old for current CocoaPods) stays out of it.

set -uo pipefail

[[ "$(uname)" == "Darwin" ]] || exit 0

pod --version >/dev/null 2>&1 && exit 0

if ! command -v brew >/dev/null 2>&1; then
  echo "[cocoapods] 'pod' not found and Homebrew is missing." >&2
  echo "[cocoapods] Install Homebrew (https://brew.sh) or CocoaPods (https://cocoapods.org), then rerun npm install." >&2
  exit 1
fi

echo "[cocoapods] 'pod' not found, installing with Homebrew..."
brew install cocoapods || exit 1

pod --version >/dev/null 2>&1 && exit 0

brew link cocoapods >/dev/null 2>&1 || true
pod --version >/dev/null 2>&1 && exit 0

echo "[cocoapods] Installed at $(brew --prefix)/bin/pod but it is not on PATH. Add $(brew --prefix)/bin to PATH and rerun npm install." >&2
exit 1
