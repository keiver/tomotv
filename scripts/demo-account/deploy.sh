#!/usr/bin/env bash
# Deploy the demo libraries to the demo Jellyfin box, end to end and idempotent: the title list built here from
# the json files beside this script, synced over, media.py places files, artwork and .nfo on the box, setup.py
# installs the Bookshelf plugin, adds the five libraries and the demo user (config backed up with Jellyfin stopped
# before the first write, Jellyfin restarted after the plugin install) and scans them, each library's image goes
# into its Jellyfin folder, the nightly reset goes into cron, and the Space artwork and library images come back
# to build/review for a look.
#   npm run demo:account
#   npm run demo:account -- capture   the demo user's favorites and part-played items as they are -> seed.json
#   .env.demo: DEMO_SSH (user@host), DEMO_SSH_KEY (path)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BUILD="$HERE/build"
REMOTE=/opt/tomotv/demo-account
MEDIA=/opt/tomotv/media

ENV_FILE="$ROOT/.env.demo"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (DEMO_SSH, DEMO_SSH_KEY)"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${DEMO_SSH:?}" "${DEMO_SSH_KEY:?}"
KEY=${DEMO_SSH_KEY/#\~/$HOME}
# The media step downloads for many minutes with nothing printed: the keepalive holds the connection open.
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 "$DEMO_SSH")
step() { printf '\n== %s\n' "$*"; }
# setup.py signs its calls with the admin's newest session token off a copy of jellyfin.db, as configure.py does.
box_setup() {
  "${SSH[@]}" "sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && sudo chown \$(id -u) /tmp/jf.db && \
    python3 $REMOTE/setup.py $1 $REMOTE /tmp/jf.db \$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin)"
}

if [ "${1:-}" = capture ]; then
  step "demo user's favorites and part-played items -> seed.json"
  "${SSH[@]}" "sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && sudo chown \$(id -u) /tmp/jf.db && \
    python3 $REMOTE/reset.py capture /tmp/jf.db \$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin)" > "$HERE/seed.json.new"
  mv "$HERE/seed.json.new" "$HERE/seed.json"
  python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(len(d["favorites"]), "favorites,", len(d["progress"]), "part-played items")' "$HERE/seed.json"
  exit 0
fi

step "title list"
rm -rf "$BUILD"
mkdir -p "$BUILD"
python3 "$HERE/titles.py" "$HERE" "$BUILD"

step "sync to $DEMO_SSH:$REMOTE"
"${SSH[@]}" "sudo mkdir -p $REMOTE && sudo chown \$(id -u):\$(id -g) $REMOTE"
rsync -az -e "ssh -i $KEY -o IdentitiesOnly=yes" "$BUILD/titles.json" "$HERE/media.py" "$HERE/setup.py" "$HERE/reset.py" "$HERE/seed.json" "$HERE/disclosure.txt" "$HERE/art" "$DEMO_SSH:$REMOTE/"

step "files, artwork and nfo on the box"
# media.py writes each photo's title and date with exiftool.
"${SSH[@]}" "command -v exiftool > /dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q libimage-exiftool-perl > /dev/null"
"${SSH[@]}" "python3 -u $REMOTE/media.py $REMOTE $MEDIA ${REDO_ART:+--redo-art}"

# Jellyfin back up after a stop, then the live TV containers, which share its network namespace and lose it on the stop.
wait_for_jellyfin() {
  for _ in $(seq 1 60); do
    if "${SSH[@]}" "docker exec jellyfin curl -sf http://127.0.0.1:8096/System/Info/Public > /dev/null 2>&1"; then break; fi
    sleep 3
  done
  "${SSH[@]}" "docker restart \$(docker ps -aq --filter name=livetv-) > /dev/null"
}

step "Jellyfin plugin and libraries"
rc=0
box_setup check || rc=$?
if [ "$rc" = 3 ]; then
  # Every write to the demo Jellyfin follows a backup of its config taken with the container stopped.
  "${SSH[@]}" "cd /opt/tomotv && docker compose stop jellyfin > /dev/null && \
    sudo tar -czf _holding/jellyfin-config-before-demo-account-\$(date -u +%Y%m%d-%H%M%S).tgz -C jellyfin config && \
    docker compose up -d 2>&1 | tail -3"
  wait_for_jellyfin
elif [ "$rc" != 0 ]; then
  exit "$rc"
fi
rc=0
box_setup apply || rc=$?
if [ "$rc" = 4 ]; then
  "${SSH[@]}" "docker restart jellyfin > /dev/null"
  wait_for_jellyfin
  box_setup apply
elif [ "$rc" != 0 ]; then
  exit "$rc"
fi

step "library images into Jellyfin's library folders"
# Jellyfin reads a library's own image from folder.* in its folder under config/root/default (the box's other
# libraries have theirs there); an older folder.* of another type goes to _holding, never deleted. After apply,
# so a renamed or new library's folder is the one the image goes into.
"${SSH[@]}" "for f in $REMOTE/library-art/*.jpg; do n=\$(basename \"\$f\" .jpg); d=\"/opt/tomotv/jellyfin/config/root/default/\$n\"; [ -d \"\$d\" ] || continue; \
  for old in \"\$d\"/folder.*; do [ -e \"\$old\" ] && [ \"\$old\" != \"\$d/folder.jpg\" ] && sudo mv \"\$old\" \"/opt/tomotv/_holding/\$n-\$(basename \"\$old\")-\$(date -u +%Y%m%d-%H%M%S)\" && echo \"\$n: \$(basename \"\$old\") moved to _holding\"; done; \
  sudo cmp -s \"\$f\" \"\$d/folder.jpg\" || { sudo cp \"\$f\" \"\$d/folder.jpg\" && echo \"\$n: folder.jpg written\"; }; done"
box_setup images

step "nightly reset (cron 04:00 UTC)"
"${SSH[@]}" "printf '0 4 * * * ubuntu sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf-reset.db && sudo chown ubuntu /tmp/jf-reset.db && /usr/bin/python3 $REMOTE/reset.py $REMOTE /tmp/jf-reset.db \$(docker inspect -f \"{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}\" jellyfin) >> $REMOTE/reset.log 2>&1\n' | sudo tee /etc/cron.d/tomotv-demo-reset > /dev/null && \
  sudo chmod 644 /etc/cron.d/tomotv-demo-reset && cat /etc/cron.d/tomotv-demo-reset"

step "artwork back to $BUILD/review"
mkdir -p "$BUILD/review"
rsync -azs -e "ssh -i $KEY -o IdentitiesOnly=yes" --include='*/' --include='*-poster.jpg' --include='*-fanart.jpg' --exclude='*' \
  "$DEMO_SSH:$MEDIA/Demo Space/" "$BUILD/review/"
rsync -azs -e "ssh -i $KEY -o IdentitiesOnly=yes" "$DEMO_SSH:$REMOTE/library-art/" "$BUILD/review/library-art/"
find "$BUILD/review" -name '*.jpg' | sort
