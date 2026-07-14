import { useQuery } from '@tanstack/react-query'
import { getPrices, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtPrice, changeColor, changeSign } from '../lib/format'

export default function StockHeader({ t, period }: { t: FocusTicker; period: Period }) {
  const { data } = useQuery({
    queryKey: ['prices', t.ticker, period],
    queryFn: () => getPrices(t.ticker, period),
  })
  const last = data?.[data.length - 1]
  const prev = data?.[data.length - 2]
  const chg = last && prev ? last.close - prev.close : 0
  const pct = last && prev && prev.close ? (chg / prev.close) * 100 : 0

  return (
    <div className="pt-1 pb-3 border-b border-border">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-lg font-bold tracking-tight">{t.name}</span>
        <span className="font-mono text-xs text-muted border border-border rounded px-1.5 py-0.5">
          {t.ticker} · {t.market}
        </span>
        {t.kind === 'etf' && (
          <span className="font-mono text-[0.6rem] text-accent border border-accent/40 rounded px-1.5 py-0.5">
            3X ETF
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <span className="font-mono text-3xl font-semibold tnum tracking-tight">
          {last ? fmtPrice(last.close, t.market) : '—'}
        </span>
        {last && prev && (
          <span className={`font-mono text-sm font-semibold ${changeColor(chg)}`}>
            {changeSign(chg)} {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  )
}
