"""시세를 가져온 시각과 실제 거래 기준일을 구분한다."""
from datetime import datetime
from zoneinfo import ZoneInfo


def history_freshness(df, ticker: str, now: datetime | None = None, quote: dict | None = None) -> dict:
    market = "KR" if ticker in {"KS11", "KQ11"} or (len(ticker) == 6 and ticker[0].isdigit()) else "US"
    tz = ZoneInfo("Asia/Seoul" if market == "KR" else "America/New_York")
    today = (now or datetime.now(tz)).astimezone(tz).date()
    last = df.index[-1].date() if not df.empty else None
    # 긴 휴장 가능성을 감안한 보수적 기준. 경과 사실을 알리고 분석을 보류한다.
    stale = last is None or (today - last).days > 7 or last > today
    if quote and quote.get("asOf") and last:
        quote_day = datetime.fromisoformat(quote["asOf"]).astimezone(tz).date()
        if not quote.get("marketOpen") and quote_day > last:
            stale = True
    result = {"asOf": last.isoformat() if last else None,
              "source": df.attrs.get("source", "FinanceDataReader"), "stale": stale}
    if stale:
        result["reason"] = "최근 거래 데이터가 확인되지 않아 분석을 보류합니다."
    return result
