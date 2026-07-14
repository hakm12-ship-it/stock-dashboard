# 스톡 인사이트 (Stock Insight)

한국·미국 종목을 한 화면에서 **기술적 · 기본적 · 뉴스 · 종합 신호** 관점으로 조사하는 투자 판단 보조 웹앱.

> ⚠️ 이 도구는 투자 조언이 아닙니다. 모든 정보·신호는 참고용이며 최종 판단과 책임은 사용자에게 있습니다.

## 기능

| 탭 | 내용 |
|---|---|
| 🎯 종합 신호 | 규칙 기반 매수/중립/매도 판정 + 지지·저항 참고 가격대 + 밸류에이션 태그 |
| 📊 기술적 분석 | 캔들차트 · 이동평균 · 볼린저밴드 · RSI · MACD |
| 💰 기본적 분석 | PER · PBR · EPS · ROE · 배당 · 시가총액 · 연간 실적 추이 |
| 📰 뉴스 | 종목별 최신 뉴스 (한국어/영어) |

사이드바에서 종목 이름으로 검색하고, 관심종목을 저장할 수 있습니다.

## 실행

```powershell
cd stock-dashboard
.\.venv\Scripts\streamlit run app.py
```

브라우저에서 `http://localhost:8501` 접속. 같은 Wi-Fi의 다른 기기에서는 `http://<PC-IP>:8501`.

## 구조

```
stock-dashboard/
├─ app.py                  # Streamlit 화면 (탭 4개 + 사이드바)
├─ analysis/
│  ├─ technical.py         # RSI · MACD · 볼린저
│  ├─ fundamental.py       # 밸류에이션 · 실적 (yfinance)
│  └─ signal.py            # 규칙 기반 종합 신호
├─ data/
│  ├─ symbols.py           # 종목 검색 (이름↔코드)
│  ├─ news.py              # 뉴스 (Google News RSS)
│  └─ watchlist.py         # 관심종목 저장
└─ requirements.txt
```

## 데이터 소스

- **가격/종목목록**: FinanceDataReader
- **재무**: yfinance (국내는 `.KS`/`.KQ`, PER/PBR 미제공 시 순이익·자본으로 계산)
- **뉴스**: Google News RSS

## 기술 스택

Python · Streamlit · Plotly · pandas
