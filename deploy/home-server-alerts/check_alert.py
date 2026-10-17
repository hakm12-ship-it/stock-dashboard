#!/usr/bin/python3
"""Run one existing alert check through the app's private loopback port."""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request


def main() -> int:
    kind = sys.argv[1] if len(sys.argv) == 2 else ""
    if kind not in {"market", "night"}:
        raise ValueError("Expected market or night")
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
        ["docker", "inspect", ids[0]],
        text=True, timeout=10, stderr=subprocess.DEVNULL,
    ))[0]
    if not app["Name"].lstrip("/").startswith(prefix):
        raise RuntimeError("Unexpected app container")
    env = dict(entry.split("=", 1) for entry in app["Config"]["Env"])
    key = env.get("ALERT_CHECK_KEY", "").strip() or env.get("ADMIN_KEY", "").strip()
    if not key:
        raise RuntimeError("Alert authentication is not configured")
    bindings = app["HostConfig"]["PortBindings"].get("8000/tcp", [])
    port = next((entry["HostPort"] for entry in bindings
                 if entry.get("HostIp") == "127.0.0.1"), "")
    if not port.isdigit():
        raise RuntimeError("Private app port is not configured")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/{kind}-alert-check",
        headers={"Authorization": f"Bearer {key}",
                 "User-Agent": "StockInsightScheduler/1.0"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        result = json.loads(response.read())
        status = response.status
    summary = {
        "kind": kind, "httpStatus": status, "checked": result.get("checked"),
        "alerts": result.get("alerts", 0), "sent": result.get("sent", False),
        "telegram": result.get("channels", {}).get("telegram", False),
    }
    print(json.dumps(summary), flush=True)
    return 1 if summary["alerts"] and not summary["telegram"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        # Exceptions and Docker output can contain credentials. Log classes only.
        print(json.dumps({"errorType": type(exc).__name__,
                          "httpStatus": exc.code if isinstance(exc, urllib.error.HTTPError) else None}),
              flush=True)
        sys.exit(1)
