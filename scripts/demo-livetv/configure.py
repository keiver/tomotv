#!/usr/bin/env python3
"""Jellyfin side of the demo Live TV, run on the box: items.json for guide titles and posters, the M3U tuner and
XMLTV listing (added once), GuideDays, a guide refresh, then what is on air. Auth is the admin's newest session
token read from a copy of jellyfin.db (the box has no API keys); it stays in memory.

  sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && configure.py /opt/tomotv/livetv /tmp/jf.db <jellyfin ip>
"""

import json
import os
import sqlite3
import sys
import time
import urllib.request

GUIDE = "http://127.0.0.1:9109"
KEEP = ("Id", "Name", "Type", "Path", "SeriesName", "Overview", "ProductionYear", "ParentIndexNumber", "IndexNumber")


def main(directory, db, ip):
    c = sqlite3.connect(db)
    admin = c.execute("select Id from Users where Username = ?", ("admin",)).fetchone()[0]
    token = c.execute("select AccessToken from Devices where UserId = ? order by DateLastActivity desc limit 1", (admin,)).fetchone()[0]
    c.close()
    os.remove(db)
    base = f"http://{ip}:8096"

    def jf(path, method="GET", body=None):
        req = urllib.request.Request(
            base + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "MediaBrowser Token=" + token, "Content-Type": "application/json", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw.strip() else None

    me = jf("/Users/Me")
    if not me["Policy"]["IsAdministrator"]:
        sys.exit("session is not an administrator")

    items = [
        {k: i[k] for k in KEEP if k in i}
        for i in jf("/Items?Recursive=true&IncludeItemTypes=Movie,Episode,MusicVideo,Video&Fields=Path,Overview,ProductionYear&Limit=5000")["Items"]
        if i.get("Path")
    ]
    with open(os.path.join(directory, "items.json.part"), "w") as f:
        json.dump(items, f)
    os.replace(os.path.join(directory, "items.json.part"), os.path.join(directory, "items.json"))
    with open(os.path.join(directory, "lineup.json")) as f:
        lineup = json.load(f)
    paths = {i["Path"] for i in items}
    missing = [s for ch in lineup["channels"] for s in ch["sources"] if "/media/" + s not in paths]
    if missing:
        sys.exit("lineup sources with no Jellyfin item:\n  " + "\n  ".join(missing))
    print(f"items.json: {len(items)} items, every lineup source resolved")

    cfg = jf("/System/Configuration/livetv")
    if any(t.get("Url") == GUIDE + "/live.m3u" for t in cfg["TunerHosts"]):
        print("tuner present")
    else:
        jf("/LiveTv/TunerHosts", "POST", {"Type": "m3u", "Url": GUIDE + "/live.m3u", "FriendlyName": "Tomo TV demo", "AllowStreamSharing": True})
        print("tuner added")
    if any(p.get("Path") == GUIDE + "/guide.xml" for p in cfg["ListingProviders"]):
        print("listing present")
    else:
        jf("/LiveTv/ListingProviders", "POST", {"Type": "xmltv", "Path": GUIDE + "/guide.xml", "EnableAllTuners": True})
        print("listing added")
    cfg = jf("/System/Configuration/livetv")
    cfg["GuideDays"] = 7
    jf("/System/Configuration/livetv", "POST", cfg)

    # Jellyfin keeps a channel image it holds even when the tvg-logo URL changes; the refresh fetches it again.
    for ch in jf("/LiveTv/Channels?Limit=50")["Items"]:
        if ch.get("ImageTags", {}).get("Primary"):
            jf(f"/Items/{ch['Id']}/Images/Primary", "DELETE")
    task = next(t["Id"] for t in jf("/ScheduledTasks") if t["Key"] == "RefreshGuide")
    jf("/ScheduledTasks/Running/" + task, "POST")
    print("guide refresh started")
    wanted = len(lineup["channels"])
    for _ in range(36):
        time.sleep(5)
        channels = jf("/LiveTv/Channels?Limit=50")["TotalRecordCount"]
        airing = jf("/LiveTv/Programs?IsAiring=true&Limit=50")["Items"]
        print(f"channels {channels}, airing {len(airing)}", flush=True)
        if len(airing) >= wanted:
            break
    names = {ch["Id"]: ch["Name"] for ch in jf("/LiveTv/Channels?Limit=50")["Items"]}
    for p in sorted(airing, key=lambda p: names.get(p["ChannelId"], "")):
        print(f"  {names.get(p['ChannelId'], '?'):16} {p['Name']}  {p['StartDate'][11:16]}-{p['EndDate'][11:16]}Z  image={'yes' if p.get('ImageTags') else 'no'}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:])
