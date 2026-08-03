import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createChart, ColorType, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { getNightCandles, type NightInterval } from '../lib/api'

const UP = '#F23645'
const DOWN = '#2E86FF'

const INTERVALS: [NightInterval, string][] = [
  ['5m', '5분'],
  ['15m', '15분'],
  ['60m', '60분'],
  ['1d', '일'],
]

export default function NightCandleChart({ ticker, light }: { ticker: string; light: boolean }) {
  // 이름을 interval/setInterval로 두면 전역 setInterval을 가려서, 나중에 이
  // 컴포넌트에 타이머를 넣을 때 조용히 깨진다. tf(timeframe)로 부른다.
  const [tf, setTf] = useState<NightInterval>('5m')
  const { data } = useQuery({
    queryKey: ['night-candles', ticker, tf],
    queryFn: () => getNightCandles(ticker, tf),
  })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !data?.candles.length) return
    const text = light ? '#5C6672' : '#8B94A3'
    const grid = light ? 'rgba(22,27,38,0.07)' : 'rgba(35,40,51,0.4)'
    const bd = light ? '#E0E3E8' : '#232833'
    const chart: IChartApi = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontFamily: '"IBM Plex Mono", monospace', fontSize: 10 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: bd },
      timeScale: { borderColor: bd, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
      height: 220,
    })
    const cs = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
    })
    cs.setData(
      data.candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      })),
    )
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [data, light])

  return (
    <div>
      {/* 터치타겟 44px 이상 (모바일 우선 원칙) */}
      <div className="flex gap-1 mb-1.5">
        {INTERVALS.map(([iv, label]) => (
          <button
            key={iv}
            onClick={() => setTf(iv)}
            className={`font-mono text-[0.7rem] min-w-[44px] min-h-[44px] px-3 rounded-lg transition-colors ${
              tf === iv ? 'bg-accent/15 text-accent font-semibold' : 'text-muted/70 active:bg-surface-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {data?.available && data.candles.length > 0 ? (
        <div ref={ref} className="w-full" />
      ) : (
        <div className="h-[220px] rounded bg-surface-2 animate-pulse" />
      )}
      <p className="text-[0.6rem] text-muted mt-1">출처 · Hyperliquid HIP-3(xyz dex) · KRW 환산 캔들</p>
    </div>
  )
}
