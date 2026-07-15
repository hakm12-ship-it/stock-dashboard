import { useEffect, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { createChart, ColorType, type IChartApi } from 'lightweight-charts'
import { getPrices, getFxHistory, type Period, type Candle, type FxPoint } from '../lib/api'
import type { Holding } from '../lib/holdings'
import { changeColor, changeSign } from '../lib/format'

const PERIODS: Period[] = ['1m', '3m', '6m']
const LABEL: Record<string, string> = { '1m': '1개월', '3m': '3개월', '6m': '6개월' }

const hk = (h: Holding) => `${h.market}-${h.ticker}`

// 보유수량 × 과거 종가(+과거 환율)로 원화 가치 곡선 계산 (거래일 차이는 직전값으로 보간)
function buildCurve(
  holdings: Holding[],
  priceMap: Map<string, Candle[]>,
  fx: FxPoint[] | null,
): { time: string; value: number }[] {
  const dates = new Set<string>()
  priceMap.forEach((cs) => cs.forEach((c) => dates.add(c.time)))
  const sorted = [...dates].sort()

  const ptr = new Map<string, number>()
  const lastPx = new Map<string, number>()
  let fxi = 0
  let lastFx: number | null = null
  const out: { time: string; value: number }[] = []

  for (const d of sorted) {
    while (fx && fxi < fx.length && fx[fxi].time <= d) {
      lastFx = fx[fxi].rate
      fxi++
    }
    let total = 0
    let ok = true
    for (const h of holdings) {
      const key = hk(h)
      const cs = priceMap.get(key)
      if (!cs) {
        ok = false
        break
      }
      let i = ptr.get(key) ?? 0
      while (i < cs.length && cs[i].time <= d) {
        lastPx.set(key, cs[i].close)
        i++
      }
      ptr.set(key, i)
      const p = lastPx.get(key)
      if (p == null) {
        ok = false
        break
      }
      if (h.market === 'US') {
        if (lastFx == null) {
          ok = false
          break
        }
        total += p * h.qty * lastFx
      } else {
        total += p * h.qty
      }
    }
    if (ok) out.push({ time: d, value: total })
  }
  return out
}

const fmtAxis = (v: number) =>
  v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4)}만` : String(Math.round(v))

export default function PortfolioChart({ holdings, light }: { holdings: Holding[]; light: boolean }) {
  const [period, setPeriod] = useState<Period>('3m')
  const ref = useRef<HTMLDivElement>(null)
  const hasUS = holdings.some((h) => h.market === 'US')

  const qs = useQueries({
    queries: holdings.map((h) => ({
      queryKey: ['prices', h.ticker, period],
      queryFn: () => getPrices(h.ticker, period),
    })),
  })
  const fxq = useQuery({
    queryKey: ['fxhist', period],
    queryFn: () => getFxHistory(period),
    enabled: hasUS,
  })

  const ready = qs.every((q) => q.data) && (!hasUS || fxq.data)
  const priceMap = new Map<string, Candle[]>()
  if (ready) holdings.forEach((h, i) => priceMap.set(hk(h), qs[i].data as Candle[]))
  const curve = ready ? buildCurve(holdings, priceMap, hasUS ? (fxq.data as FxPoint[]) : null) : []

  useEffect(() => {
    if (!ref.current || curve.length < 2) return
    const text = light ? '#5C6672' : '#8B94A3'
    const grid = light ? 'rgba(22,27,38,0.07)' : 'rgba(35,40,51,0.4)'
    const bd = light ? '#E0E3E8' : '#232833'
    const chart: IChartApi = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: text,
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: bd },
      timeScale: { borderColor: bd, timeVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
    })
    const s = chart.addAreaSeries({
      lineColor: '#E0A63C',
      lineWidth: 2,
      topColor: 'rgba(224,166,60,0.22)',
      bottomColor: 'rgba(224,166,60,0.02)',
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: fmtAxis },
    })
    s.setData(curve)
    chart.timeScale().fitContent()
    return () => chart.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(curve.at(0)) + JSON.stringify(curve.at(-1)) + curve.length, light])

  const ret = curve.length >= 2 ? (curve[curve.length - 1].value / curve[0].value - 1) * 100 : null

  return (
    <div className="pt-3 mt-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.62rem] text-muted">
          자산 추이
          {ret != null && (
            <span className={`font-mono ml-2 ${changeColor(ret)}`}>
              {changeSign(ret)} {Math.abs(ret).toFixed(2)}%
            </span>
          )}
        </span>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`font-mono text-[0.6rem] px-1.5 py-0.5 rounded ${
                p === period ? 'bg-accent/15 text-accent' : 'text-muted/70'
              }`}
            >
              {LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      {curve.length >= 2 ? (
        <div ref={ref} className="w-full h-36" />
      ) : (
        <div className="h-36 rounded-lg shimmer" />
      )}
      <p className="text-[0.58rem] text-muted mt-1.5">
        현재 보유 수량으로 과거를 환산한 곡선이에요 — 실제 매수 시점·현금흐름은 반영되지 않아요.
      </p>
    </div>
  )
}
