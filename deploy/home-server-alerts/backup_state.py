#!/usr/bin/python3
"""Back up the app's SQLite state online, retaining 30 verified copies."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys


def main() -> None:
    prefix = os.environ.get("STOCK_INSIGHT_CONTAINER_PREFIX", "")
    if not re.fullmatch(r"stock-insight-[a-z0-9]+-", prefix):
        raise ValueError("Missing or invalid app container prefix")
    ids = subprocess.check_output(
        ["docker", "ps", "-q", "--filter", f"name={prefix}"],
        text=True, timeout=10, stderr=subprocess.DEVNULL,
    ).split()
    if len(ids) != 1:
        raise RuntimeError("Expected exactly one running app container")
    app = json.loads(subprocess.check_output(
        ["docker", "inspect", ids[0]], text=True, timeout=10,
        stderr=subprocess.DEVNULL,
    ))[0]
    if not app["Name"].lstrip("/").startswith(prefix):
        raise RuntimeError("Unexpected app container")
    mount = next(m for m in app["Mounts"] if m["Destination"] == "/var/data")
    source = Path(mount["Source"]) / "notifications.sqlite3"
    if not source.is_file():
        raise FileNotFoundError("Notification state is not present")
    directory = Path("/srv/data/stock-insight/backups")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    name = "notifications-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".sqlite3"
    destination = directory / name
    if destination.exists():
        raise FileExistsError("A backup with this timestamp already exists")
    temporary = directory / ("." + name + ".tmp")
    try:
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as src:
            with sqlite3.connect(str(temporary)) as dst:
                src.backup(dst)
                if dst.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup integrity check failed")
        temporary.chmod(0o600)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    # Only files created by this job in its private backup directory are pruned.
    copies = sorted(p for p in directory.iterdir()
                    if p.is_file() and not p.is_symlink()
                    and re.fullmatch(r"notifications-\d{8}T\d{6}Z\.sqlite3", p.name))
    for old in copies[:-30]:
        old.unlink()
    print(json.dumps({"backup": name, "integrity": "ok",
                      "retainedCopies": min(len(copies), 30)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"errorType": type(exc).__name__}), flush=True)
        sys.exit(1)
