"""데이터 수신 검증 스크립트.

한국(삼성전자)·미국(애플) 데이터가 실제로 들어오는지 확인한다.
프로젝트에서 가장 먼저 통과시켜야 할 관문.

실행:  python data_check.py
"""

import sys

import FinanceDataReader as fdr

# Windows 콘솔(cp949)에서도 한글·기호가 깨지지 않게 UTF-8로 출력
sys.stdout.reconfigure(encoding="utf-8")


def check(name: str, ticker: str) -> None:
    print(f"\n[{name}] {ticker} 조회 중...")
    df = fdr.DataReader(ticker, "2024-01-01")
    if df.empty:
        print("  ✗ 데이터가 비어 있음")
        return
    last = df.iloc[-1]
    print(f"  ✓ {len(df)}행 수신")
    print(f"  최근일: {df.index[-1].date()}  종가: {last['Close']:,.2f}")


if __name__ == "__main__":
    print("=" * 40)
    print(" 데이터 수신 검증")
    print("=" * 40)
    check("한국 · 삼성전자", "005930")
    check("미국 · 애플", "AAPL")
    print("\n둘 다 ✓ 면 데이터 레이어 준비 완료.\n")
