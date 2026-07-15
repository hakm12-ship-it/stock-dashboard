import { useQueries } from '@tanstack/react-query'
import { getPrices } from '../lib/api'
import type { Holding } from '../lib/holdings'
import type { Market } from '../data/tickers'
import { fmtPrice, changeColor, changeSign } from '../lib/format'

export default function PortfolioSummary({
  holdings,
  onManage,
}: {
  holdings: Holding[]
  onManage: () => void
}) {
  const qs = useQueries({
    queries: holdings.map((h) => ({
      queryKey: ['prices', h.ticker, '1m'],
      queryFn: () => getPrices(h.ticker, '1m'),
    })),
  })

  const groups: Record<Market, { cost: number; value: number }> = {
    KR: { cost: 0, value: 0 },
    US: { cost: 0, value: 0 },
  }
  holdings.forEach((h, i) => {
    const last = qs[i].data?.at(-1)?.close
    const cost = h.avg * h.qty
    groups[h.market].cost += cost
    groups[h.market].value += last != null ? last * h.qty : cost
  })
  const rows = (['KR', 'US'] as Market[])
    .filter((m) => groups[m].cost > 0)
    .map((m) => {
      const { cost, value } = groups[m]
      const pl = value - cost
      return { m, value, pl, pct: cost ? (pl / cost) * 100 : 0 }
    })

  return (
    <div className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          내 자산
        </span>
        <button onClick={onManage} className="text-[0.66rem] text-accent active:opacity-70">
          관리
        </button>
      </div>
      {rows.length === 0 ? (
        <button onClick={onManage} className="w-full text-sm text-muted py-1.5 text-left">
          보유종목을 추가해 손익을 확인하세요 →
        </button>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.m} className="flex items-center justify-between">
              <span className="text-xs text-muted">{r.m === 'KR' ? '🇰🇷 한국' : '🇺🇸 미국'}</span>
              <div className="text-right">
                <div className="font-mono font-semibold tnum text-sm">{fmtPrice(r.value, r.m)}</div>
                <div className={`font-mono text-[0.72rem] ${changeColor(r.pl)}`}>
                  {changeSign(r.pl)} {Math.abs(r.pct).toFixed(2)}% ({fmtPrice(Math.abs(r.pl), r.m)})
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
