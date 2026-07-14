import { useEffect, useRef } from 'react'
import { createChart, ColorType, type IChartApi } from 'lightweight-charts'
import type { Candle, Indicators } from '../lib/api'

const UP = '#F23645'
const DOWN = '#2E86FF'
const GOLD = '#E0B84D'
const GRAY = '#8B94A3'
const ACCENT = '#E0A63C'

const base = {
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: '#8B94A3',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 10,
  },
  grid: {
    vertLines: { color: 'rgba(35,40,51,0.4)' },
    horzLines: { color: 'rgba(35,40,51,0.4)' },
  },
  rightPriceScale: { borderColor: '#232833' },
  timeScale: { borderColor: '#232833', timeVisible: false },
  crosshair: { mode: 1 as const },
  autoSize: true,
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
}: {
  candles: Candle[]
  ind: Indicators
  showMA: boolean
  showBB: boolean
}) {
  const priceRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!candles.length || !priceRef.current) return
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
    if (rsiRef.current) {
      const rc = createChart(rsiRef.current, { ...base, height: 96 })
      charts.push(rc)
      const r = rc.addLineSeries({ color: ACCENT, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      r.setData(line(ind.time, ind.rsi))
      r.createPriceLine({ price: 70, color: UP, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' })
      r.createPriceLine({ price: 30, color: DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' })
      rc.timeScale().fitContent()
    }

    // MACD
    if (macdRef.current) {
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
  }, [candles, ind, showMA, showBB])

  return (
    <div className="space-y-1">
      <div ref={priceRef} className="w-full h-[280px]" />
      <div className="text-[0.62rem] uppercase tracking-[0.06em] text-muted pt-2">RSI (14)</div>
      <div ref={rsiRef} className="w-full h-24" />
      <div className="text-[0.62rem] uppercase tracking-[0.06em] text-muted pt-1">MACD (12·26·9)</div>
      <div ref={macdRef} className="w-full h-24" />
    </div>
  )
}
