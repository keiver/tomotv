#!/usr/bin/env bash
# What the demo box holds open for live TV, from here: tuner buffers and their growth, who is watching, the disk.
#   npm run demo:livetv:audit              report; exits 2 on a leak
#   npm run demo:livetv:audit -- --restart restart jellyfin and the live TV containers, clear the buffers, verify
#   .env.demo: DEMO_SSH (user@host), DEMO_SSH_KEY (path)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
REMOTE=/opt/tomotv/livetv

ENV_FILE="$ROOT/.env.demo"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (DEMO_SSH, DEMO_SSH_KEY)"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${DEMO_SSH:?}" "${DEMO_SSH_KEY:?}"
KEY=${DEMO_SSH_KEY/#\~/$HOME}
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 "$DEMO_SSH")

MODE=report
[ "${1:-}" = "--restart" ] && MODE=restart
scp -q -i "$KEY" -o IdentitiesOnly=yes "$HERE/leakwatch.py" "$DEMO_SSH:$REMOTE/leakwatch.py"
"${SSH[@]}" "python3 $REMOTE/leakwatch.py $MODE"
