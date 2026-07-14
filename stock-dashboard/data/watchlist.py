"""관심종목 저장 — 프로젝트 루트의 watchlist.json 에 영속화.

세션이 아니라 파일에 저장하므로 앱을 껐다 켜도 유지된다.
항목: {"market": "한국"/"미국", "ticker": "005930", "name": "삼성전자"}
"""

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parent.parent / "watchlist.json"


def load() -> list[dict]:
    if not _PATH.exists():
        return []
    try:
        return json.loads(_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save(items: list[dict]) -> None:
    _PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def add(market: str, ticker: str, name: str) -> None:
    items = load()
    if any(i["ticker"] == ticker and i["market"] == market for i in items):
        return  # 이미 있음
    items.append({"market": market, "ticker": ticker, "name": name})
    _save(items)


def remove(market: str, ticker: str) -> None:
    _save([i for i in load() if not (i["ticker"] == ticker and i["market"] == market)])


def contains(market: str, ticker: str) -> bool:
    return any(i["ticker"] == ticker and i["market"] == market for i in load())
