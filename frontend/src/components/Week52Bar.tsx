import { useQuery } from '@tanstack/react-query'
import { getPrices } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtQuote } from '../lib/format'

export default function Week52Bar({ t }: { t: FocusTicker }) {
  const { data } = useQuery({
    queryKey: ['prices', t.ticker, '1y'],
    queryFn: () => getPrices(t.ticker, '1y'),
  })
  if (!data || data.length < 2) return null

  const high = Math.max(...data.map((c) => c.high))
  const low = Math.min(...data.map((c) => c.low))
  const cur = data[data.length - 1].close
  const pos = high > low ? ((cur - low) / (high - low)) * 100 : 50
  const clamped = Math.min(100, Math.max(0, pos))

  return (
    <div className="pt-2">
      <div className="flex justify-between text-[0.62rem] text-muted mb-1.5 font-mono">
        <span>52주 최저 {fmtQuote(low, t)}</span>
        <span>52주 최고 {fmtQuote(high, t)}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-accent border-2 border-ink card-shadow"
          style={{ left: `calc(${clamped}% - 6px)` }}
        />
      </div>
      <div className="text-center text-[0.6rem] text-muted mt-1.5">
        1년 범위의 {clamped.toFixed(0)}% 지점
      </div>
    </div>
  )
}
