"""Durable state and a shared, at-most-once budget for market/night alerts.

Providers must be queried before entering the transaction. Record every observed
new level, including suppressed ones, so a cooldown never builds a catch-up queue.
Commit the delivery claim before contacting any external messaging service.
"""

import json
import logging
import sqlite3
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from services.notifications import _state_path

logger = logging.getLogger(__name__)
MIN_INTERVAL_SECONDS = 60 * 60


class StateUnavailable(Exception):
    pass


def delivery_policy() -> dict:
    return {
        "minimumIntervalMinutes": MIN_INTERVAL_SECONDS // 60,
        "sharedAcross": ["market", "night"],
        "includesManualChecks": True,
        "sameLevel": "once_per_session_and_direction",
        "suppressedAlerts": "discarded",
        "automaticRetry": False,
        "persistentState": _state_path() is not None,
    }


@dataclass
class AlertState:
    db: sqlite3.Connection
    path: Path
    kind: str
    session: str
    now: datetime
    values: dict

    def reserve_delivery(self) -> int | None:
        """One batch across both kinds, even with concurrent workers or restarts."""
        stamp = self.now.timestamp()
        last = self.db.execute("SELECT MAX(claimed_at) FROM market_alert_deliveries").fetchone()[0]
        if last is not None and stamp - last < MIN_INTERVAL_SECONDS:
            return None
        cursor = self.db.execute(
            "INSERT INTO market_alert_deliveries (kind, session, claimed_at, status) "
            "VALUES (?, ?, ?, 'claimed')", (self.kind, self.session, stamp),
        )
        return cursor.lastrowid


@contextmanager
def alert_state(kind: str, session: str, now: datetime):
    path = _state_path()
    if path is None:
        raise StateUnavailable("Persistent alert state is required")
    db = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(path), timeout=5)
        db.execute("""CREATE TABLE IF NOT EXISTS market_alert_sessions (
            kind TEXT NOT NULL, session TEXT NOT NULL, state TEXT NOT NULL,
            PRIMARY KEY (kind, session)
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS market_alert_deliveries (
            id INTEGER PRIMARY KEY, kind TEXT NOT NULL, session TEXT NOT NULL,
            claimed_at REAL NOT NULL, status TEXT NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS market_alert_claimed_at "
                   "ON market_alert_deliveries (claimed_at)")
        db.commit()
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT state FROM market_alert_sessions WHERE kind = ? AND session = ?",
                         (kind, session)).fetchone()
        values = json.loads(row[0]) if row else {}
        if not isinstance(values, dict):
            raise ValueError("Invalid alert state")
        guard = AlertState(db, path, kind, session, now, values)
        yield guard
        db.execute(
            "INSERT INTO market_alert_sessions (kind, session, state) VALUES (?, ?, ?) "
            "ON CONFLICT(kind, session) DO UPDATE SET state = excluded.state",
            (kind, session, json.dumps(values, allow_nan=False)),
        )
        db.commit()
    except (OSError, sqlite3.Error, ValueError, TypeError, KeyError) as exc:
        if db is not None:
            db.rollback()
        logger.warning("Market alert state unavailable (%s)", type(exc).__name__)
        raise StateUnavailable("Persistent alert state unavailable") from exc
    finally:
        if db is not None:
            db.close()


def complete_delivery(guard: AlertState, attempt: int, sent: bool) -> None:
    try:
        with closing(sqlite3.connect(str(guard.path), timeout=5)) as db, db:
            db.execute("UPDATE market_alert_deliveries SET status = ? WHERE id = ?",
                       ("sent" if sent else "delivery_unknown", attempt))
    except (OSError, sqlite3.Error) as exc:
        # The committed claim remains authoritative; never retry an uncertain send.
        logger.warning("Market alert result unconfirmed (%s)", type(exc).__name__)


def read_state(kind: str, session: str) -> dict:
    path = _state_path()
    if path is None or not path.is_file():
        return {}
    try:
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)) as db:
            row = db.execute("SELECT state FROM market_alert_sessions WHERE kind = ? AND session = ?",
                             (kind, session)).fetchone()
            value = json.loads(row[0]) if row else {}
            return value if isinstance(value, dict) else {}
    except (OSError, sqlite3.Error, ValueError):
        return {}
