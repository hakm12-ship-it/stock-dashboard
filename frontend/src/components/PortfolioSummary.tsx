import { useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { getPrices, getFx } from '../lib/api'
import type { Holding } from '../lib/holdings'
import type { Market } from '../data/tickers'
import { fmtPrice, fmtNum, changeColor, changeSign } from '../lib/format'
import PortfolioChart from './PortfolioChart'

export default function PortfolioSummary({
  holdings,
  light,
  onManage,
  onJournal,
}: {
  holdings: Holding[]
  light: boolean
  onManage: () => void
  onJournal: () => void
}) {
  const [chartOpen, setChartOpen] = useState(false)
  const qs = useQueries({
    queries: holdings.map((h) => ({
      queryKey: ['prices', h.ticker, '1m'],
      queryFn: () => getPrices(h.ticker, '1m'),
    })),
  })
  const fx = useQuery({ queryKey: ['fx'], queryFn: getFx, enabled: holdings.length > 0 })
  const rate = fx.data?.usdkrw

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

  const hasHoldings = rows.length > 0
  const hasUS = groups.US.cost > 0
  const canUnify = !hasUS || rate != null
  const uniCost = groups.KR.cost + (rate ? groups.US.cost * rate : 0)
  const uniValue = groups.KR.value + (rate ? groups.US.value * rate : 0)
  const uniPL = uniValue - uniCost
  const uniPct = uniCost ? (uniPL / uniCost) * 100 : 0

  return (
    <div className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          내 자산
        </span>
        <div className="flex gap-3">
          <button onClick={onJournal} className="text-[0.66rem] text-muted active:opacity-70">
            일지
          </button>
          <button onClick={onManage} className="text-[0.66rem] text-accent active:opacity-70">
            관리
          </button>
        </div>
      </div>

      {!hasHoldings ? (
        <button onClick={onManage} className="w-full text-sm text-muted py-1.5 text-left">
          보유종목을 추가해 손익을 확인하세요 →
        </button>
      ) : (
        <>
          {canUnify && (
            <div className="mb-3">
              <div className="text-[0.62rem] text-muted">총 평가 (원 환산)</div>
              <div className="font-mono text-2xl font-semibold tnum leading-tight">
                {fmtPrice(uniValue, 'KR')}
              </div>
              <div className={`font-mono text-sm ${changeColor(uniPL)}`}>
                {changeSign(uniPL)} {Math.abs(uniPct).toFixed(2)}% ({fmtPrice(Math.abs(uniPL), 'KR')})
              </div>
            </div>
          )}

          {rows.length > 1 && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              {rows.map((r) => (
                <div key={r.m} className="flex items-center justify-between">
                  <span className="text-xs text-muted">{r.m === 'KR' ? '🇰🇷 한국' : '🇺🇸 미국'}</span>
                  <div className="text-right">
                    <span className="font-mono tnum text-sm">{fmtPrice(r.value, r.m)}</span>
                    <span className={`font-mono text-[0.72rem] ml-2 ${changeColor(r.pl)}`}>
                      {changeSign(r.pl)} {Math.abs(r.pct).toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {rate != null && (
            <div className="text-[0.62rem] text-muted mt-2 font-mono">
              USD/KRW {fmtNum(rate, 1)}
              {fx.data && (
                <span className={changeColor(fx.data.change)}>
                  {' '}
                  {changeSign(fx.data.change)} {Math.abs(fx.data.changePct).toFixed(2)}%
                </span>
              )}
            </div>
          )}

          <button
            onClick={() => setChartOpen((v) => !v)}
            className="w-full text-[0.66rem] text-accent text-center mt-2 active:opacity-70"
          >
            {chartOpen ? '자산 추이 접기 ▴' : '자산 추이 차트 보기 ▾'}
          </button>
          {chartOpen && <PortfolioChart holdings={holdings} light={light} />}
        </>
      )}
    </div>
  )
}
