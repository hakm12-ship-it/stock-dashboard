import { useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { getPrices, getSignal, getIndex } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import IndexStrip from '../components/IndexStrip'
import PortfolioSummary from '../components/PortfolioSummary'
import type { Holding } from '../lib/holdings'
import { fmtQuote, changeColor, changeSign } from '../lib/format'

const UP = '#F23645'
const DOWN = '#2E86FF'

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return <div className="h-8" />
  const w = 120
  const h = 32
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? UP : DOWN} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const VERDICT_COLOR: Record<string, string> = {
  '매수 우위': 'text-up',
  '매도 우위': 'text-down',
  중립: 'text-muted',
}

function HomeCard({ t, onClick }: { t: FocusTicker; onClick: () => void }) {
  const isIndex = t.kind === 'index' && !!t.indexName
  const prices = useQuery({ queryKey: ['prices', t.ticker, '1m'], queryFn: () => getPrices(t.ticker, '1m') })
  const sig = useQuery({ queryKey: ['signal', t.ticker], queryFn: () => getSignal(t.ticker) })
  const idx = useQuery({
    queryKey: ['index', t.indexName],
    queryFn: () => getIndex(t.indexName as string),
    enabled: isIndex,
  })

  const series = prices.data?.map((c) => c.close) ?? []
  const last = prices.data?.at(-1)
  const prev = prices.data?.at(-2)

  // 지수는 실시간 값, 그 외는 일봉 마지막
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
  const up = hasChange ? chg >= 0 : series.length > 1 ? series[series.length - 1] >= series[0] : true

  return (
    <button
      onClick={onClick}
      className="w-full bg-surface border border-border rounded-xl p-3.5 card-shadow active:bg-surface-2 active:scale-[0.99] text-left transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold truncate">{t.short}</span>
            {t.kind === 'etf' && <span className="font-mono text-[0.55rem] text-accent">3X</span>}
            {t.kind === 'index' && <span className="font-mono text-[0.55rem] text-muted">지수</span>}
          </div>
          <div className="font-mono text-[0.65rem] text-muted mt-0.5">{t.ticker}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono font-semibold tnum text-[0.95rem]">{fmtQuote(priceVal, t)}</div>
          {hasChange && (
            <div className={`font-mono text-[0.72rem] ${changeColor(chg)}`}>
              {changeSign(chg)} {Math.abs(pct).toFixed(2)}%
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 min-w-0">
          <Sparkline data={series} up={up} />
        </div>
        {sig.data && (
          <span className={`font-mono text-[0.7rem] font-semibold shrink-0 ${VERDICT_COLOR[sig.data.verdict] ?? 'text-muted'}`}>
            {sig.data.verdict}
          </span>
        )}
      </div>
    </button>
  )
}

export default function HomeView({
  tickers,
  holdings,
  onSelect,
  onAddClick,
  onManageHoldings,
}: {
  tickers: FocusTicker[]
  holdings: Holding[]
  onSelect: (t: FocusTicker) => void
  onAddClick: () => void
  onManageHoldings: () => void
}) {
  const [sort, setSort] = useState<'default' | 'gainers' | 'losers'>('default')

  // 정렬용 등락률 (카드와 같은 쿼리키 → 캐시 공유, 중복 요청 없음)
  const priceQs = useQueries({
    queries: tickers.map((t) => ({
      queryKey: ['prices', t.ticker, '1m'],
      queryFn: () => getPrices(t.ticker, '1m'),
    })),
  })
  const items = tickers.map((t, i) => {
    const d = priceQs[i].data
    const last = d?.at(-1)
    const prev = d?.at(-2)
    const pct = last && prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null
    return { t, pct }
  })
  const ordered =
    sort === 'default'
      ? items
      : [...items].sort((a, b) => {
          const av = a.pct ?? (sort === 'gainers' ? -Infinity : Infinity)
          const bv = b.pct ?? (sort === 'gainers' ? -Infinity : Infinity)
          return sort === 'gainers' ? bv - av : av - bv
        })

  const SORTS: [typeof sort, string][] = [
    ['default', '기본'],
    ['gainers', '상승순'],
    ['losers', '하락순'],
  ]

  return (
    <div className="space-y-2">
      <PortfolioSummary holdings={holdings} onManage={onManageHoldings} />
      <IndexStrip />
      <div className="flex items-center justify-between pt-2 pb-0.5">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          관심 종목
        </span>
        <div className="flex gap-1">
          {SORTS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`text-[0.66rem] px-2 py-1 rounded-md transition-colors ${
                sort === k ? 'bg-accent/15 text-accent' : 'text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {ordered.map(({ t }) => (
        <HomeCard key={`${t.market}-${t.ticker}`} t={t} onClick={() => onSelect(t)} />
      ))}
      <button
        onClick={onAddClick}
        className="w-full border border-dashed border-border rounded-xl py-3 text-muted text-sm active:bg-surface transition-colors"
      >
        + 종목 추가
      </button>
    </div>
  )
}
