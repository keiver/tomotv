#!/usr/bin/env python3
"""Tuner streams left open on the demo box, run on the box: Jellyfin writes every open stream to
/cache/transcodes/<id>.ts for as long as it is open, and only a client's close ends it.

  leakwatch.py report          what is open, growing, watched, and the disk
  leakwatch.py watch           cron: report to ntfy on a leak or a low disk, restart under the floor
  leakwatch.py restart         restart jellyfin and the live TV containers, clear the buffers, verify
Auth is the admin's newest session token off a copy of jellyfin.db (as configure.py). NTFY_TOPIC and
NTFY_ALWAYS come from /opt/tomotv/livetv/.env.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request

ROOT = "/opt/tomotv"
TRANSCODES = f"{ROOT}/jellyfin/cache/transcodes"
ENV = f"{ROOT}/livetv/.env"
SEEN = "/tmp/leakwatch-seen.json"
# A buffer growing this long with nobody watching its channel is a leak.
LEAK_AFTER_S = 120
LOW_GB = 5
FLOOR_GB = 3
SAMPLE_S = 10


def sh(cmd, check=False):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, check=check).stdout.strip()


def env():
    values = {}
    if os.path.exists(ENV):
        for line in open(ENV):
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                values[k] = v
    return values


def jellyfin():
    """A caller against the running server, or None while it is down."""
    ip = sh("docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin")
    if not ip:
        return None
    db = "/tmp/leakwatch-jf.db"
    sh(f"sudo cp {ROOT}/jellyfin/config/data/jellyfin.db {db} && sudo chown $(id -u) {db}")
    try:
        c = sqlite3.connect(db)
        admin = c.execute("select Id from Users where Username = ?", ("admin",)).fetchone()[0]
        token = c.execute("select AccessToken from Devices where UserId = ? order by DateLastActivity desc limit 1", (admin,)).fetchone()[0]
        c.close()
    finally:
        os.remove(db)

    def call(path):
        req = urllib.request.Request(f"http://{ip}:8096{path}", headers={"Authorization": "MediaBrowser Token=" + token})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)

    try:
        call("/System/Info")
    except Exception:
        return None
    return call


def buffers():
    """Shared-stream buffers (a bare <id>.ts, not an HLS segment) with size, age and growth over a sample."""
    def scan():
        found = {}
        for name in os.listdir(TRANSCODES) if os.path.isdir(TRANSCODES) else []:
            if not name.endswith(".ts") or len(name) != 35:
                continue
            path = f"{TRANSCODES}/{name}"
            st = os.stat(path)
            found[name] = (st.st_size, st.st_mtime)
        return found

    before = scan()
    time.sleep(SAMPLE_S)
    after = scan()
    now = time.time()
    # Linux moves ctime on every write, so a buffer's age is counted from the run that first saw it.
    seen = first_seen(set(after), now)
    rows = []
    for name, (size, mtime) in after.items():
        grew = size - before.get(name, (size, 0))[0]
        rows.append({"id": name[:8], "mb": size / 1e6, "mb_per_min": grew / 1e6 * 60 / SAMPLE_S, "growing": now - mtime < 60, "age_s": now - seen[name]})
    return sorted(rows, key=lambda r: -r["mb"])


def first_seen(names, now):
    """When each buffer was first seen, kept across runs; buffers that are gone drop out."""
    try:
        with open(SEEN) as f:
            seen = {name: t for name, t in json.load(f).items() if name in names}
    except (OSError, ValueError):
        seen = {}
    for name in names:
        seen.setdefault(name, now)
    try:
        with open(SEEN, "w") as f:
            json.dump(seen, f)
    except OSError as error:
        print(f"could not write {SEEN}: {error}")
    return seen


def watching(call):
    """Sessions with a live channel playing now."""
    if not call:
        return []
    rows = []
    for s in call("/Sessions?ActiveWithinSeconds=600"):
        item = s.get("NowPlayingItem") or {}
        if item.get("Type") in ("TvChannel", "LiveTvChannel", "TvProgram", "LiveTvProgram") or item.get("ChannelType"):
            rows.append({"user": s.get("UserName"), "device": s.get("DeviceName"), "item": item.get("Name"), "checkin": (s.get("LastPlaybackCheckIn") or "")[11:19]})
    return rows


def disk():
    usage = shutil.disk_usage("/")
    return {"free_gb": usage.free / 1e9, "used_pct": 100 * (usage.total - usage.free) / usage.total}


def report():
    call = jellyfin()
    rows = buffers()
    live = watching(call)
    d = disk()
    growing = [r for r in rows if r["growing"]]
    leaked = [r for r in growing if r["age_s"] > LEAK_AFTER_S] if len(growing) > len(live) else []
    lines = [f"disk: {d['free_gb']:.1f} GB free ({d['used_pct']:.0f}% used), jellyfin {'up' if call else 'DOWN'}"]
    lines.append(f"open tuner buffers: {len(rows)}, growing: {len(growing)}, live sessions: {len(live)}")
    for r in rows:
        lines.append(f"  {r['id']}  {r['mb']:8.1f} MB  {r['mb_per_min']:6.1f} MB/min  {'growing' if r['growing'] else 'idle   '}  {r['age_s'] / 60:5.1f} min")
    for w in live:
        lines.append(f"  watching: {w['user']} on {w['device']}: {w['item']} (check-in {w['checkin']}Z)")
    verdict = "LEAK" if leaked else "ok"
    lines.append(f"verdict: {verdict}" + (f", {len(leaked)} stream(s) growing with nobody watching" if leaked else ""))
    return "\n".join(lines), verdict, d, call is not None


def notify(title, body, priority="default", tags="tv"):
    topic = env().get("NTFY_TOPIC")
    if not topic:
        print("no NTFY_TOPIC in " + ENV)
        return
    req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=body.encode(), method="POST", headers={"Title": title, "Priority": priority, "Tags": tags})
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as error:
        print(f"ntfy failed: {error}")


def restart():
    print("restarting jellyfin", flush=True)
    sh("docker restart jellyfin")
    for _ in range(60):
        if sh("docker exec jellyfin curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8096/System/Info/Public 2>/dev/null") == "200":
            break
        time.sleep(3)
    else:
        print("jellyfin did not come up; leaving the containers alone")
        return False
    # The live TV containers sit in jellyfin's network namespace, which the restart replaced.
    names = sh("docker ps -a --format '{{.Names}}' | grep -E '^livetv-'").split()
    ordered = [n for n in names if n in ("livetv-relay", "livetv-guide")] + [n for n in names if n not in ("livetv-relay", "livetv-guide")]
    sh("docker restart " + " ".join(ordered))
    sh(f"sudo find {TRANSCODES} -mindepth 1 -delete")
    for _ in range(30):
        if sh("docker exec jellyfin curl -sf http://127.0.0.1:9109/live.m3u 2>/dev/null | grep -c EXTINF") not in ("", "0"):
            break
        time.sleep(3)
    channels = sh("docker exec jellyfin curl -sf http://127.0.0.1:9109/live.m3u 2>/dev/null | grep -c EXTINF")
    call = jellyfin()
    airing = len(call("/LiveTv/Programs?IsAiring=true&Limit=50")["Items"]) if call else 0
    print(f"tuner lists {channels} channels, jellyfin airs {airing}, disk {disk()['free_gb']:.1f} GB free")
    return True


def main(mode):
    if mode == "report":
        text, verdict, _, _ = report()
        print(text)
        sys.exit(2 if verdict == "LEAK" else 0)
    if mode == "restart":
        sys.exit(0 if restart() else 1)
    if mode == "watch":
        text, verdict, d, up = report()
        print(text)
        if d["free_gb"] < FLOOR_GB or not up:
            restart()
            why = "jellyfin was down" if not up else "%.1f GB free was under the floor" % d["free_gb"]
            notify("Demo box: Jellyfin restarted", f"{why}\n\n{text}", "high", "rotating_light")
        elif verdict == "LEAK" or d["free_gb"] < LOW_GB:
            notify("Demo box: live TV " + ("leak" if verdict == "LEAK" else "low disk"), text, "high", "warning")
        elif env().get("NTFY_ALWAYS") == "1":
            notify("Demo box: live TV ok", text, "low", "white_check_mark")
        return
    print(__doc__)
    sys.exit(2)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
