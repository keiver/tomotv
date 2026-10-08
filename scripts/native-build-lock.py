#!/usr/bin/env python3
"""Serialize commands that regenerate or build the shared native projects."""
import fcntl
import os
from pathlib import Path
import sys


root = str(Path(__file__).resolve().parent.parent)
if len(sys.argv) < 2:
    sys.exit("Usage: native-build-lock.py <command> [args...]")

# Nested prebuilds inherit the descriptor and may use the lock already held by
# their parent. Check the descriptor itself rather than trusting an env flag.
fd = None
try:
    inherited = int(os.environ.get("TOMOTV_NATIVE_BUILD_LOCK_FD", ""))
    if os.environ.get("TOMOTV_NATIVE_BUILD_LOCK_ROOT") == root:
        held = os.fstat(inherited)
        lock = os.stat(Path(root) / ".native-build.lock")
        if (held.st_dev, held.st_ino) == (lock.st_dev, lock.st_ino):
            fd = inherited
except (ValueError, OSError):
    pass

if fd is None:
    fd = os.open(Path(root) / ".native-build.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Another TomoTV native build is using the generated projects. Waiting for it to finish...", file=sys.stderr, flush=True)
        fcntl.flock(fd, fcntl.LOCK_EX)

# Keep the lock across exec and child shells. The OS releases it when the last
# holder exits, including a killed build; no stale lock directory to recover.
os.set_inheritable(fd, True)
os.environ["TOMOTV_NATIVE_BUILD_LOCK_ROOT"] = root
os.environ["TOMOTV_NATIVE_BUILD_LOCK_FD"] = str(fd)
os.execvp(sys.argv[1], sys.argv[1:])
