#!/bin/bash
# One demo channel: its files in cycle order from the wall-clock position, one ffmpeg per file (stream copy,
# -re paced, timestamps continued with -output_ts_offset) on one TCP feed to the relay. Every cycle re-reads
# the clock, so the stream and the guide agree to within a keyframe. The feed reconnects once a day.
#   broadcast.sh <channel id> <port>   (runs in the jellyfin image, /livetv and /media mounted)
set -u
ID=$1
PORT=$2
ROOT=${LIVETV_ROOT:-/livetv}
FF=/usr/lib/jellyfin-ffmpeg/ffmpeg
FP=/usr/lib/jellyfin-ffmpeg/ffprobe
DUR="$ROOT/channels/$ID.dur"
FEED_LIFETIME=86400

# The last keyframe at or before $2 in $1: where a stream-copy -ss actually lands.
keyframe_before() {
  local from
  from=$(awk -v t="$2" 'BEGIN { printf "%.3f", (t > 20 ? t - 20 : 0) }')
  "$FP" -v error -select_streams v:0 -skip_frame nokey -show_entries frame=pts_time -of csv=p=0 -read_intervals "$from%$2" "$1" 2>/dev/null \
    | awk -v t="$2" '$1 + 0 <= t { k = $1 } END { printf "%.3f", k + 0 }'
}

# The cycle position from the epoch: index, seconds into that file, cycle length.
position() {
  awk -F '\t' -v now="$(date -u +%s)" -v epoch="$(cat "$ROOT/epoch.txt")" '
    { d[NR] = $2 + 0; c += d[NR] }
    END {
      off = (now - epoch) % c
      if (off < 0) off += c
      t = 0
      for (k = 1; k <= NR; k++) { if (off < t + d[k]) break; t += d[k] }
      if (k > NR) k = NR
      printf "%d %.3f %.0f", k - 1, off - t, c
    }' "$DUR"
}

while :; do
  if [ ! -s "$DUR" ]; then
    echo "$ID: waiting for $DUR"
    sleep 30
    continue
  fi
  mapfile -t PATHS < <(cut -f1 "$DUR")
  mapfile -t SECS < <(cut -f2 "$DUR")
  n=${#PATHS[@]}
  {
    acc=0
    while awk -v a="$acc" -v max="$FEED_LIFETIME" 'BEGIN { exit !(a < max) }'; do
      read -r k inpt cycle < <(position)
      kf=$(keyframe_before "/media/${PATHS[$k]}" "$inpt")
      echo "$ID: ${PATHS[$k]} from ${kf}s (clock says ${inpt}s, cycle ${cycle}s, $n items, feed at ${acc}s)" >&2
      for ((j = 0; j < n; j++)); do
        i=$(( (k + j) % n ))
        if [ "$j" -eq 0 ]; then
          seek=(-ss "$kf")
          len=$(awk -v d="${SECS[$i]}" -v s="$kf" 'BEGIN { printf "%.3f", d - s }')
        else
          seek=()
          len=${SECS[$i]}
        fi
        "$FF" -nostdin -hide_banner -loglevel warning -re "${seek[@]}" -i "/media/${PATHS[$i]}" \
          -map 0:v:0 -map 0:a:0 -c copy -f mpegts -output_ts_offset "$acc" pipe:1 || break 2
        acc=$(awk -v a="$acc" -v l="$len" 'BEGIN { printf "%.3f", a + l }')
      done
    done
  } > "/dev/tcp/127.0.0.1/$((PORT + 100))"
  echo "$ID: feed closed, reconnecting in 5s"
  sleep 5
done
