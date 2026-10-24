#!/usr/bin/env python3
"""The demo box's load, egress, disk and viewers, run on the box by cron every 5 minutes.

  boxwatch.py report     one sample: CPU, memory, egress, disk and its big folders, Jellyfin plays
  boxwatch.py watch      cron: the sample, then ntfy when a condition first appears, when it rises to
                         high, every 6 h while it holds, and once at low priority when it clears

CPU busy and egress rate are measured against the previous run, kept in /var/tmp/boxwatch.json across
reboots. Egress this month sums the transmit deltas since the 1st UTC, from the first run after deploy.
A transmit counter below the last reading (a reboot) counts its new value. NTFY_TOPIC and NTFY_ALWAYS
come from /opt/tomotv/demo-account/.env; NTFY_ALWAYS=1 pushes the report at low priority on every run.

Thresholds, (default, high) priority: CPU_PCT busy over the interval, MEM_FREE_GB available, EGRESS_MBPS
over the interval (10 TB a month is 31 Mbps around the clock), EGRESS_MONTH_TB, DISK_FREE_GB on / (the
live TV watch restarts Jellyfin under 3 GB), PLAYS sessions playing now. Jellyfin unreachable is high.
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
ENV = f"{ROOT}/demo-account/.env"
STATE = "/var/tmp/boxwatch.json"
FOLDERS = [f"{ROOT}/media", f"{ROOT}/jellyfin/cache", f"{ROOT}/jellyfin/config", f"{ROOT}/_holding", "/var/lib/docker"]
REPEAT_S = 6 * 3600
CPU_PCT = (80, 95)
MEM_FREE_GB = (2, 1)
EGRESS_MBPS = (100, 400)
EGRESS_MONTH_TB = (8, 9.5)
DISK_FREE_GB = (8, 4)
PLAYS = (15, 40)
TITLES = {
    "cpu": "CPU saturated",
    "memory": "memory low",
    "egress": "egress high",
    "month": "monthly egress near the free 10 TB",
    "disk": "disk low",
    "plays": "many viewers",
    "jellyfin": "Jellyfin down",
}


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def env():
    values = {}
    if os.path.exists(ENV):
        for line in open(ENV):
            if "=" in line and not line.startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                values[k] = v
    return values


def jellyfin():
    """A caller against the running server, or None while it is down; the admin's newest session token off a db copy."""
    ip = sh("docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' jellyfin")
    if not ip:
        return None
    db = "/tmp/boxwatch-jf.db"
    sh(f"sudo cp {ROOT}/jellyfin/config/data/jellyfin.db {db} && sudo chown $(id -u) {db}")
    try:
        c = sqlite3.connect(db)
        admin = c.execute("select Id from Users where Username = ?", ("admin",)).fetchone()[0]
        token = c.execute("select AccessToken from Devices where UserId = ? order by DateLastActivity desc limit 1", (admin,)).fetchone()[0]
        c.close()
    except Exception:
        return None
    finally:
        if os.path.exists(db):
            os.remove(db)

    def call(path):
        req = urllib.request.Request(f"http://{ip}:8096{path}", headers={"Authorization": "MediaBrowser Token=" + token})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())

    try:
        call("/System/Info")
    except Exception:
        return None
    return call


def cpu_counters():
    """Busy and total jiffies since boot, off the first line of /proc/stat."""
    fields = [int(v) for v in open("/proc/stat").readline().split()[1:]]
    total = sum(fields)
    return total - fields[3] - fields[4], total


def tx_bytes():
    """Transmit bytes since boot on the default route's interface."""
    route = sh("ip -o -4 route show default")
    iface = route.split(" dev ")[1].split()[0] if " dev " in route else None
    for line in open("/proc/net/dev").readlines()[2:]:
        name, rest = line.split(":", 1)
        if name.strip() == iface:
            return iface, int(rest.split()[8])
    return iface, 0


def sessions(call):
    """Sessions playing now, the distinct client addresses among them, and how many the server is transcoding for."""
    if not call:
        return None, None, None
    playing = [s for s in call("/Sessions?ActiveWithinSeconds=600") if s.get("NowPlayingItem")]
    clients = {s.get("RemoteEndPoint") for s in playing}
    transcodes = [s for s in playing if (s.get("TranscodingInfo") or {}) and not ((s["TranscodingInfo"].get("IsVideoDirect") is not False) and (s["TranscodingInfo"].get("IsAudioDirect") is not False))]
    return len(playing), len(clients), len(transcodes)


def sample(now):
    busy, total = cpu_counters()
    iface, tx = tx_bytes()
    usage = shutil.disk_usage("/")
    available_kb = next(int(line.split()[1]) for line in open("/proc/meminfo") if line.startswith("MemAvailable:"))
    call = jellyfin()
    plays, clients, transcodes = sessions(call)
    return {
        "at": now,
        "cpu_busy": busy,
        "cpu_total": total,
        "load": open("/proc/loadavg").read().split()[:3],
        "mem_available_gb": available_kb * 1024 / 1e9,
        "iface": iface,
        "tx_bytes": tx,
        "disk_free_gb": usage.free / 1e9,
        "disk_used_pct": 100 * (usage.total - usage.free) / usage.total,
        "jellyfin_up": call is not None,
        "plays": plays,
        "clients": clients,
        "transcodes": transcodes,
    }


def folders():
    """The big folders on the one disk, largest first."""
    out = sh("sudo du -sb " + " ".join(FOLDERS))
    rows = [(int(size), path) for size, path in (line.split("\t") for line in out.splitlines() if "\t" in line)]
    return sorted(rows, reverse=True)


