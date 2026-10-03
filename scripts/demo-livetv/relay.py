#!/usr/bin/env python3
"""MPEG-TS relay for the demo channels: one ffmpeg pushes each channel over TCP, every HTTP reader joins at the live position.

  relay.py <dir>   per channel in lineup.json: feed on tcp 127.0.0.1:<port+100>, readers on http://127.0.0.1:<port>/live.ts
Test knobs (the demo leaves them unset): RELAY_HOST, RELAY_MAX_READERS with RELAY_CAP_MODE refuse|kick (a provider's
connection cap across every channel), and GET /stats for the readers counted so far.

HDHomeRun face (the rig's tuner emulation, off unless RELAY_HDHR_PORT is set): one port answering /discover.json,
/lineup.json and /auto/v<number> the way a Connect Quatro does, with each channel's lineup labels (videoCodec,
audioCodec, hd) copied verbatim, a reader joining at the live edge like a tuner, and 503 past RELAY_MAX_READERS.
RELAY_ADVERTISE is the base URL the tuner's clients reach it at. RELAY_PACE=<fraction>:<seconds> feeds each reader
at that fraction of the channel's live rate for its first seconds, then at full rate. RELAY_VIDEO_DELAY=<seconds>
withholds the channel's video PID (lineup `videoPid`) from each new reader for that long, a tuner whose picture
lags its lock: Jellyfin 12.1 then probes a video stream with no dimensions and keeps its lineup placeholders.
"""

import json
import os
import re
import socket
import sys
import threading
import time

HOST = os.environ.get("RELAY_HOST", "127.0.0.1")
PACKET = 188
# A paced reader falls behind the feed by (1 - fraction) of the rate for the whole pace window; the ring must hold that.
RING = int(os.environ.get("RELAY_RING_MB", "16")) * 1024 * 1024
JOIN_BEHIND = 16000 * PACKET
FEED_OFFSET = 100
MAX_READERS = int(os.environ.get("RELAY_MAX_READERS", "0"))
CAP_MODE = os.environ.get("RELAY_CAP_MODE", "refuse")
HDHR_PORT = int(os.environ.get("RELAY_HDHR_PORT", "0"))
ADVERTISE = os.environ.get("RELAY_ADVERTISE", f"http://{HOST}:{HDHR_PORT}").rstrip("/")
# A paced reader gets its bytes in slices this size; a full-rate one gets whatever the ring holds.
PACE_SLICE = 350 * PACKET
RATE_WINDOW = 5.0


def parse_pace(raw):
    if not raw:
        return None
    fraction, seconds = raw.split(":")
    return float(fraction), float(seconds)


PACE = parse_pace(os.environ.get("RELAY_PACE", ""))
VIDEO_DELAY = float(os.environ.get("RELAY_VIDEO_DELAY", "0"))


def without_pid(data, pid):
    """The TS packets of `data` (packet-aligned) with every packet of `pid` removed."""
    kept = bytearray()
    for at in range(0, len(data) - PACKET + 1, PACKET):
        if ((data[at + 1] & 0x1F) << 8 | data[at + 2]) != pid:
            kept += data[at : at + PACKET]
    return bytes(kept)


class Readers:
    """Every channel's readers against one cap, as a provider counts an account's connections."""

    def __init__(self):
        self.lock = threading.Lock()
        self.active = []
        # Flat ints only: the engine tests decode /stats as [String: Int]. Per-channel readers ride as "readers:<id>".
        self.stats = {"active": 0, "peak": 0, "admitted": 0, "refused": 0, "kicked": 0}

    def admit(self, conn, name):
        with self.lock:
            if MAX_READERS and len(self.active) >= MAX_READERS:
                if CAP_MODE != "kick":
                    self.stats["refused"] += 1
                    return False
                oldest, _ = self.active.pop(0)
                self.stats["kicked"] += 1
                try:
                    oldest.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            self.active.append((conn, name))
            self.stats["admitted"] += 1
            self._count()
            return True

    def leave(self, conn):
        with self.lock:
            self.active = [entry for entry in self.active if entry[0] is not conn]
            self._count()

    def _count(self):
        self.stats["active"] = len(self.active)
        self.stats["peak"] = max(self.stats["peak"], len(self.active))
        for key in [k for k in self.stats if k.startswith("readers:")]:
            self.stats[key] = 0
        for _, name in self.active:
            self.stats[f"readers:{name}"] = self.stats.get(f"readers:{name}", 0) + 1


