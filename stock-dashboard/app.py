"""스톡 인사이트 — Phase 1~2.

종목을 검색하면 [기술적 분석] 캔들·이평·볼린저·RSI·MACD 와
[기본적 분석] PER·PBR·EPS·ROE·배당·시총·실적추이 를 보여준다.
관심종목은 파일로 저장돼 앱을 껐다 켜도 유지된다.

실행:  streamlit run app.py

⚠️ 이 도구는 투자 조언이 아닙니다. 모든 정보는 참고용이며
    최종 매매 판단과 책임은 사용자에게 있습니다.
"""

from datetime import date, timedelta

import FinanceDataReader as fdr
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import data.watchlist as wl
from analysis.forecast import expected_range
from analysis.fundamental import revenue_trend, valuation
from analysis.signal import price_levels, technical_signals
from analysis.technical import bollinger, macd, rsi
from data.news import fetch_news
from data.symbols import symbols

# 색상 — 상승=적, 하락=청 (KR 관례). 선명한 톤으로 봉 시인성 확보
UP, DOWN = "#F23645", "#2E86FF"
GOLD, GRAY = "#E0B84D", "#8A94A2"
BAND = "rgba(140,148,162,0.5)"

st.set_page_config(page_title="스톡 인사이트", page_icon="📈", layout="wide")


# ---- 데이터 로더 (캐시) ----
@st.cache_data(ttl=60 * 30)
def load_prices(ticker: str, start: date):
    return fdr.DataReader(ticker, start)


@st.cache_data(ttl=60 * 60 * 24, show_spinner="종목 목록 불러오는 중...")
def load_symbols(market: str):
    return symbols(market)


@st.cache_data(ttl=60 * 60 * 6, show_spinner=False)
def load_valuation(market: str, ticker: str):
    return valuation(market, ticker)


@st.cache_data(ttl=60 * 60 * 6, show_spinner=False)
def load_trend(market: str, ticker: str):
    return revenue_trend(market, ticker)


@st.cache_data(ttl=60 * 15, show_spinner=False)
def load_news(market: str, name: str):
    return fetch_news(market, name)


# ---- 표시 포맷 헬퍼 ----
def fmt_label(name: str, ticker: str) -> str:
    return f"{name}  ({ticker})"


def f_per(v):
    return f"{v:.1f}" if isinstance(v, (int, float)) else "—"


def f_pbr(v):
    return f"{v:.2f}" if isinstance(v, (int, float)) else "—"


def f_roe(v):
    return f"{v * 100:.1f}%" if isinstance(v, (int, float)) else "—"


def f_div(v):
    return f"{v:.2f}%" if isinstance(v, (int, float)) else "—"


def f_eps(v, cur):
    if not isinstance(v, (int, float)):
        return "—"
    return f"${v:,.2f}" if cur == "USD" else f"{v:,.0f}원"


def f_price(v, market):
    if not isinstance(v, (int, float)):
        return "—"
    return f"{v:,.0f}원" if market == "한국" else f"${v:,.2f}"


def band(v, lo, hi, labels):
    """수치를 저/중/고 라벨로. labels=(낮음, 보통, 높음)."""
    if not isinstance(v, (int, float)):
        return "—"
    return labels[0] if v < lo else labels[2] if v > hi else labels[1]


def f_cap(v, cur):
    if not isinstance(v, (int, float)):
        return "—"
    if cur == "USD":
        if v >= 1e12:
            return f"${v / 1e12:.2f}T"
        if v >= 1e9:
            return f"${v / 1e9:.2f}B"
        return f"${v / 1e6:.0f}M"
    jo = v / 1e12
    return f"{jo:,.1f}조" if jo >= 1 else f"{v / 1e8:,.0f}억"


# ---- 관심종목 바로가기 요청 처리 (위젯 생성 전에) ----
jump = st.session_state.pop("jump", None)
if jump:
    st.session_state["market_radio"] = jump["market"]
    st.session_state["symbol_select"] = fmt_label(jump["name"], jump["ticker"])

