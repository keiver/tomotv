#!/usr/bin/env bash
# Deploy the demo Live TV lineup to the demo Jellyfin box, end to end and idempotent: lineup flattened and logos
# rendered here, synced over, durations probed, relay + broadcasters + guide up beside jellyfin, then configure.py
# on the box adds the M3U tuner and XMLTV listing and refreshes the guide.
#   npm run demo:livetv
#   .env.demo: DEMO_SSH (user@host), DEMO_SSH_KEY (path)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BUILD="$HERE/build"
REMOTE=/opt/tomotv/livetv

ENV_FILE="$ROOT/.env.demo"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (DEMO_SSH, DEMO_SSH_KEY)"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${DEMO_SSH:?}" "${DEMO_SSH_KEY:?}"
KEY=${DEMO_SSH_KEY/#\~/$HOME}
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 "$DEMO_SSH")
step() { printf '\n== %s\n' "$*"; }

step "flatten lineup + logos"
rm -rf "$BUILD"
mkdir -p "$BUILD/logos"
python3 "$HERE/guide.py" flatten "$HERE" "$BUILD"
python3 - "$HERE/lineup.json" "$BUILD/logos" <<'EOF'
import json, os, subprocess, sys
font = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
for c in json.load(open(sys.argv[1]))["channels"]:
    out = os.path.join(sys.argv[2], c["id"] + ".png")
    initials = "".join(w[0] for w in c["name"].split()[:2]).upper()
    subprocess.run(["magick", "-size", "512x512", "xc:none", "-fill", c["colour"], "-draw", "circle 256,256 256,16",
                    "-font", font, "-pointsize", "200" if len(initials) == 1 else "150", "-fill", "white", "-gravity", "center",
                    "-annotate", "+0+8", initials, out], check=True)
    print("logo", out)
EOF

step "sync to $DEMO_SSH:$REMOTE"
"${SSH[@]}" "sudo mkdir -p $REMOTE && sudo chown \$(id -u):\$(id -g) $REMOTE"
rsync -az --delete -e "ssh -i $KEY -o IdentitiesOnly=yes" "$BUILD/channels" "$BUILD/logos" "$DEMO_SSH:$REMOTE/"
rsync -az -e "ssh -i $KEY -o IdentitiesOnly=yes" \
  "$HERE/lineup.json" "$HERE/guide.py" "$HERE/relay.py" "$HERE/broadcast.sh" "$HERE/probe.sh" "$HERE/configure.py" \
  "$BUILD/epoch.txt" "$DEMO_SSH:$REMOTE/"
scp -q -i "$KEY" -o IdentitiesOnly=yes "$BUILD/docker-compose.override.yml" "$DEMO_SSH:/tmp/livetv-override.yml"
"${SSH[@]}" "sudo mv /tmp/livetv-override.yml /opt/tomotv/docker-compose.override.yml"

step "probe durations on the box"
"${SSH[@]}" "docker run --rm -v /opt/tomotv/media:/media:ro -v $REMOTE:/livetv --entrypoint sh jellyfin/jellyfin:latest /livetv/probe.sh /livetv"

step "compose up"
"${SSH[@]}" "cd /opt/tomotv && docker compose up -d 2>&1 | tail -12"
for _ in $(seq 1 30); do
  if "${SSH[@]}" "docker exec jellyfin curl -sf http://127.0.0.1:9109/live.m3u > /dev/null"; then break; fi
  sleep 3
done
"${SSH[@]}" "docker exec jellyfin curl -sf http://127.0.0.1:9109/live.m3u | grep -c EXTINF | sed 's/$/ channels in live.m3u/'"

step "Jellyfin tuner + listing + guide"
"${SSH[@]}" "f=/opt/tomotv/jellyfin/config/config/livetv.xml; [ -f \$f ] && sudo cp \$f /opt/tomotv/_holding/livetv-\$(date -u +%Y%m%d-%H%M%S).xml; \
  sudo rm -f /opt/tomotv/jellyfin/cache/xmltv/*.xml; \
  sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && sudo chown \$(id -u) /tmp/jf.db && \
  python3 $REMOTE/configure.py $REMOTE /tmp/jf.db \$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin) && \
  docker restart livetv-guide > /dev/null"
