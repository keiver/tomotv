#!/usr/bin/env python3
"""Demo Live TV lineup tooling, one source of truth: lineup.json.

  guide.py flatten <dir> <out>  channels/<id>.list, epoch.txt, docker-compose.override.yml for the box
  guide.py serve <dir>          live.m3u + guide.xml regenerated every 6h, <dir> served on :9109 (the Jellyfin loopback)
Durations come from probe.sh on the box (channels/<id>.dur), sources stream straight from /media, no re-encode.
"""

import datetime as dt
import hashlib
import http.server
import json
import math
import os
import sys
import threading
import time
from functools import partial
from xml.sax.saxutils import escape

PORT = 9109
GUIDE_HOURS_BACK = 6
GUIDE_DAYS = 8
REGEN_SECONDS = 6 * 3600


def load_lineup(directory):
    with open(os.path.join(directory, "lineup.json")) as f:
        lineup = json.load(f)
    lineup["epochSeconds"] = int(dt.datetime.fromisoformat(lineup["epoch"].replace("Z", "+00:00")).timestamp())
    return lineup


def compose_yaml(lineup):
    lines = ["services:"]
    lines += [
        "  livetv-guide:",
        "    image: python:3-alpine",
        "    container_name: livetv-guide",
        "    restart: unless-stopped",
        '    network_mode: "service:jellyfin"',
        "    depends_on: [jellyfin]",
        "    volumes: [/opt/tomotv/livetv:/livetv]",
        '    command: ["python3", "/livetv/guide.py", "serve", "/livetv"]',
        "  livetv-relay:",
        "    image: python:3-alpine",
        "    container_name: livetv-relay",
        "    restart: unless-stopped",
        '    network_mode: "service:jellyfin"',
        "    depends_on: [jellyfin]",
        "    volumes: [/opt/tomotv/livetv:/livetv:ro]",
        '    command: ["python3", "/livetv/relay.py", "/livetv"]',
    ]
    for channel in lineup["channels"]:
        lines += [
            f"  livetv-{channel['id']}:",
            "    image: jellyfin/jellyfin:latest",
            f"    container_name: livetv-{channel['id']}",
            "    restart: unless-stopped",
            '    network_mode: "service:jellyfin"',
            "    depends_on: [jellyfin, livetv-relay]",
            "    healthcheck: {disable: true}",
            "    volumes: [/opt/tomotv/livetv:/livetv:ro, /opt/tomotv/media:/media:ro]",
            f'    entrypoint: ["bash", "/livetv/broadcast.sh", "{channel["id"]}", "{channel["port"]}"]',
        ]
    return "\n".join(lines) + "\n"


def flatten(directory, out):
    lineup = load_lineup(directory)
    os.makedirs(os.path.join(out, "channels"), exist_ok=True)
    for channel in lineup["channels"]:
        with open(os.path.join(out, "channels", f"{channel['id']}.list"), "w") as f:
            f.write("".join(f"{s}\n" for s in channel["sources"]))
    with open(os.path.join(out, "epoch.txt"), "w") as f:
        f.write(f"{lineup['epochSeconds']}\n")
    with open(os.path.join(out, "docker-compose.override.yml"), "w") as f:
        f.write(compose_yaml(lineup))
    print(f"{len(lineup['channels'])} channels -> {out}")


def read_durations(directory, channel):
    """path -> seconds from probe.sh's channels/<id>.dur, or None while it is missing."""
    path = os.path.join(directory, "channels", f"{channel['id']}.dur")
    if not os.path.exists(path):
        return None
    durations = {}
    with open(path) as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 2 and parts[1]:
                durations[parts[0]] = float(parts[1])
    return durations if all(s in durations for s in channel["sources"]) else None


def read_items(directory):
    path = os.path.join(directory, "items.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return {item["Path"].removeprefix("/media/"): item for item in json.load(f)}


def stamp(seconds):
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).strftime("%Y%m%d%H%M%S +0000")


FRAMES = 6


def slug(source):
    """Matches probe.sh: md5 of the path string."""
    return hashlib.md5(source.encode()).hexdigest()[:12]


def programmes(channel, durations, epoch, start, end, pattern):
    """Guide entries on the half-hour grid: (start, stop, sources).

    `pattern` is the channel's repeating run of slot lengths in seconds, anchored on the epoch, so
    channels with different patterns line up only now and then, like a real grid. A slot names what
    plays at its midpoint; a film longer than its slot merges its consecutive slots, short content
    keeps one entry per slot listing the episodes that start inside it."""
    entries = [(source, durations[source]) for source in channel["sources"]]
    cycle = sum(d for _, d in entries)
    unit = sum(pattern)

    def playing_at(t):
        off = (t - epoch) % cycle
        acc = 0.0
        for source, duration in entries:
            if off < acc + duration:
                return source
            acc += duration
        return entries[-1][0]

    def starting_in(t0, t1):
        found = []
        c = epoch + math.floor((t0 - epoch) / cycle) * cycle
        while c < t1:
            acc = 0.0
            for source, duration in entries:
                if t0 <= c + acc < t1 and source not in found:
                    found.append(source)
                acc += duration
            c += cycle
        return found

    out = []
    t = epoch + math.floor((start - epoch) / unit) * unit
    while t < end:
        for slot in pattern:
            source = playing_at(t + slot / 2)
            long_form = durations[source] >= slot
            if long_form and out and out[-1][2] == [source] and out[-1][1] - out[-1][0] < durations[source]:
                out[-1] = (out[-1][0], t + slot, out[-1][2])
            else:
                out.append((t, t + slot, [source] if long_form else (starting_in(t, t + slot) or [source])))
            t += slot
    return [entry for entry in out if entry[1] > start]


