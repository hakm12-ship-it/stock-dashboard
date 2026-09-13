import { lazy, Suspense, useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { getPrices, getFx } from '../lib/api'
import type { Holding } from '../lib/holdings'
import type { Market } from '../data/tickers'
import { fmtPrice, fmtNum, fmtChange, changeColor } from '../lib/format'
import { ChartFallback } from './ui'

// 차트 라이브러리(lightweight-charts)는 무거워서 실제로 펼칠 때만 받는다.
const PortfolioChart = lazy(() => import('./PortfolioChart'))

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
  const hasMissingPrices = holdings.some((_, i) => !qs[i].data?.length)

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
  const canUnify = !hasMissingPrices && (!hasUS || rate != null)
  const uniCost = groups.KR.cost + (rate ? groups.US.cost * rate : 0)
  const uniValue = groups.KR.value + (rate ? groups.US.value * rate : 0)
  const uniPL = uniValue - uniCost
  const uniPct = uniCost ? (uniPL / uniCost) * 100 : 0

  return (
    <div className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-label font-semibold uppercase tracking-[0.08em] text-muted">내 자산</span>
        {/* -my-3로 탭 영역만 넓히고 줄 높이는 유지 (터치타겟 44px) */}
        <div className="flex gap-3 -my-3">
          <button
            onClick={onJournal}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-label text-muted active:opacity-70"
          >
            매매일지
          </button>
          <button
            onClick={onManage}
            className="min-w-[44px] min-h-[44px] flex items-center justify-end text-label text-text active:opacity-70"
          >
            보유 관리
          </button>
        </div>
      </div>

      {!hasHoldings ? (
        <button
          onClick={onManage}
          className="w-full min-h-[44px] flex items-center text-sm text-muted text-left"
        >
          보유종목 등록하고 손익 확인 →
        </button>
      ) : (
        <>
          {!canUnify && (
            <div className="py-3 text-sm text-muted" role="status">
              {qs.some((q) => q.isFetching) || fx.isFetching
                ? '평가에 필요한 시세와 환율을 조회하고 있습니다.'
                : '시세 또는 환율이 없어 평가액을 계산할 수 없습니다.'}
              <button
                className="button button-quiet mt-2"
                onClick={() => {
                  qs.forEach((q) => void q.refetch())
                  void fx.refetch()
                }}
              >
                다시 조회
              </button>
            </div>
          )}
          {canUnify && (
            <div className="mb-3">
              <div className="text-label text-muted">총 평가 (원 환산)</div>
              <div className="font-mono text-2xl font-semibold tnum leading-tight">
                {fmtPrice(uniValue, 'KR')}
              </div>
              <div className={`font-mono text-sm ${changeColor(uniPL)}`}>
                {fmtChange(uniPct, uniPL)} ({fmtPrice(Math.abs(uniPL), 'KR')})
              </div>
            </div>
          )}

          {!hasMissingPrices && (rows.length > 1 || !canUnify) && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              {rows.map((r) => (
                <div key={r.m} className="flex items-center justify-between">
                  <span className="text-xs text-muted">{r.m === 'KR' ? '🇰🇷 한국' : '🇺🇸 미국'}</span>
                  <div className="text-right">
                    <span className="font-mono tnum text-sm">{fmtPrice(r.value, r.m)}</span>
                    <span className={`font-mono text-label ml-2 ${changeColor(r.pl)}`}>
                      {fmtChange(r.pct, r.pl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {rate != null && (
            <div className="text-label text-muted mt-2 font-mono">
              USD/KRW {fmtNum(rate, 1)}
              {fx.data && (
                <span className={changeColor(fx.data.change)}>
                  {' '}
                  {fmtChange(fx.data.changePct, fx.data.change)}
                </span>
              )}
            </div>
          )}

          <button
            onClick={() => setChartOpen((v) => !v)}
            className="w-full text-label text-muted text-center mt-2 active:opacity-70"
          >
            {chartOpen ? '자산 추이 접기 ▴' : '자산 추이 차트 보기 ▾'}
          </button>
          {chartOpen && (
            <Suspense fallback={<ChartFallback height={180} />}>
              <PortfolioChart holdings={holdings} light={light} />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
