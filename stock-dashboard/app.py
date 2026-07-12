"""주식 분석 대시보드 — Phase 1 최소 버전.

종목 코드를 입력하면 캔들차트 + 이동평균선을 보여준다.
실행:  streamlit run app.py

⚠️ 이 도구는 투자 조언이 아닙니다. 모든 정보는 참고용이며
    최종 매매 판단과 책임은 사용자에게 있습니다.
"""

from datetime import date, timedelta

import FinanceDataReader as fdr
import plotly.graph_objects as go
import streamlit as st

st.set_page_config(page_title="주식 분석 대시보드", page_icon="📈", layout="wide")


@st.cache_data(ttl=60 * 30)  # 30분 캐시 — API 호출 절감
def load_prices(ticker: str, start: date):
    return fdr.DataReader(ticker, start)


# ---- 사이드바: 종목 선택 ----
with st.sidebar:
    st.header("🔍 종목 선택")
    market = st.radio("시장", ["한국", "미국"], horizontal=True)
    if market == "한국":
        ticker = st.text_input("종목 코드", value="005930", help="예: 005930 (삼성전자)")
    else:
        ticker = st.text_input("티커", value="AAPL", help="예: AAPL, TSLA, NVDA")
    period = st.select_slider("기간", options=["3개월", "6개월", "1년", "3년"], value="1년")
    show_ma = st.checkbox("이동평균선 (20·60일)", value=True)

days = {"3개월": 90, "6개월": 180, "1년": 365, "3년": 365 * 3}[period]
start = date.today() - timedelta(days=days)

# ---- 본문 ----
st.title("📈 주식 분석 대시보드")
st.caption("⚠️ 투자 조언이 아닙니다 — 모든 정보는 참고용이며 판단·책임은 사용자에게 있습니다.")

ticker = (ticker or "").strip()
if not ticker:
    st.info("사이드바에서 종목 코드를 입력하세요.")
    st.stop()

try:
    df = load_prices(ticker, start)
except Exception as e:
    st.error(f"데이터를 불러오지 못했습니다: {e}")
    st.stop()

if df.empty:
    st.warning(f"'{ticker}' 데이터가 없습니다. 코드를 확인하세요.")
    st.stop()

# ---- 요약 지표 ----
last = df.iloc[-1]
prev = df.iloc[-2] if len(df) > 1 else last
change = last["Close"] - prev["Close"]
pct = (change / prev["Close"] * 100) if prev["Close"] else 0

c1, c2, c3, c4 = st.columns(4)
c1.metric("현재가", f"{last['Close']:,.2f}", f"{pct:+.2f}%")
c2.metric("고가", f"{last['High']:,.2f}")
c3.metric("저가", f"{last['Low']:,.2f}")
c4.metric("거래량", f"{last['Volume']:,.0f}")

# ---- 캔들차트 ----
fig = go.Figure(
    go.Candlestick(
        x=df.index,
        open=df["Open"], high=df["High"], low=df["Low"], close=df["Close"],
        name="가격",
        increasing_line_color="#D64545", decreasing_line_color="#2E6BE6",  # KR 관례: 상승=적, 하락=청
    )
)
if show_ma:
    for window, color in [(20, "#E0B84D"), (60, "#8A94A2")]:
        fig.add_trace(
            go.Scatter(
                x=df.index, y=df["Close"].rolling(window).mean(),
                mode="lines", name=f"MA{window}", line=dict(color=color, width=1.3),
            )
        )
fig.update_layout(
    height=520, xaxis_rangeslider_visible=False,
    margin=dict(l=0, r=0, t=10, b=0), legend=dict(orientation="h", y=1.02),
)
st.plotly_chart(fig, use_container_width=True)

with st.expander("원본 데이터 보기"):
    st.dataframe(df.tail(20), use_container_width=True)