READERS = Readers()


class Channel:
    def __init__(self, entry):
        self.name = entry["id"]
        self.port = entry["port"]
        self.number = entry.get("number")
        self.title = entry.get("name", self.name)
        self.video_codec = entry.get("videoCodec", "H264")
        self.audio_codec = entry.get("audioCodec", "AAC")
        self.hd = 1 if entry.get("hd", True) else 0
        # Read off the feed's own PMT: ffmpeg's mpegts muxer numbers PIDs afresh, so the source file's say nothing.
        self.video_pid = None
        self.pmt_pid = None
        self.scanned = 0
        self.cond = threading.Condition()
        self.buf = bytearray()
        self.base = 0
        self.generation = 0
        # (time, total bytes pushed) samples, for the live rate a paced reader is held to.
        self.pushed = 0
        self.samples = []

    VIDEO_STREAM_TYPES = {0x01, 0x02, 0x10, 0x1B, 0x24}

    def learn_video_pid(self, data):
        """PAT then PMT out of the feed's first packets, until the video elementary PID is known."""
        for at in range(0, len(data) - PACKET + 1, PACKET):
            packet = data[at : at + PACKET]
            if packet[0] != 0x47 or not packet[1] & 0x40:
                continue
            pid = (packet[1] & 0x1F) << 8 | packet[2]
            payload = 4 + (1 + packet[4] if packet[3] & 0x20 else 0)
            table = payload + 1 + packet[payload]
            if pid == 0 and self.pmt_pid is None and packet[table] == 0x00:
                length = (packet[table + 1] & 0x0F) << 8 | packet[table + 2]
                for entry in range(table + 8, table + 3 + length - 4, 4):
                    program = packet[entry] << 8 | packet[entry + 1]
                    if program != 0:
                        self.pmt_pid = (packet[entry + 2] & 0x1F) << 8 | packet[entry + 3]
                        break
            elif pid == self.pmt_pid and packet[table] == 0x02:
                length = (packet[table + 1] & 0x0F) << 8 | packet[table + 2]
                info_length = (packet[table + 10] & 0x0F) << 8 | packet[table + 11]
                entry = table + 12 + info_length
                end = table + 3 + length - 4
                while entry + 5 <= end:
                    stream_type = packet[entry]
                    es_pid = (packet[entry + 1] & 0x1F) << 8 | packet[entry + 2]
                    es_info = (packet[entry + 3] & 0x0F) << 8 | packet[entry + 4]
                    if stream_type in self.VIDEO_STREAM_TYPES:
                        self.video_pid = es_pid
                        print(f"{self.name}: video pid 0x{es_pid:x} (stream type 0x{stream_type:02x})", flush=True)
                        return
                    entry += 5 + es_info

    def push(self, data):
        with self.cond:
            self.buf += data
            if self.video_pid is None:
                # TCP chunks fall anywhere; the ring is packet-aligned from its first byte.
                aligned = len(self.buf) // PACKET * PACKET
                self.learn_video_pid(self.buf[self.scanned : aligned])
                self.scanned = aligned
            self.pushed += len(data)
            now = time.monotonic()
            self.samples.append((now, self.pushed))
            while len(self.samples) > 2 and self.samples[0][0] < now - RATE_WINDOW:
                self.samples.pop(0)
            if len(self.buf) > RING:
                cut = (len(self.buf) - RING // 2) // PACKET * PACKET
                del self.buf[:cut]
                self.base += cut
            self.cond.notify_all()

    def rate(self):
        """Bytes per second the feed delivered over the last window; 0 before two samples."""
        with self.cond:
            if len(self.samples) < 2:
                return 0.0
            (t0, b0), (t1, b1) = self.samples[0], self.samples[-1]
            return (b1 - b0) / (t1 - t0) if t1 > t0 else 0.0

    def end_of_feed(self):
        with self.cond:
            self.generation += 1
            self.buf = bytearray()
            self.base = 0
            self.samples = []
            self.video_pid = None
            self.pmt_pid = None
            self.scanned = 0
            self.cond.notify_all()

    def join_position(self, behind):
        with self.cond:
            end = self.base + len(self.buf)
            return max(self.base, end - behind) // PACKET * PACKET, self.generation

    def read(self, position, generation, limit=None):
        """Bytes after `position`, or None once the feed restarted or the reader fell off the ring.
        With `limit`, a slice of whole packets at most that long, so a filtered reader stays aligned."""
        with self.cond:
            while True:
                available = self.base + len(self.buf) - position
                if self.generation != generation or position < self.base:
                    return None
                take = min(limit, available) // PACKET * PACKET if limit else available
                if take > 0:
                    break
                self.cond.wait(1.0)
            start = position - self.base
            return bytes(self.buf[start : start + take])

    def feed(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((HOST, self.port + FEED_OFFSET))
        server.listen(1)
        while True:
            conn, _ = server.accept()
            print(f"{self.name}: feed connected", flush=True)
            try:
                while True:
                    data = conn.recv(65536)
                    if not data:
                        break
                    self.push(data)
            except OSError:
                pass
            finally:
                conn.close()
                self.end_of_feed()
                print(f"{self.name}: feed ended", flush=True)

    def stream(self, conn, behind, tuner=False):
        """Serves the ring to one admitted reader; the test knobs (pace, withheld video) shape its first seconds."""
        conn.settimeout(30)
        position, generation = self.join_position(behind)
        started = time.monotonic()
        sent = 0
        while True:
            elapsed = time.monotonic() - started
            pacing = PACE is not None and elapsed < PACE[1]
            withholding = tuner and VIDEO_DELAY > 0 and self.video_pid is not None and elapsed < VIDEO_DELAY
            data = self.read(position, generation, PACE_SLICE if pacing or withholding else None)
            if data is None:
                return
            position += len(data)
            if withholding:
                data = without_pid(data, self.video_pid)
            if pacing:
                allowed_rate = PACE[0] * self.rate()
                if allowed_rate > 0:
                    ahead = (sent + len(data)) / allowed_rate - (time.monotonic() - started)
                    if ahead > 0:
                        time.sleep(ahead)
            if data:
                conn.sendall(data)
            sent += len(data)


def read_request(conn):
    conn.settimeout(10)
    request = b""
    while b"\r\n\r\n" not in request:
        chunk = conn.recv(4096)
        if not chunk:
            return None
        request += chunk
    line = request.split(b"\r\n", 1)[0].decode("latin-1")
    parts = line.split(" ")
    return parts[1] if len(parts) >= 2 else "/"


def respond(conn, status, content_type, body):
    head = f"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nConnection: close\r\n\r\n".encode()
    conn.sendall(head + (body if isinstance(body, bytes) else body.encode()))


def stats_body():
    with READERS.lock:
        return json.dumps(READERS.stats)


def serve_reader(channel, conn, behind, refusal, tuner=False):
    admitted = False
    try:
        if not READERS.admit(conn, channel.name):
            respond(conn, *refusal)
            return
        admitted = True
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n")
        channel.stream(conn, behind, tuner)
    except OSError:
        pass
    finally:
        if admitted:
            READERS.leave(conn)
        conn.close()


def channel_reader(channel, conn):
    try:
        path = read_request(conn)
        if path is None:
            conn.close()
            return
        if path.startswith("/stats"):
            respond(conn, "200 OK", "application/json", stats_body())
            conn.close()
            return
    except OSError:
        conn.close()
        return
    serve_reader(channel, conn, JOIN_BEHIND, ("403 Forbidden", "text/plain", "max connections reached\n"))


def serve_channel(channel):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, channel.port))
    server.listen(16)
    while True:
        conn, _ = server.accept()
        threading.Thread(target=channel_reader, args=(channel, conn), daemon=True).start()


