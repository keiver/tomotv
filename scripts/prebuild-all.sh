#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-build-lock.sh
# The shared orchestrator inserts Catalyst between iOS and tvOS.
bash scripts/prebuild-dual.sh --with-mac
