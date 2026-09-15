#!/usr/bin/env python3
"""Synthetic XMLTV guide plus channel logos and programme posters for the Live TV rig.

  make-guide.py --tuner test/playback/live --art test/playback/live/hls [--days 3] [--base http://127.0.0.1:9109]

Writes <tuner>/guide.xml and PNGs under <art>/logos and <art>/posters (ImageMagick `magick`).
Icons point at <base>, the HLS web server the Jellyfin container reaches on its own loopback.
"""

import argparse
import datetime as dt
import os
import random
import subprocess
from xml.sax.saxutils import escape

FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

# Channel ids match the tvg-id attributes in live.m3u.
CHANNELS = [
    ("t24", "T24 MPEG2 MP2 TS", "T24", "#1B5E9E"),
    ("t07", "T07 H264 AC3 TS", "T07", "#8E2A2A"),
    ("t09", "T09 multi-audio TS", "T09", "#2E7D4F"),
    ("spliceraw", "SPLICE RAW discontinuity TS", "SPLICE", "#6A3FA0"),
    ("hlst07", "HLS T07 origin", "HLS", "#B36B00"),
]

# Title, category, poster colour. Categories match the listing provider's mapping lists.
PROGRAMS = [
    ("Evening News", "News", "#233D5C"),
    ("Morning Report", "News", "#2F4F6E"),
    ("Football Live", "Sports", "#1F6B3A"),
    ("Kids Cartoons", "Kids", "#C2551F"),
    ("Classic Film", "Movie", "#4A2B5C"),
    ("Late Movie", "Movie", "#301F3F"),
    ("Talk Show", "Talk", "#6E3B2F"),
    ("Cooking Hour", "Lifestyle", "#8A5A1E"),
    ("Ocean Documentary", "Documentary", "#1D5C6E"),
    ("Nature Walk", "Documentary", "#3D6B2C"),
    ("Science Weekly", "Documentary", "#3B4C7A"),
    ("Quiz Night", "Game", "#7A2E5C"),
]

DURATIONS = [30, 30, 60, 60, 90]


def slug(title):
    return title.lower().replace(" ", "-")


def render(path, size, colour, lines, pointsize):
    if os.path.exists(path):
        return
    text = "\\n".join(lines)
    subprocess.run(
        ["magick", "-size", size, f"xc:{colour}", "-font", FONT, "-pointsize", str(pointsize), "-fill", "white", "-gravity", "center", "-annotate", "+0+0", text, path],
        check=True,
    )


def make_art(art):
    os.makedirs(os.path.join(art, "logos"), exist_ok=True)
    os.makedirs(os.path.join(art, "posters"), exist_ok=True)
    for cid, _name, short, colour in CHANNELS:
        render(os.path.join(art, "logos", f"{cid}.png"), "512x288", colour, [short], 110)
    for title, _category, colour in PROGRAMS:
        render(os.path.join(art, "posters", f"{slug(title)}.png"), "600x900", colour, title.split(" "), 88)


def stamp(t):
    return t.strftime("%Y%m%d%H%M%S +0000")


def make_guide(tuner, base, days):
    rng = random.Random(7)
    start = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - dt.timedelta(days=1)
    end = start + dt.timedelta(days=days + 1)
    out = ['<?xml version="1.0" encoding="UTF-8"?>', "<tv>"]
    for cid, name, _short, _colour in CHANNELS:
        out.append(f'  <channel id="{cid}"><display-name>{escape(name)}</display-name><icon src="{base}/logos/{cid}.png"/></channel>')
    episodes = {}
    for cid, _name, _short, _colour in CHANNELS:
        t = start
        while t < end:
            title, category, _colour = rng.choice(PROGRAMS)
            stop = t + dt.timedelta(minutes=rng.choice(DURATIONS))
            episodes[title] = episodes.get(title, 0) + 1
            n = episodes[title]
            out.append(
                f'  <programme start="{stamp(t)}" stop="{stamp(stop)}" channel="{cid}">'
                f"<title>{escape(title)}</title><sub-title>Episode {n}</sub-title>"
                f"<desc>{escape(title)}, episode {n} on {cid}.</desc><category>{category}</category>"
                f'<icon src="{base}/posters/{slug(title)}.png"/>'
                f'<episode-num system="onscreen">S1E{n}</episode-num></programme>'
            )
            t = stop
    out.append("</tv>")
    with open(os.path.join(tuner, "guide.xml"), "w") as f:
        f.write("\n".join(out) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tuner", required=True)
    parser.add_argument("--art", required=True)
    parser.add_argument("--base", default="http://127.0.0.1:9109")
    parser.add_argument("--days", type=int, default=3)
    args = parser.parse_args()
    make_art(args.art)
    make_guide(args.tuner, args.base, args.days)


if __name__ == "__main__":
    main()
