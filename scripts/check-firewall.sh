#!/usr/bin/env bash
#
# check-firewall.sh -- warn once whenever the node binary changes while the
# macOS Application Firewall is on.
#
# The firewall approves incoming connections per binary, so every nvm-installed
# node is a new, unapproved binary. When blocked, the physical device's
# http://<mac-ip>:8081/status probe times out and the app dies with
# "No script URL provided" while loopback (curl, simulators) keeps working.
#
# Detection is by node-path change, not by querying the firewall:
# `socketfilterfw --listapps` is stale on macOS 26 (an allowed binary kept
# missing from it, verified 2026-08-08). See memories/CLAUDE-lessons-learned.md.
#
# Warn-only: never blocks the start, never asks for sudo.

set -uo pipefail

SFW=/usr/libexec/ApplicationFirewall/socketfilterfw

[[ "$(uname)" == "Darwin" && -x "$SFW" ]] || exit 0

"$SFW" --getglobalstate 2>/dev/null | grep -q "State = 1" || exit 0

NODE_BIN=$(node -e 'console.log(process.execPath)' 2>/dev/null)
[[ -n "$NODE_BIN" ]] || exit 0
NODE_BIN=$(readlink -f "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")

STATE_DIR="$HOME/Library/Caches/tomotv"
STATE_FILE="$STATE_DIR/firewall-checked-node"

[[ -f "$STATE_FILE" && "$(cat "$STATE_FILE")" == "$NODE_BIN" ]] && exit 0

echo ""
echo "!! Node binary changed (or first run) with the macOS firewall ON:"
echo "!!   $NODE_BIN"
echo "!! The firewall approves incoming connections per binary, so Metro may be"
echo "!! unreachable from physical devices: the app dies at launch with"
echo "!! 'No script URL provided' while simulators keep working."
echo "!! If that happens, approve this binary and relaunch the app (no rebuild):"
echo "!!   sudo $SFW --add \"$NODE_BIN\" && sudo $SFW --unblockapp \"$NODE_BIN\""
echo "!! This notice shows once per node change."
echo ""

mkdir -p "$STATE_DIR" && printf '%s' "$NODE_BIN" > "$STATE_FILE"

exit 0