# ---- 사이드바 ----
with st.sidebar:
    st.header("🔍 종목 선택")
    market = st.radio("시장", ["한국", "미국"], horizontal=True, key="market_radio")
    default_name = "삼성전자" if market == "한국" else "Apple Inc"

    listing_ok = True
    try:
        syms = load_symbols(market)
        labels = [fmt_label(n, t) for n, t in zip(syms["name"], syms["ticker"])]
        to_ticker = dict(zip(labels, syms["ticker"]))
        to_name = dict(zip(labels, syms["name"]))

        # 시장이 바뀌었거나 첫 실행이면 기본 종목으로 초기화
        if st.session_state.get("symbol_select") not in labels:
            match = syms[syms["name"] == default_name]
            st.session_state["symbol_select"] = (
                fmt_label(default_name, match["ticker"].iloc[0]) if len(match) else labels[0]
            )
        picked = st.selectbox("종목 (이름·코드로 검색)", labels, key="symbol_select",
                              help="이름 일부만 입력해도 필터됩니다")
        ticker, name = to_ticker[picked], to_name[picked]
    except Exception as e:
        listing_ok = False
        st.warning(f"종목 목록을 불러오지 못해 직접 입력 모드입니다: {e}")
        ticker = st.text_input("종목 코드 / 티커",
                               value="005930" if market == "한국" else "AAPL")
        name = ticker

    period = st.select_slider("기간", options=["1개월", "3개월", "6개월", "1년"], value="3개월")
    show_ma = st.checkbox("이동평균선 (20·60일)", value=True)
    show_boll = st.checkbox("볼린저 밴드 (20·2σ)", value=False)

    # ---- 관심종목 ----
    st.divider()
    st.subheader("⭐ 관심종목")
    if listing_ok:
        if wl.contains(market, ticker):
            if st.button("➖ 현재 종목 제거", width="stretch"):
                wl.remove(market, ticker)
                st.rerun()
        else:
            if st.button("➕ 현재 종목 추가", width="stretch"):
                wl.add(market, ticker, name)
                st.rerun()

    items = wl.load()
    if not items:
        st.caption("저장된 종목이 없습니다.")
    for it in items:
        flag = "🇰🇷" if it["market"] == "한국" else "🇺🇸"
        c1, c2 = st.columns([5, 1])
        if c1.button(f'{flag} {it["name"]} ({it["ticker"]})',
                     key=f'go_{it["market"]}_{it["ticker"]}', width="stretch"):
            st.session_state["jump"] = it
            st.rerun()
        if c2.button("✕", key=f'del_{it["market"]}_{it["ticker"]}'):
            wl.remove(it["market"], it["ticker"])
            st.rerun()

# ---- 본문 ----
st.title("📈 스톡 인사이트")
st.caption("⚠️ 투자 조언이 아닙니다 — 모든 정보는 참고용이며 판단·책임은 사용자에게 있습니다.")

ticker = (ticker or "").strip()
if not ticker:
    st.info("사이드바에서 종목을 검색하세요.")
    st.stop()

days = {"1개월": 30, "3개월": 90, "6개월": 180, "1년": 365}[period]
start = date.today() - timedelta(days=days)

try:
    df = load_prices(ticker, start)
except Exception as e:
    st.error(f"가격 데이터를 불러오지 못했습니다: {e}")
    st.stop()

if df.empty:
    st.warning(f"'{ticker}' 데이터가 없습니다. 코드를 확인하세요.")
    st.stop()

st.subheader(f"{name}  ·  {ticker}")
tab_signal, tab_tech, tab_fund, tab_news = st.tabs(
    ["🎯 종합 신호", "📊 기술적 분석", "💰 기본적 분석", "📰 뉴스"]
)

