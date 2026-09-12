#!/usr/bin/env python3
# Paced raw-byte HTTP streamer: loops a file to every client at a fixed bitrate, one thread
# per client. Bytes pass untouched, so timestamp splices inside the file reach the reader.
import socket
import sys
import threading
import time

path, port, bps = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
host = sys.argv[4] if len(sys.argv) > 4 else "127.0.0.1"
chunk = 188 * 64
interval = chunk / (bps / 8.0)


def serve(conn):
    try:
        conn.recv(4096)
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\n\r\n")
        while True:
            with open(path, "rb") as f:
                while True:
                    data = f.read(chunk)
                    if not data:
                        break
                    conn.sendall(data)
                    time.sleep(interval)
    except OSError:
        pass
    finally:
        conn.close()


srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind((host, port))
srv.listen(8)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=serve, args=(conn,), daemon=True).start()
