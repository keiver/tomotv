#!/usr/bin/env python3
"""MPEG-TS relay for the demo channels: one ffmpeg pushes each channel over TCP, every HTTP reader joins at the live position.

  relay.py <dir>   per channel in lineup.json: feed on tcp 127.0.0.1:<port+100>, readers on http://127.0.0.1:<port>/live.ts
Test knobs (the demo leaves them unset): RELAY_HOST, RELAY_MAX_READERS with RELAY_CAP_MODE refuse|kick (a provider's
connection cap across every channel), and GET /stats for the readers counted so far.
"""

import json
import os
import socket
import sys
import threading
import time

HOST = os.environ.get("RELAY_HOST", "127.0.0.1")
PACKET = 188
RING = 16 * 1024 * 1024
JOIN_BEHIND = 16000 * PACKET
FEED_OFFSET = 100
MAX_READERS = int(os.environ.get("RELAY_MAX_READERS", "0"))
CAP_MODE = os.environ.get("RELAY_CAP_MODE", "refuse")


class Readers:
    """Every channel's readers against one cap, as a provider counts an account's connections."""

    def __init__(self):
        self.lock = threading.Lock()
        self.active = []
        self.stats = {"active": 0, "peak": 0, "admitted": 0, "refused": 0, "kicked": 0}

    def admit(self, conn):
        with self.lock:
            if MAX_READERS and len(self.active) >= MAX_READERS:
                if CAP_MODE != "kick":
                    self.stats["refused"] += 1
                    return False
                oldest = self.active.pop(0)
                self.stats["kicked"] += 1
                try:
                    oldest.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            self.active.append(conn)
            self.stats["admitted"] += 1
            self.stats["active"] = len(self.active)
            self.stats["peak"] = max(self.stats["peak"], len(self.active))
            return True

    def leave(self, conn):
        with self.lock:
            if conn in self.active:
                self.active.remove(conn)
            self.stats["active"] = len(self.active)


READERS = Readers()


class Channel:
    def __init__(self, name, port):
        self.name = name
        self.port = port
        self.cond = threading.Condition()
        self.buf = bytearray()
        self.base = 0
        self.generation = 0

    def push(self, data):
        with self.cond:
            self.buf += data
            if len(self.buf) > RING:
                cut = (len(self.buf) - RING // 2) // PACKET * PACKET
                del self.buf[:cut]
                self.base += cut
            self.cond.notify_all()

    def end_of_feed(self):
        with self.cond:
            self.generation += 1
            self.buf = bytearray()
            self.base = 0
            self.cond.notify_all()

    def join_position(self):
        with self.cond:
            end = self.base + len(self.buf)
            return max(self.base, end - JOIN_BEHIND) // PACKET * PACKET, self.generation

    def read(self, position, generation):
        """Bytes after `position`, or None once the feed restarted or the reader fell off the ring."""
        with self.cond:
            while self.generation == generation and self.base + len(self.buf) <= position:
                self.cond.wait(1.0)
            if self.generation != generation or position < self.base:
                return None
            return bytes(self.buf[position - self.base :])

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

    def reader(self, conn):
        admitted = False
        try:
            conn.settimeout(10)
            request = b""
            while b"\r\n\r\n" not in request:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                request += chunk
            if request.startswith(b"GET /stats"):
                with READERS.lock:
                    body = json.dumps(READERS.stats).encode()
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" + body)
                return
            if not READERS.admit(conn):
                conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nmax connections reached\n")
                return
            admitted = True
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n")
            conn.settimeout(30)
            position, generation = self.join_position()
            while True:
                data = self.read(position, generation)
                if data is None:
                    return
                conn.sendall(data)
                position += len(data)
        except OSError:
            pass
        finally:
            if admitted:
                READERS.leave(conn)
            conn.close()

    def serve(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((HOST, self.port))
        server.listen(16)
        while True:
            conn, _ = server.accept()
            threading.Thread(target=self.reader, args=(conn,), daemon=True).start()


def main(directory):
    with open(os.path.join(directory, "lineup.json")) as f:
        lineup = json.load(f)
    for entry in lineup["channels"]:
        channel = Channel(entry["id"], entry["port"])
        threading.Thread(target=channel.feed, daemon=True).start()
        threading.Thread(target=channel.serve, daemon=True).start()
        print(f"{channel.name}: readers :{channel.port}, feed :{channel.port + FEED_OFFSET}", flush=True)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1])
