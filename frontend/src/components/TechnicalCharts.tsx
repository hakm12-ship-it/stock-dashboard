import { useEffect, useRef } from 'react'
import { createChart, ColorType, type IChartApi } from 'lightweight-charts'
import type { Candle, Indicators } from '../lib/api'

const UP = '#F23645'
const DOWN = '#2E86FF'
const GOLD = '#E0B84D'
const GRAY = '#8B94A3'
const ACCENT = '#E0A63C'

function makeBase(light: boolean) {
  const text = light ? '#5C6672' : '#8B94A3'
  const grid = light ? 'rgba(22,27,38,0.07)' : 'rgba(35,40,51,0.4)'
  const bd = light ? '#E0E3E8' : '#232833'
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: text,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10,
    },
    grid: {
      vertLines: { color: grid },
      horzLines: { color: grid },
    },
    rightPriceScale: { borderColor: bd },
    timeScale: { borderColor: bd, timeVisible: false },
    crosshair: { mode: 1 as const },
    autoSize: true,
  }
}

function line(times: string[], vals: (number | null)[]) {
  const out: { time: string; value: number }[] = []
  for (let i = 0; i < times.length; i++) {
    const v = vals[i]
    if (v != null) out.push({ time: times[i], value: v })
  }
  return out
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
}: {
  candles: Candle[]
  ind: Indicators
  showMA: boolean
  showBB: boolean
  light: boolean
  levels?: { support: number[]; resistance: number[] }
  simple?: boolean // 주봉 등: 가격+거래량만 (일봉 기반 지표 숨김)
  avgPrice?: number // 보유 평균단가 라인
}) {
  const priceRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!candles.length || !priceRef.current) return
    const base = makeBase(light)
    const charts: IChartApi[] = []

    // 가격 + 이평 + 볼린저
    const pc = createChart(priceRef.current, { ...base, height: 280 })
    charts.push(pc)
    const cs = pc.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    })
    cs.setData(
      candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    // 거래량 (하단 오버레이)
    const vol = pc.addHistogramSeries({
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    })
    pc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    vol.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(242,54,69,0.35)' : 'rgba(46,134,255,0.35)',
      })),
    )

    // 보유 평균단가 라인
    if (avgPrice && avgPrice > 0) {
      cs.createPriceLine({
        price: avgPrice, color: ACCENT, lineWidth: 1, lineStyle: 0,
        axisLabelVisible: true, title: '내 평단',
      })
    }

    // 지지/저항 수평선 (종합신호 데이터)
    if (levels) {
      levels.support.forEach((p) =>
        cs.createPriceLine({
          price: p, color: DOWN, lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: '지지',
        }),
      )
      levels.resistance.forEach((p) =>
        cs.createPriceLine({
          price: p, color: UP, lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: '저항',
        }),
      )
    }

    // 십자선 OHLC 시세 표시
    const fnum = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2))
    const setLegend = (d?: { open: number; high: number; low: number; close: number }) => {
      if (!legendRef.current) return
      legendRef.current.textContent = d
        ? `시 ${fnum(d.open)}  고 ${fnum(d.high)}  저 ${fnum(d.low)}  종 ${fnum(d.close)}`
        : ''
    }
    const lastC = candles[candles.length - 1]
    setLegend(lastC)
    pc.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(cs) as
        | { open: number; high: number; low: number; close: number }
        | undefined
      setLegend(d ?? lastC)
    })

    if (showBB) {
      const opt = { color: 'rgba(139,148,163,0.45)', lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false }
      pc.addLineSeries(opt).setData(line(ind.time, ind.bb_upper))
      pc.addLineSeries(opt).setData(line(ind.time, ind.bb_lower))
    }
    if (showMA) {
      pc.addLineSeries({ color: GOLD, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(line(ind.time, ind.ma20))
      pc.addLineSeries({ color: GRAY, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(line(ind.time, ind.ma60))
    }
    pc.timeScale().fitContent()

    // RSI
    if (!simple && rsiRef.current) {
      const rc = createChart(rsiRef.current, { ...base, height: 96 })
      charts.push(rc)
      const r = rc.addLineSeries({ color: ACCENT, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      r.setData(line(ind.time, ind.rsi))
      r.createPriceLine({ price: 70, color: UP, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' })
      r.createPriceLine({ price: 30, color: DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' })
      rc.timeScale().fitContent()
    }

    // MACD
    if (!simple && macdRef.current) {
      const mc = createChart(macdRef.current, { ...base, height: 96 })
      charts.push(mc)
      const h = mc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
      h.setData(
        ind.time
          .map((t, i) => ({ time: t, value: ind.hist[i], color: (ind.hist[i] ?? 0) >= 0 ? UP : DOWN }))
          .filter((d) => d.value != null) as { time: string; value: number; color: string }[],
      )
      mc.addLineSeries({ color: ACCENT, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(line(ind.time, ind.macd))
      mc.addLineSeries({ color: GRAY, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(line(ind.time, ind.signal))
      mc.timeScale().fitContent()
    }

    return () => charts.forEach((c) => c.remove())
  }, [candles, ind, showMA, showBB, light, levels, simple, avgPrice])

  return (
    <div className="space-y-1">
      <div className="relative">
        <div
          ref={legendRef}
          className="absolute top-1 left-1 z-10 font-mono text-[0.62rem] text-muted tnum pointer-events-none"
        />
        <div ref={priceRef} className="w-full h-[280px]" />
      </div>
      {!simple && (
        <>
          <div className="text-[0.62rem] uppercase tracking-[0.06em] text-muted pt-2">RSI (14)</div>
          <div ref={rsiRef} className="w-full h-24" />
          <div className="text-[0.62rem] uppercase tracking-[0.06em] text-muted pt-1">MACD (12·26·9)</div>
          <div ref={macdRef} className="w-full h-24" />
        </>
      )}
    </div>
  )
}
