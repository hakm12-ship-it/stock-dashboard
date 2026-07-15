import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices, getIndicators, getSignal, type Period } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Loading, Empty, ErrorState, Metric } from '../components/ui'
import TechnicalCharts from '../components/TechnicalCharts'
import { fmtQuote } from '../lib/format'

const PERIODS: Period[] = ['1m', '3m', '6m', '1y']
const LABEL: Record<Period, string> = { '1m': '1개월', '3m': '3개월', '6m': '6개월', '1y': '1년' }

export default function TechnicalView({
  t,
  period,
  setPeriod,
  light,
}: {
  t: FocusTicker
  period: Period
  setPeriod: (p: Period) => void
  light: boolean
}) {
  const [showMA, setShowMA] = useState(true)
  const [showBB, setShowBB] = useState(false)
  const [showSR, setShowSR] = useState(true)

  const prices = useQuery({ queryKey: ['prices', t.ticker, period], queryFn: () => getPrices(t.ticker, period) })
  const ind = useQuery({ queryKey: ['ind', t.ticker, period], queryFn: () => getIndicators(t.ticker, period) })
  const sig = useQuery({ queryKey: ['signal', t.ticker], queryFn: () => getSignal(t.ticker) })

  // 현재가에 가까운 지지/저항 각각 2개만 (차트 어지럽지 않게)
  const levels = useMemo(
    () =>
      showSR && sig.data
        ? {
            support: sig.data.support.slice(0, 2).map((x) => x.value),
            resistance: sig.data.resistance.slice(0, 2).map((x) => x.value),
          }
        : undefined,
    [showSR, sig.data],
  )

  const last = prices.data?.[prices.data.length - 1]
  const rsiLast = ind.data?.rsi.filter((v) => v != null).at(-1) as number | undefined
  const macdLast = ind.data?.macd.filter((v) => v != null).at(-1) as number | undefined

  return (
    <div className="space-y-3">
      {/* 기간 선택 */}
      <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              p === period ? 'bg-accent/20 text-text' : 'text-muted'
            }`}
          >
            {LABEL[p]}
          </button>
        ))}
      </div>

      {/* 요약 지표 */}
      <div className="grid grid-cols-3 gap-2">
        <Metric label="현재가" value={last ? fmtQuote(last.close, t) : '—'} />
        <Metric
          label="RSI(14)"
          help="rsi"
          value={rsiLast != null ? rsiLast.toFixed(1) : '—'}
          sub={rsiLast != null ? (rsiLast >= 70 ? '과매수' : rsiLast <= 30 ? '과매도' : '중립') : undefined}
        />
        <Metric label="MACD" help="macd" value={macdLast != null ? macdLast.toFixed(1) : '—'} />
      </div>

      {/* 오버레이 토글 */}
      <div className="flex gap-2 text-xs">
        <Toggle on={showMA} onClick={() => setShowMA((v) => !v)} label="이동평균 20·60" />
        <Toggle on={showBB} onClick={() => setShowBB((v) => !v)} label="볼린저" />
        <Toggle on={showSR} onClick={() => setShowSR((v) => !v)} label="지지·저항" />
      </div>

      {prices.isLoading || ind.isLoading ? (
        <Loading />
      ) : prices.isError || ind.isError ? (
        <ErrorState
          onRetry={() => {
            prices.refetch()
            ind.refetch()
          }}
        />
      ) : prices.data && ind.data && prices.data.length ? (
        <TechnicalCharts candles={prices.data} ind={ind.data} showMA={showMA} showBB={showBB} light={light} levels={levels} />
      ) : (
        <Empty />
      )}
    </div>
  )
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border font-medium transition-colors ${
        on ? 'bg-accent/15 border-accent text-text' : 'bg-surface border-border text-muted'
      }`}
    >
      {label}
    </button>
  )
}
