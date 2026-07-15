import { useQuery } from '@tanstack/react-query'
import { getPrices, getIndex, getProfile, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtQuote, changeColor, changeSign } from '../lib/format'
import { marketStatus } from '../lib/market'

export default function StockHeader({ t, period }: { t: FocusTicker; period: Period }) {
  const isIndex = t.kind === 'index' && !!t.indexName
  const prices = useQuery({
    queryKey: ['prices', t.ticker, period],
    queryFn: () => getPrices(t.ticker, period),
  })
  const idx = useQuery({
    queryKey: ['index', t.indexName],
    queryFn: () => getIndex(t.indexName as string),
    enabled: isIndex,
  })
  const profile = useQuery({
    queryKey: ['profile', t.market, t.ticker],
    queryFn: () => getProfile(t.market, t.ticker),
    enabled: t.market === 'KR' && t.kind !== 'index',
  })
  const logo = profile.data?.logo

  const last = prices.data?.[prices.data.length - 1]
  const prev = prices.data?.[prices.data.length - 2]

  // 지수는 실시간 API 값을, 그 외는 일봉 마지막 값을 사용
  let priceVal: number | undefined
  let chg = 0
  let pct = 0
  let hasChange = false
  if (isIndex && idx.data) {
    priceVal = idx.data.last
    chg = idx.data.change
    pct = idx.data.changePct
    hasChange = true
  } else if (last) {
    priceVal = last.close
    if (prev) {
      chg = last.close - prev.close
      pct = prev.close ? (chg / prev.close) * 100 : 0
      hasChange = true
    }
  }

  return (
    <div className="pt-1 pb-3 border-b border-border">
      <div className="flex items-center gap-2 flex-wrap">
        {logo && (
          <img
            src={logo}
            alt=""
            className="h-6 w-6 rounded-full border border-border bg-surface object-contain"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        )}
        <span className="text-lg font-bold tracking-tight">{t.name}</span>
        <span className="font-mono text-xs text-muted border border-border rounded px-1.5 py-0.5">
          {t.ticker} · {t.market}
        </span>
        {t.kind === 'etf' && (
          <span className="font-mono text-[0.6rem] text-accent border border-accent/40 rounded px-1.5 py-0.5">
            {t.lev ? `${t.lev} ETF` : 'ETF'}
          </span>
        )}
        {t.kind === 'index' && (
          <span className="font-mono text-[0.6rem] text-muted border border-border rounded px-1.5 py-0.5">
            지수
          </span>
        )}
        {(() => {
          const st = marketStatus(t.market)
          return (
            <span className={`flex items-center gap-1 text-[0.62rem] ${st.open ? 'text-accent' : 'text-muted'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${st.open ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
              {st.label}
            </span>
          )
        })()}
      </div>
      <div className="flex items-baseline gap-3 mt-2">
        <span className="font-mono text-3xl font-semibold tnum tracking-tight">
          {fmtQuote(priceVal, t)}
        </span>
        {hasChange && (
          <span className={`font-mono text-sm font-semibold ${changeColor(chg)}`}>
            {changeSign(chg)} {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  )
}