def measure(s, state):
    """Rates against the previous run: CPU busy %, egress Mbps, and the egress bytes this month so far."""
    month = time.strftime("%Y-%m", time.gmtime(s["at"]))
    month_bytes = state.get("month_bytes", 0) if state.get("month") == month else 0
    cpu_pct = egress_mbps = None
    prev = state.get("last")
    if prev and s["at"] > prev["at"]:
        if s["cpu_total"] > prev["cpu_total"]:
            cpu_pct = 100 * (s["cpu_busy"] - prev["cpu_busy"]) / (s["cpu_total"] - prev["cpu_total"])
        delta = s["tx_bytes"] - prev["tx_bytes"]
        if delta < 0:
            delta = s["tx_bytes"]
        egress_mbps = delta * 8 / (s["at"] - prev["at"]) / 1e6
        month_bytes += delta
    return {"cpu_pct": cpu_pct, "egress_mbps": egress_mbps, "month": month, "month_bytes": month_bytes}


def level(value, thresholds, over):
    """None, "default" or "high" for a value against (default, high) thresholds, crossed upward or downward."""
    if value is None:
        return None
    lo, hi = thresholds
    if over:
        return "high" if value >= hi else "default" if value >= lo else None
    return "high" if value < hi else "default" if value < lo else None


def conditions(s, m):
    return {
        "cpu": level(m["cpu_pct"], CPU_PCT, True),
        "memory": level(s["mem_available_gb"], MEM_FREE_GB, False),
        "egress": level(m["egress_mbps"], EGRESS_MBPS, True),
        "month": level(m["month_bytes"] / 1e12, EGRESS_MONTH_TB, True),
        "disk": level(s["disk_free_gb"], DISK_FREE_GB, False),
        "plays": level(s["plays"], PLAYS, True),
        "jellyfin": None if s["jellyfin_up"] else "high",
    }


def evaluate(s, state, now):
    """The conditions to push this run (name, level), the ones that cleared, the next state, the measures and every level."""
    m = measure(s, state)
    levels = conditions(s, m)
    alerted = dict(state.get("alerted", {}))
    alerts, recovered = [], []
    for name, lvl in levels.items():
        was = alerted.get(name)
        if lvl is None:
            if was:
                recovered.append(name)
                del alerted[name]
            continue
        if was is None or (lvl == "high" and was["level"] != "high") or now - was["at"] >= REPEAT_S:
            alerts.append((name, lvl))
            alerted[name] = {"level": lvl, "at": now}
    next_state = {
        "last": {"at": s["at"], "cpu_busy": s["cpu_busy"], "cpu_total": s["cpu_total"], "tx_bytes": s["tx_bytes"]},
        "month": m["month"],
        "month_bytes": m["month_bytes"],
        "month_started": state.get("month_started") or m["month"],
        "alerted": alerted,
    }
    return alerts, recovered, next_state, m, levels


def report_text(s, m, levels, started, big=None):
    pct = lambda v: "n/a (first run)" if v is None else f"{v:.0f}%"
    rate = "n/a (first run)" if m["egress_mbps"] is None else f"{m['egress_mbps']:.1f} Mbps"
    lines = [
        f"cpu {pct(m['cpu_pct'])} busy (load {' '.join(s['load'])}), memory {s['mem_available_gb']:.1f} GB available",
        f"egress {rate} on {s['iface']}, {m['month_bytes'] / 1e12:.2f} TB this month (counted since {started})",
        f"disk {s['disk_free_gb']:.1f} GB free ({s['disk_used_pct']:.0f}% used)",
        f"jellyfin up: {s['plays']} playing, {s['clients']} clients, {s['transcodes']} server transcodes" if s["jellyfin_up"] else "jellyfin down",
    ]
    for size, path in big or []:
        lines.append(f"  {size / 1e9:5.1f} GB  {path}")
    active = [f"{TITLES[name]} ({lvl})" for name, lvl in levels.items() if lvl]
    lines.append("conditions: " + (", ".join(active) if active else "none"))
    return "\n".join(lines)


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        with open(STATE, "w") as f:
            json.dump(state, f)
    except OSError as error:
        print(f"could not write {STATE}: {error}")


def notify(title, body, priority="default", tags="desktop_computer"):
    topic = env().get("NTFY_TOPIC")
    if not topic:
        print("no NTFY_TOPIC in " + ENV)
        return
    req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=body.encode(), method="POST", headers={"Title": title, "Priority": priority, "Tags": tags})
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as error:
        print(f"ntfy failed: {error}")


def main(mode):
    if mode not in ("report", "watch"):
        print(__doc__)
        sys.exit(2)
    now = time.time()
    state = load_state()
    s = sample(now)
    alerts, recovered, next_state, m, levels = evaluate(s, state, now)
    save_state(next_state)
    disk_matters = levels["disk"] is not None
    text = report_text(s, m, levels, next_state["month_started"], folders() if mode == "report" or disk_matters else None)
    if mode == "report":
        print(text)
        return
    stamp = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(now))
    if alerts:
        priority = "high" if any(lvl == "high" for _, lvl in alerts) else "default"
        print(f"{stamp} alert: " + ", ".join(f"{name} {lvl}" for name, lvl in alerts))
        print(text)
        notify("Demo box: " + ", ".join(TITLES[name] for name, _ in alerts), text, priority, "rotating_light" if priority == "high" else "warning")
    if recovered:
        print(f"{stamp} recovered: " + ", ".join(recovered))
        notify("Demo box: recovered, " + ", ".join(TITLES[name] for name in recovered), text, "low", "white_check_mark")
    if not alerts and not recovered and env().get("NTFY_ALWAYS") == "1":
        print(f"{stamp} ok")
        notify("Demo box: ok", text, "low", "white_check_mark")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
