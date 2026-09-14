import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { chartBase, chartColors, priceFormatFor } from '../lib/chartTheme'
import { Empty } from './ui'
import { getNightCandles, type NightInterval } from '../lib/api'

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
    // 분봉이라 시각까지 보여준다
    const c = chartColors(light)
    const chart: IChartApi = createChart(ref.current, { ...chartBase(light, true), height: 220 })
    const cs = chart.addCandlestickSeries({
      upColor: c.up, downColor: c.down, borderVisible: false, wickUpColor: c.up, wickDownColor: c.down,
      priceFormat: priceFormatFor('KR', 'stock'),
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
            aria-pressed={tf === iv}
            className={`choice-button ${tf === iv ? 'is-selected' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      {data?.available && data.candles.length > 0 ? (
        <div ref={ref} className="w-full" />
      ) : data ? (
        <Empty label="야간 시세를 지금 불러올 수 없어요" />
      ) : (
        <div className="h-[220px] rounded bg-surface-2 animate-pulse" />
      )}
      <p className="text-label text-muted mt-1">장 마감 뒤 해외 무기한 선물(Hyperliquid) 가격을 원화로 환산한 캔들</p>
    </div>
  )
}