# ========== 종합 신호 ==========
with tab_signal:
    st.warning("⚠️ 아래는 과거 가격·지표를 **규칙으로 요약한 참고용 정보**입니다. "
               "예측이나 투자 조언이 아니며, 최종 판단과 책임은 본인에게 있습니다.")

    sigs, total, verdict = technical_signals(df)
    box = {"매수 우위": st.success, "매도 우위": st.error, "중립": st.info}[verdict]
    box(f"**기술적 신호 종합 : {verdict}**  (점수 {total:+d} / ±5)")

    # 🔮 예상 변동 범위 (변동성 기반)
    st.markdown("**🔮 예상 변동 범위**  ·  향후 7거래일 · 방향 예측 아님")
    last_px, sigma, rng = expected_range(df, horizon=7)
    hi, lo = rng["upper_inner"].iloc[-1], rng["lower_inner"].iloc[-1]
    r1, r2, r3 = st.columns(3)
    r1.metric("예상 하단 (약 68%)", f_price(lo, market),
              f"{(lo / last_px - 1) * 100:+.1f}%", delta_color="off")
    r2.metric("현재가", f_price(last_px, market))
    r3.metric("예상 상단 (약 68%)", f_price(hi, market),
              f"{(hi / last_px - 1) * 100:+.1f}%", delta_color="off")

    recent = df["Close"].tail(40)
    bx = [recent.index[-1]] + list(rng.index)
    anchor = lambda col: [last_px] + list(rng[col])  # noqa: E731
    ff = go.Figure()
    ff.add_trace(go.Scatter(x=bx, y=anchor("upper_outer"), mode="lines",
                            line=dict(width=0), hoverinfo="skip", showlegend=False))
    ff.add_trace(go.Scatter(x=bx, y=anchor("lower_outer"), mode="lines",
                            line=dict(width=0), fill="tonexty",
                            fillcolor="rgba(140,148,162,0.10)", hoverinfo="skip", showlegend=False))
    ff.add_trace(go.Scatter(x=bx, y=anchor("upper_inner"), mode="lines",
                            line=dict(width=0), hoverinfo="skip", showlegend=False))
    ff.add_trace(go.Scatter(x=bx, y=anchor("lower_inner"), mode="lines",
                            line=dict(width=0), fill="tonexty",
                            fillcolor="rgba(140,148,162,0.24)", hoverinfo="skip", showlegend=False))
    ff.add_trace(go.Scatter(x=bx, y=[last_px] * len(bx), mode="lines",
                            line=dict(color=GRAY, width=1, dash="dot"),
                            hoverinfo="skip", showlegend=False))
    ff.add_trace(go.Scatter(x=recent.index, y=recent.values, mode="lines",
                            line=dict(color=GOLD, width=1.8), showlegend=False))
    ff.update_layout(height=300, margin=dict(l=0, r=0, t=6, b=0))
    st.plotly_chart(ff, width="stretch", config={"displayModeBar": False})
    st.caption(f"최근 일일 변동성 {sigma * 100:.1f}% 기준 · 진한 띠 ≈68%, 연한 띠 ≈95% 범위. "
               "방향 예측이 아니며 실제 가격은 범위를 벗어날 수 있습니다.")

    st.divider()
    st.markdown("**신호 근거**")
    for s in sigs:
        mark = "🟢" if s["score"] > 0 else "🔴" if s["score"] < 0 else "⚪"
        st.markdown(f"{mark} **{s['name']}** — {s['detail']}")

    st.divider()
    st.markdown(f"**참고 가격대**  ·  현재가 **{f_price(df['Close'].iloc[-1], market)}**")
    _, below, above = price_levels(df)
    lc, rc = st.columns(2)
    with lc:
        st.markdown("🔵 **지지 구간 (매수 관심)**")
        if below:
            for k, v in below:
                st.markdown(f"- **{f_price(v, market)}**  ·  {k}")
        else:
            st.caption("현재가 아래 뚜렷한 지지선이 없습니다.")
    with rc:
        st.markdown("🔴 **저항 구간 (매도 관심)**")
        if above:
            for k, v in above:
                st.markdown(f"- **{f_price(v, market)}**  ·  {k}")
        else:
            st.caption("현재가 위 뚜렷한 저항선이 없습니다.")

    st.divider()
    st.markdown("**밸류에이션 참고**  ·  업종·성장성에 따라 해석이 달라집니다")
    try:
        sval = load_valuation(market, ticker)
    except Exception:
        sval = None
    if sval:
        m1, m2, m3 = st.columns(3)
        m1.metric("PER", f_per(sval["PER"]),
                  band(sval["PER"], 10, 25, ("낮음 · 저평가 가능", "보통", "높음 · 고평가 주의")),
                  delta_color="off")
        m2.metric("PBR", f_pbr(sval["PBR"]),
                  band(sval["PBR"], 1, 3, ("낮음", "보통", "높음")), delta_color="off")
        m3.metric("ROE", f_roe(sval["ROE"]),
                  band(sval["ROE"], 0.05, 0.15, ("낮음", "보통", "우수")), delta_color="off")
    else:
        st.caption("밸류에이션 데이터를 불러오지 못했습니다.")

    st.divider()
    try:
        news_n = len(load_news(market, name))
    except Exception:
        news_n = 0
    st.caption(f"📰 관련 최신 뉴스 {news_n}건 — '뉴스' 탭에서 확인하세요.")

