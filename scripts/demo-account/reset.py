#!/usr/bin/env python3
"""Nightly reset of the demo user, run on the box by cron: every played or resumable item set back to unplayed with
no position, every favorite removed, Live TV channel favorites removed, the demo user's devices idle for over a
week deleted (each fresh install leaves one), then the favorites and part-played items of seed.json put back, so
Home opens with its Favorites and Continue rows filled. Only the demo user's own state is touched: every call
carries its user id, and a device is deleted only when its last user is the demo user. Auth as setup.py.

  sudo cp /opt/tomotv/jellyfin/config/data/jellyfin.db /tmp/jf.db && reset.py <directory with seed.json> /tmp/jf.db <jellyfin ip>

capture prints the demo user's favorites and part-played items as they are, in seed.json's shape, to make a state
curated on a device the one the reset puts back:

  reset.py capture /tmp/jf.db <jellyfin ip> > seed.json
"""

import json
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

DEMO_USER = "demo"
IDLE_DEVICE_DAYS = 7
ITEM_TYPES = "Movie,Episode,Video,MusicVideo,Audio,MusicAlbum,Book,Photo,TvChannel,Program"
CLEARED = {"Played": False, "PlaybackPositionTicks": 0, "PlayCount": 0, "IsFavorite": False, "LastPlayedDate": None}
# A text book's position is a fraction of this many ticks, the encoding the app and the web client write.
BOOK_FRACTION_TICKS = 10_000_000
SEED_TYPES = "Movie,Episode,Audio,Book"


def seed_items(jf, uid):
    """Every item the seed may name, by library name then title."""
    views = {v["Name"]: v["Id"] for v in jf(f"/UserViews?userId={uid}")["Items"]}
    by_library = {}
    for name, view_id in views.items():
        items = jf(f"/Items?userId={uid}&ParentId={view_id}&Recursive=true&IncludeItemTypes={SEED_TYPES}&Limit=5000")["Items"]
        by_library[name] = {i["Name"]: i for i in items}
    return by_library


def seed(jf, uid, directory):
    """Favorites and part-played items from seed.json; a title the libraries do not hold is reported, not fatal."""
    with open(os.path.join(directory, "seed.json")) as f:
        wanted = json.load(f)
    items = seed_items(jf, uid)
    missing = []

    def find(entry):
        item = items.get(entry["library"], {}).get(entry["title"])
        if item is None:
            missing.append(f"{entry['library']}/{entry['title']}")
        return item

    favorites = 0
    for entry in wanted["favorites"]:
        item = find(entry)
        if item is not None:
            jf(f"/UserFavoriteItems/{item['Id']}?userId={uid}", "POST")
            favorites += 1
    progress = 0
    now = datetime.now(timezone.utc)
    for index, entry in enumerate(wanted["progress"]):
        item = find(entry)
        if item is None:
            continue
        length = BOOK_FRACTION_TICKS if item["Type"] == "Book" else item.get("RunTimeTicks") or 0
        # Most recent first in the Continue row, in the seed's order.
        played_at = (now - timedelta(minutes=index)).strftime("%Y-%m-%dT%H:%M:%S.0000000Z")
        jf(f"/UserItems/{item['Id']}/UserData?userId={uid}", "POST", {"PlaybackPositionTicks": int(length * entry["at"]), "Played": False, "PlayCount": 1, "LastPlayedDate": played_at})
        progress += 1
    return favorites, progress, missing


def capture(jf, uid):
    """Favorites by library and title, part-played items most recently played first with the fraction played."""
    items = seed_items(jf, uid)
    library_of = {item["Id"]: name for name, titles in items.items() for item in titles.values()}

    def entry(item):
        return {"library": library_of.get(item["Id"], ""), "title": item["Name"]}

    favorites = [entry(i) for i in jf(f"/Items?userId={uid}&Recursive=true&Filters=IsFavorite&IncludeItemTypes={SEED_TYPES}&Limit=5000")["Items"]]
    favorites.sort(key=lambda e: (e["library"], e["title"]))
    progress = []
    for item in jf(f"/Items?userId={uid}&Recursive=true&Filters=IsResumable&IncludeItemTypes={SEED_TYPES}&Fields=UserData,RunTimeTicks&SortBy=DatePlayed&SortOrder=Descending&Limit=5000")["Items"]:
        length = BOOK_FRACTION_TICKS if item["Type"] == "Book" else item.get("RunTimeTicks") or 0
        if length:
            progress.append({**entry(item), "at": round(item["UserData"]["PlaybackPositionTicks"] / length, 2)})
    return {"favorites": favorites, "progress": progress}


def seed_text(state):
    """seed.json's layout: one entry per line."""
    rows = {key: ",\n".join("    { " + json.dumps(e, ensure_ascii=False)[1:-1] + " }" for e in entries) for key, entries in state.items()}
    return "{\n" + ",\n".join(f'  "{key}": [\n{rows[key]}\n  ]' for key in state) + "\n}\n"


def session(db, ip):
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

    if not jf("/Users/Me")["Policy"]["IsAdministrator"]:
        sys.exit("session is not an administrator")
    return jf


def same_id(a, b):
    return (a or "").replace("-", "").lower() == (b or "").replace("-", "").lower()


def main(directory, db, ip):
    jf = session(db, ip)
    user = next((u for u in jf("/Users") if u["Name"] == DEMO_USER), None)
    if user is None:
        sys.exit(f"no user named {DEMO_USER}")
    uid = user["Id"]
    if directory == "capture":
        sys.stdout.write(seed_text(capture(jf, uid)))
        return
    stamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())

    touched = {}
    for filters in ("IsPlayed", "IsResumable", "IsFavorite"):
        for item in jf(f"/Items?userId={uid}&Recursive=true&Filters={filters}&IncludeItemTypes={ITEM_TYPES}&Limit=5000")["Items"]:
            touched[item["Id"]] = item["Name"]
    for item in jf(f"/LiveTv/Channels?userId={uid}&IsFavorite=true&Limit=1000")["Items"]:
        touched[item["Id"]] = item["Name"]
    for item_id in touched:
        jf(f"/UserItems/{item_id}/UserData?userId={uid}", "POST", CLEARED)

    cutoff = datetime.now(timezone.utc) - timedelta(days=IDLE_DEVICE_DAYS)
    # The device list's userId filter is not relied on: only rows whose last user is the demo user are considered.
    devices = [d for d in jf(f"/Devices?userId={uid}")["Items"] if same_id(d.get("LastUserId"), uid)]
    idle = [d for d in devices if d.get("DateLastActivity") and datetime.fromisoformat(d["DateLastActivity"].replace("Z", "+00:00")) < cutoff]
    for device in idle:
        jf(f"/Devices?id={urllib.parse.quote(device['Id'])}", "DELETE")

    favorites, progress, missing = seed(jf, uid, directory)
    print(f"{stamp}: {len(touched)} items cleared, {len(idle)} of {len(devices)} devices deleted, {favorites} favorites and {progress} part-played items seeded" + "".join(f"\n  not in the libraries: {m}" for m in missing))


if __name__ == "__main__":
    import urllib.parse

    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
