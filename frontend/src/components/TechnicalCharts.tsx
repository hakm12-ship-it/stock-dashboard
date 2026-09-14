import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi, type SeriesType, type Time } from 'lightweight-charts'
import { chartBase, chartColors, priceFormatFor, fmtChartDate } from '../lib/chartTheme'
import type { Candle, Indicators } from '../lib/api'
import type { Market } from '../data/tickers'
import { changeColor, fmtChange } from '../lib/format'

/** 값이 없는 날도 빈 점으로 남겨서 가격·RSI·MACD 차트의 가로 위치(논리 인덱스)를 맞춘다. */
function line(times: string[], vals: (number | null)[]) {
  return times.map((time, i) => (vals[i] != null ? { time, value: vals[i] as number } : { time }))
}

const lastOf = (vals: (number | null)[] | undefined, at?: number | null) => {
  if (!vals) return null
  if (at != null) return vals[at] ?? null
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return vals[i]
  return null
}

function Swatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-3 align-middle mr-1"
      style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }}
    />
  )
}

export default function TechnicalCharts({
  candles,
  ind,
  showMA,
  showBB,
  light,
  levels,
  simple = false,
  avgPrice,
  market,
  kind,
}: {
  candles: Candle[]
  ind: Indicators
  showMA: boolean
  showBB: boolean
  light: boolean
  levels?: { support: number[]; resistance: number[] }
  simple?: boolean // 주봉 등: 가격+거래량만 (일봉 기반 지표 숨김)
  avgPrice?: number // 보유 평균단가 라인
  market: Market
  kind: string
}) {
  const priceRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const colors = chartColors(light)
  const format = priceFormatFor(market, kind)
  const fmt = format.formatter
  const fmtMacd = (v: number) =>
    market === 'KR' && kind !== 'index' ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2)

  // 캔들 범위 밖(±5%)의 지지·저항은 선을 그리지 않고 범례에만 흐리게 남긴다.
  const range = useMemo(() => {
    const lo = Math.min(...candles.map((c) => c.low))
    const hi = Math.max(...candles.map((c) => c.high))
    return { lo: lo * 0.95, hi: hi * 1.05 }
  }, [candles])
  const inRange = (p: number) => p >= range.lo && p <= range.hi

  useEffect(() => {
    if (!candles.length || !priceRef.current) return
    const c = chartColors(light)
    const pf = priceFormatFor(market, kind)
    const charts: IChartApi[] = []

    const pc = createChart(priceRef.current, {
      ...chartBase(light),
      timeScale: { ...chartBase(light).timeScale, visible: simple },
    })
    charts.push(pc)
    const cs = pc.addCandlestickSeries({
      upColor: c.up,
      downColor: c.down,
      borderVisible: false,
      wickUpColor: c.up,
      wickDownColor: c.down,
      priceFormat: pf,
      priceLineColor: c.neutral,
    })
    cs.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })))
    pc.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } })

    const vol = pc.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    })
    pc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    vol.setData(candles.map((k) => ({ time: k.time, value: k.volume, color: k.close >= k.open ? c.volUp : c.volDown })))

    if (avgPrice && avgPrice > 0) {
      cs.createPriceLine({ price: avgPrice, color: c.accent, lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '내 평단' })
    }
    // 지지·저항은 축 라벨을 달지 않는다. 라벨이 겹쳐 현재가·내 평단을 가리던 문제 — 값은 위 범례에 적는다.
    if (levels) {
      levels.support.filter(inRangeOf(candles)).forEach((p) =>
        cs.createPriceLine({ price: p, color: c.down, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }),
      )
      levels.resistance.filter(inRangeOf(candles)).forEach((p) =>
        cs.createPriceLine({ price: p, color: c.up, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }),
      )
    }
    const lineOpt = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, priceFormat: pf }
    if (showBB) {
      pc.addLineSeries({ ...lineOpt, color: c.band }).setData(line(ind.time, ind.bb_upper))
      pc.addLineSeries({ ...lineOpt, color: c.band }).setData(line(ind.time, ind.bb_lower))
    }
    if (showMA) {
      pc.addLineSeries({ ...lineOpt, color: c.ma20 }).setData(line(ind.time, ind.ma20))
      pc.addLineSeries({ ...lineOpt, color: c.ma60 }).setData(line(ind.time, ind.ma60))
    }

    const followers: [IChartApi, ISeriesApi<SeriesType>, (i: number) => number | null][] = []
    if (!simple && rsiRef.current) {
      const rc = createChart(rsiRef.current, {
        ...chartBase(light, false, false),
        timeScale: { ...chartBase(light).timeScale, visible: false },
        handleScroll: false,
        handleScale: false,
      })
      charts.push(rc)
      const r = rc.addLineSeries({
        color: c.accent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      })
      r.setData(line(ind.time, ind.rsi))
      rc.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } })
      r.createPriceLine({ price: 70, color: c.up, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' })
      r.createPriceLine({ price: 30, color: c.down, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' })
      followers.push([rc, r, (i) => ind.rsi[i] ?? 50])
    }
    if (!simple && macdRef.current) {
      const mc = createChart(macdRef.current, { ...chartBase(light, false, false), handleScroll: false, handleScale: false })
      charts.push(mc)
      const macdFormat = { type: 'custom' as const, minMove: 0.01, formatter: fmtMacdFor(market, kind) }
      const h = mc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat })
      h.setData(
        ind.time.map((time, i) =>
          ind.hist[i] != null
            ? { time, value: ind.hist[i] as number, color: (ind.hist[i] as number) >= 0 ? c.histUp : c.histDown }
            : { time },
        ),
      )
      const m = mc.addLineSeries({ color: c.accent, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat })
      m.setData(line(ind.time, ind.macd))
      mc.addLineSeries({ color: c.ma60, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat }).setData(
        line(ind.time, ind.signal),
      )
      followers.push([mc, m, (i) => ind.macd[i] ?? 0])
    }

    // 아래 두 차트는 가격 차트를 따라 움직인다(이동·확대·십자선).
    pc.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r) followers.forEach(([chart]) => chart.timeScale().setVisibleLogicalRange(r))
    })
    pc.subscribeCrosshairMove((param) => {
      const i = param.logical != null && param.time !== undefined ? Math.round(param.logical) : null
      setHover(i != null && i >= 0 && i < candles.length ? i : null)
      followers.forEach(([chart, series, valueAt]) => {
        if (i == null || param.time === undefined) chart.clearCrosshairPosition()
        else chart.setCrosshairPosition(valueAt(i) ?? 0, param.time as Time, series)
      })
    })
    pc.timeScale().fitContent()

    // 세 차트의 오른쪽 가격축 폭을 가장 넓은 것에 맞춰 날짜 위치를 세로로 정렬한다.
    const frame = requestAnimationFrame(() => {
      const width = Math.max(...charts.map((chart) => chart.priceScale('right').width()))
      charts.forEach((chart) => chart.applyOptions({ rightPriceScale: { minimumWidth: width } }))
    })

    return () => {
      cancelAnimationFrame(frame)
      charts.forEach((chart) => chart.remove())
    }
  }, [candles, ind, showMA, showBB, light, levels, simple, avgPrice, market, kind])

  const idx = hover ?? candles.length - 1
  const k = candles[idx]
  const prev = candles[idx - 1]
  const chg = k && prev ? k.close - prev.close : null
  const rsi = lastOf(ind.rsi, hover)
  const macd = lastOf(ind.macd, hover)
  const signal = lastOf(ind.signal, hover)
  const ma20 = lastOf(ind.ma20, hover)
  const ma60 = lastOf(ind.ma60, hover)
  const sr = levels ?? { support: [], resistance: [] }

  return (
    <div className="tech-charts">
      <div className="chart-head" aria-live="off">
        {k && (
          <div className="chart-ohlc">
            <span className="text-text font-sans">{fmtChartDate(k.time)}</span>
            <span>시 {fmt(k.open)}</span>
            <span className="chart-ohlc-extra">고 {fmt(k.high)}</span>
            <span className="chart-ohlc-extra">저 {fmt(k.low)}</span>
            <span className="text-text">종 {fmt(k.close)}</span>
            {chg != null && prev && (
              <span className={changeColor(chg)}>{fmtChange((chg / prev.close) * 100, chg)}</span>
            )}
          </div>
        )}
        <div className="chart-legend">
          {showMA && (
            <>
              <span>
                <Swatch color={colors.ma20} />
                20일선 {ma20 != null ? fmt(ma20) : '—'}
              </span>
              <span>
                <Swatch color={colors.ma60} />
                60일선 {ma60 != null ? fmt(ma60) : '—'}
              </span>
            </>
          )}
          {showBB && (
            <span>
              <Swatch color={colors.band} />
              볼린저 밴드
            </span>
          )}
          {sr.resistance.length > 0 && (
            <span>
              <Swatch color={colors.up} dashed />
              저항{' '}
              {sr.resistance.map((p, i) => (
                <span key={i} className={inRange(p) ? '' : 'opacity-50'}>
                  {i > 0 && ' · '}
                  {fmt(p)}
                </span>
              ))}
            </span>
          )}
          {sr.support.length > 0 && (
            <span>
              <Swatch color={colors.down} dashed />
              지지{' '}
              {sr.support.map((p, i) => (
                <span key={i} className={inRange(p) ? '' : 'opacity-50'}>
                  {i > 0 && ' · '}
                  {fmt(p)}
                </span>
              ))}
            </span>
          )}
          {avgPrice != null && avgPrice > 0 && (
            <span>
              <Swatch color={colors.accent} />내 평단 {fmt(avgPrice)}
            </span>
          )}
        </div>
      </div>
      <div ref={priceRef} className="chart-pane chart-price" role="img" aria-label="가격·거래량 차트" />
      {!simple && (
        <>
          <div className="chart-subhead">
            <h3>RSI 14</h3>
            {rsi != null && (
              <span>
                <span className="text-text">{rsi.toFixed(1)}</span> {rsi >= 70 ? '과매수' : rsi <= 30 ? '과매도' : '중립'}
                <span className="chart-hint"> · 70 이상 과매수 · 30 이하 과매도</span>
              </span>
            )}
          </div>
          <div ref={rsiRef} className="chart-pane chart-ind" role="img" aria-label="RSI 차트" />
          <div className="chart-subhead">
            <h3>MACD 12·26·9</h3>
            {macd != null && signal != null && (
              <span>
                <Swatch color={colors.accent} />
                MACD {fmtMacd(macd)} <Swatch color={colors.ma60} />
                시그널 {fmtMacd(signal)}{' '}
                <span className={macd >= signal ? 'text-up' : 'text-down'}>
                  {macd >= signal ? '시그널 위' : '시그널 아래'}
                </span>
              </span>
            )}
          </div>
          <div ref={macdRef} className="chart-pane chart-ind" role="img" aria-label="MACD 차트" />
        </>
      )}
      <p className="chart-hint-line">좌우로 끌어 이동 · 두 손가락이나 가로축 끌기로 확대 · 가로축 두 번 눌러 원래대로</p>
    </div>
  )
}

function inRangeOf(candles: Candle[]) {
  const lo = Math.min(...candles.map((c) => c.low)) * 0.95
  const hi = Math.max(...candles.map((c) => c.high)) * 1.05
  return (p: number) => p >= lo && p <= hi
}

function fmtMacdFor(market: Market, kind: string) {
  return (v: number) => (market === 'KR' && kind !== 'index' ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2))
}