# ========== 기술적 분석 ==========
with tab_tech:
    df["RSI"] = rsi(df["Close"])
    macd_df = macd(df["Close"])

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    pct = ((last["Close"] - prev["Close"]) / prev["Close"] * 100) if prev["Close"] else 0
    rsi_val = last["RSI"]
    rsi_tag = "과매수" if rsi_val >= 70 else "과매도" if rsi_val <= 30 else "중립"

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("현재가", f"{last['Close']:,.2f}", f"{pct:+.2f}%")
    c2.metric("RSI(14)", f"{rsi_val:.1f}", rsi_tag)
    c3.metric("MACD", f"{macd_df['macd'].iloc[-1]:.2f}")
    c4.metric("거래량", f"{last['Volume']:,.0f}")

    fig = make_subplots(
        rows=3, cols=1, shared_xaxes=True, vertical_spacing=0.04,
        row_heights=[0.56, 0.2, 0.24],
        subplot_titles=("가격", "RSI (14)", "MACD (12·26·9)"),
    )

    # 1행: 캔들 + 이동평균 + 볼린저
    fig.add_trace(
        go.Candlestick(
            x=df.index, open=df["Open"], high=df["High"], low=df["Low"], close=df["Close"],
            name="가격", showlegend=False,
            increasing=dict(line=dict(color=UP, width=1), fillcolor=UP),
            decreasing=dict(line=dict(color=DOWN, width=1), fillcolor=DOWN),
        ),
        row=1, col=1,
    )
    if show_boll:
        bb = bollinger(df["Close"])
        fig.add_trace(go.Scatter(x=df.index, y=bb["upper"], mode="lines", name="BB 상단",
                                 line=dict(color=BAND, width=1)), row=1, col=1)
        fig.add_trace(go.Scatter(x=df.index, y=bb["lower"], mode="lines", name="BB 하단",
                                 line=dict(color=BAND, width=1),
                                 fill="tonexty", fillcolor="rgba(140,148,162,0.08)"),
                      row=1, col=1)
    if show_ma:
        for window, color in [(20, GOLD), (60, GRAY)]:
            fig.add_trace(
                go.Scatter(x=df.index, y=df["Close"].rolling(window).mean(),
                           mode="lines", name=f"MA{window}", line=dict(color=color, width=1.3)),
                row=1, col=1,
            )

    # 2행: RSI
    fig.add_trace(go.Scatter(x=df.index, y=df["RSI"], mode="lines", name="RSI",
                             showlegend=False, line=dict(color=GOLD, width=1.4)), row=2, col=1)
    fig.add_hline(y=70, line=dict(color=UP, width=1, dash="dash"), row=2, col=1)
    fig.add_hline(y=30, line=dict(color=DOWN, width=1, dash="dash"), row=2, col=1)
    fig.update_yaxes(range=[0, 100], row=2, col=1)

    # 3행: MACD
    hist_colors = [UP if v >= 0 else DOWN for v in macd_df["hist"]]
    fig.add_trace(go.Bar(x=df.index, y=macd_df["hist"], name="히스토그램", showlegend=False,
                         marker_color=hist_colors, opacity=0.5), row=3, col=1)
    fig.add_trace(go.Scatter(x=df.index, y=macd_df["macd"], mode="lines", name="MACD",
                             showlegend=False, line=dict(color=GOLD, width=1.3)), row=3, col=1)
    fig.add_trace(go.Scatter(x=df.index, y=macd_df["signal"], mode="lines", name="Signal",
                             showlegend=False, line=dict(color=GRAY, width=1.3)), row=3, col=1)

    fig.update_layout(height=760, xaxis_rangeslider_visible=False, showlegend=True,
                      margin=dict(l=0, r=0, t=28, b=0),
                      legend=dict(orientation="h", y=1.04, x=0))
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})

    with st.expander("원본 데이터 보기"):
        st.dataframe(df.tail(20), width="stretch")

