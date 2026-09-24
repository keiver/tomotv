#!/bin/sh
# Durations for every channel list, one ffprobe per source: channels/<id>.list -> channels/<id>.dur (path<TAB>seconds).
#   probe.sh <dir>   (runs in the jellyfin image, /media mounted)
set -u
ROOT=${1:-/livetv}
FP=/usr/lib/jellyfin-ffmpeg/ffprobe
for list in "$ROOT"/channels/*.list; do
  out="${list%.list}.dur"
  : > "$out.part"
  while IFS= read -r path; do
    d=$("$FP" -v error -show_entries format=duration -of csv=p=0 "/media/$path") || { echo "no duration for $path"; exit 1; }
    printf '%s\t%s\n' "$path" "$d" >> "$out.part"
  done < "$list"
  mv "$out.part" "$out"
  echo "$(basename "$out"): $(wc -l < "$out") sources, $(awk -F '\t' '{ s += $2 } END { printf "%.0f", s / 60 }' "$out") min cycle"
done

# Six frames per source, spread across its length, for the guide's programme images.
FF=/usr/lib/jellyfin-ffmpeg/ffmpeg
mkdir -p "$ROOT/frames"
for dur in "$ROOT"/channels/*.dur; do
  while IFS="$(printf '\t')" read -r path seconds; do
    id=$(printf '%s' "$path" | md5sum | cut -c1-12)
    for i in 0 1 2 3 4 5; do
      out="$ROOT/frames/$id-$i.jpg"
      [ -s "$out" ] && continue
      at=$(awk -v d="$seconds" -v i="$i" 'BEGIN { printf "%.2f", d * (i + 0.5) / 6 }')
      "$FF" -nostdin -hide_banner -loglevel error -y -ss "$at" -i "/media/$path" -frames:v 1 -vf "scale=640:-2" -q:v 4 "$out" || echo "no frame $i for $path"
    done
  done < "$dur"
done
echo "frames: $(ls "$ROOT/frames" | wc -l)"
