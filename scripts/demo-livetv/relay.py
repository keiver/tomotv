#!/usr/bin/env python3
"""MPEG-TS relay for the demo channels: one ffmpeg pushes each channel over TCP, every HTTP reader joins at the live position.

  relay.py <dir>   per channel in lineup.json: feed on tcp 127.0.0.1:<port+100>, readers on http://127.0.0.1:<port>/live.ts
"""

import json
import os
import socket
import sys
import threading
import time

HOST = "127.0.0.1"
PACKET = 188
RING = 16 * 1024 * 1024
JOIN_BEHIND = 16000 * PACKET
FEED_OFFSET = 100


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
        try:
            conn.settimeout(10)
            request = b""
            while b"\r\n\r\n" not in request:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                request += chunk
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