# ========== 기본적 분석 ==========
with tab_fund:
    st.caption("데이터: Yahoo Finance · 값이 없으면 —")
    try:
        val = load_valuation(market, ticker)
    except Exception as e:
        st.error(f"재무 정보를 불러오지 못했습니다: {e}")
        val = None

    if val:
        cur = val["통화"]
        c1, c2, c3 = st.columns(3)
        c1.metric("PER", f_per(val["PER"]))
        c2.metric("PBR", f_pbr(val["PBR"]))
        c3.metric("EPS", f_eps(val["EPS"], cur))
        c4, c5, c6 = st.columns(3)
        c4.metric("ROE", f_roe(val["ROE"]))
        c5.metric("배당수익률", f_div(val["배당수익률"]))
        c6.metric("시가총액", f_cap(val["시가총액"], cur))
        meta = [x for x in [val.get("섹터"), f"통화 {cur}" if cur else None] if x]
        if meta:
            st.caption("  ·  ".join(meta))

    st.divider()
    st.markdown("**연간 실적 추이**")
    try:
        trend = load_trend(market, ticker)
    except Exception:
        trend = None
    if trend is not None and not trend.empty:
        tfig = go.Figure()
        for col, color in [("매출", GOLD), ("영업이익", UP), ("순이익", DOWN)]:
            if col in trend.columns:
                tfig.add_trace(go.Bar(x=[str(y) for y in trend.index], y=trend[col],
                                      name=col, marker_color=color))
        tfig.update_layout(barmode="group", height=340,
                           margin=dict(l=0, r=0, t=10, b=0),
                           legend=dict(orientation="h", y=1.06, x=0))
        st.plotly_chart(tfig, width="stretch", config={"displayModeBar": False})
        st.caption("단위: 각 통화 기준 원자료 값")
    else:
        st.info("연간 실적 데이터를 제공하지 않는 종목입니다.")

# ========== 뉴스 ==========
with tab_news:
    st.caption(f"'{name}' 관련 최신 뉴스 · 출처: Google News · 제목을 누르면 기사로 이동")
    try:
        articles = load_news(market, name)
    except Exception as e:
        st.error(f"뉴스를 불러오지 못했습니다: {e}")
        articles = []

    if not articles:
        st.info("관련 뉴스를 찾지 못했습니다.")
    for a in articles:
        st.markdown(f"**[{a['title']}]({a['link']})**")
        meta = "  ·  ".join(x for x in [a["source"], a["published"]] if x)
        if meta:
            st.caption(meta)