class HdHomeRunFace:
    """What Jellyfin's HdHomerunHost reads: discover.json, lineup.json, and the lineup's own stream URLs."""

    def __init__(self, channels):
        self.channels = channels
        self.by_number = {str(c.number): c for c in channels if c.number is not None}

    def discover(self):
        return {
            "FriendlyName": "Tomo rig HDHomeRun",
            "ModelNumber": "HDHR5-4DT",
            "FirmwareName": "hdhomerun5_dvbt",
            "FirmwareVersion": "20260326",
            "DeviceID": "10B0F00D",
            "DeviceAuth": "rig",
            "BaseURL": ADVERTISE,
            "LineupURL": f"{ADVERTISE}/lineup.json",
            "TunerCount": MAX_READERS or 4,
        }

    def lineup(self):
        return [
            {
                "GuideNumber": str(c.number),
                "GuideName": c.title,
                "VideoCodec": c.video_codec,
                "AudioCodec": c.audio_codec,
                "HD": c.hd,
                "URL": f"{ADVERTISE}/auto/v{c.number}",
            }
            for c in self.channels
            if c.number is not None
        ]

    def handle(self, conn):
        try:
            path = read_request(conn)
            if path is None:
                conn.close()
                return
            if path.startswith("/discover.json"):
                respond(conn, "200 OK", "application/json", json.dumps(self.discover()))
            elif path.startswith("/lineup.json"):
                respond(conn, "200 OK", "application/json", json.dumps(self.lineup()))
            elif path.startswith("/lineup_status.json"):
                respond(conn, "200 OK", "application/json", json.dumps({"ScanInProgress": 0, "ScanPossible": 1, "Source": "Antenna", "SourceList": ["Antenna"]}))
            elif path.startswith("/stats"):
                respond(conn, "200 OK", "application/json", stats_body())
            else:
                match = re.match(r"^/auto/v(\d+)", path)
                channel = self.by_number.get(match.group(1)) if match else None
                if channel is None:
                    respond(conn, "404 Not Found", "text/plain", "no such channel\n")
                else:
                    # A tuner has no history to hand out: the reader starts at the live edge.
                    serve_reader(channel, conn, 0, ("503 Service Unavailable", "text/plain", "all tuners in use\n"), tuner=True)
                    return
        except OSError:
            pass
        conn.close()

    def serve(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((HOST, HDHR_PORT))
        server.listen(16)
        while True:
            conn, _ = server.accept()
            threading.Thread(target=self.handle, args=(conn,), daemon=True).start()


def main(directory):
    with open(os.path.join(directory, "lineup.json")) as f:
        lineup = json.load(f)
    channels = [Channel(entry) for entry in lineup["channels"]]
    for channel in channels:
        threading.Thread(target=channel.feed, daemon=True).start()
        threading.Thread(target=serve_channel, args=(channel,), daemon=True).start()
        print(f"{channel.name}: readers :{channel.port}, feed :{channel.port + FEED_OFFSET}", flush=True)
    if HDHR_PORT:
        face = HdHomeRunFace(channels)
        threading.Thread(target=face.serve, daemon=True).start()
        print(f"hdhomerun: {ADVERTISE} (tuners {face.discover()['TunerCount']}, pace {PACE})", flush=True)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1])