def programme_xml(channel, start, stop, sources, items, base):
    names = [(items.get(src) or {}).get("Name") or os.path.splitext(os.path.basename(src))[0] for src in sources]
    first = items.get(sources[0]) or {}
    series = {(items.get(src) or {}).get("SeriesName") for src in sources}
    distinct = list(dict.fromkeys(names))
    if len(series) == 1 and None not in series:
        title, sub = series.pop(), (distinct[0] if len(distinct) == 1 else f"{distinct[0]} to {distinct[-1]}")
    elif len(distinct) == 1:
        title, sub = distinct[0], None
    else:
        title, sub = channel["name"], f"{distinct[0]} to {distinct[-1]}"
    kind = first.get("Type", "Video")
    category = channel.get("category") or {"Movie": "Movie", "Episode": "Series", "MusicVideo": "Music"}.get(kind, "Short")
    parts = [f'  <programme start="{stamp(start)}" stop="{stamp(stop)}" channel="{channel["id"]}">', f"<title>{escape(title)}</title>"]
    if sub:
        parts.append(f"<sub-title>{escape(sub)}</sub-title>")
    desc = first.get("Overview") if len(distinct) == 1 else " / ".join(distinct)
    if desc:
        parts.append(f"<desc>{escape(desc)}</desc>")
    parts.append(f"<category>{escape(category)}</category>")
    if kind == "Movie" and first.get("ProductionYear"):
        parts.append(f"<date>{first['ProductionYear']}</date>")
    # A frame of the first source, stepping once per half hour so neighbouring cells differ.
    frame = (int(start) // 1800 + channel["number"]) % FRAMES
    parts.append(f'<icon src="{base}/frames/{slug(sources[0])}-{frame}.jpg"/>')
    parts.append("</programme>")
    return "".join(parts)


def logo_url(directory, base, channel):
    """The logo URL changes with the file, so Jellyfin fetches a redrawn logo instead of keeping its cached one."""
    path = os.path.join(directory, "logos", f"{channel['id']}.png")
    version = hashlib.md5(open(path, "rb").read()).hexdigest()[:8] if os.path.exists(path) else "0"
    return f"{base}/logos/{channel['id']}.png?v={version}"


def write_atomic(path, text):
    with open(path + ".part", "w") as f:
        f.write(text)
    os.replace(path + ".part", path)


def generate(directory):
    lineup = load_lineup(directory)
    items = read_items(directory)
    epoch = lineup["epochSeconds"]
    base = lineup["guideBase"]
    now = time.time()
    start, end = now - GUIDE_HOURS_BACK * 3600, now + GUIDE_DAYS * 86400
    m3u = ["#EXTM3U"]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', "<tv>"]
    ready = []
    for channel in lineup["channels"]:
        durations = read_durations(directory, channel)
        if durations is None:
            print(f"{channel['id']}: no channels/{channel['id']}.dur yet, left out", flush=True)
            continue
        ready.append((channel, durations))
        logo = logo_url(directory, base, channel)
        m3u.append(f'#EXTINF:-1 tvg-id="{channel["id"]}" tvg-chno="{channel["number"]}" tvg-logo="{logo}" tvg-name="{channel["name"]}",{channel["name"]}')
        m3u.append(f"http://127.0.0.1:{channel['port']}/live.ts")
        xml.append(f'  <channel id="{channel["id"]}"><display-name>{escape(channel["name"])}</display-name><icon src="{logo}"/></channel>')
    count = 0
    for channel, durations in ready:
        pattern = [60 * m for m in channel.get("slots", lineup.get("slots", [30]))]
        for p_start, p_stop, sources in programmes(channel, durations, epoch, start, end, pattern):
            xml.append(programme_xml(channel, p_start, p_stop, sources, items, base))
            count += 1
    xml.append("</tv>")
    write_atomic(os.path.join(directory, "live.m3u"), "\n".join(m3u) + "\n")
    write_atomic(os.path.join(directory, "guide.xml"), "\n".join(xml) + "\n")
    print(f"guide: {len(ready)} channels, {count} programmes, {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M}Z", flush=True)


def serve(directory):
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"serving {directory} on :{PORT}", flush=True)
    while True:
        try:
            generate(directory)
        except Exception as error:
            print(f"guide generation failed: {error}", flush=True)
        time.sleep(REGEN_SECONDS)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "flatten":
        flatten(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 3 and sys.argv[1] == "serve":
        serve(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(2)
