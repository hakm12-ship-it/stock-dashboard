import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices, getValuation, getSignal, type Period, type Candle } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtQuote, fmtNum, fmtPct, changeColor } from '../lib/format'
import { loadSignalConfig, cfgKey, cfgParams } from '../lib/signalConfig'
import { ChartFallback, Sheet, Loading, ErrorState, Empty } from './ui'

// 차트 라이브러리가 무거워서 비교 시트를 열 때만 받는다.
const CompareChart = lazy(() => import('./CompareChart'))

const PERIODS: Period[] = ['1m', '3m', '6m', '1y']
const LABEL: Record<Period, string> = { '1m': '1개월', '3m': '3개월', '6m': '6개월', '1y': '1년' }
// 종목 구분색은 상승·하락 색(빨강·파랑)과 겹치지 않게 흑백·주황으로 둔다.
const colorsFor = (light: boolean) => (light ? ['#191F28', '#E08A00'] : ['#E4E4E5', '#F5A524'])

function useTickerData(t: FocusTicker | undefined, period: Period) {
  const prices = useQuery({
    queryKey: ['prices', t?.ticker, period],
    queryFn: () => getPrices(t!.ticker, period),
    enabled: !!t,
  })
  const val = useQuery({
    queryKey: ['val', t?.market, t?.ticker],
    queryFn: () => getValuation(t!.market, t!.ticker),
    enabled: !!t && t.kind === 'stock',
  })
  const cfg = loadSignalConfig()
  const sig = useQuery({
    queryKey: ['signal', t?.ticker, cfgKey(cfg)],
    queryFn: () => getSignal(t!.ticker, cfgParams(cfg)),
    enabled: !!t,
  })
  return { prices, val, sig }
}

const normalized = (data?: Candle[]) => {
  if (!data || !data.length || !data[0].close) return []
  const base = data[0].close
  return data.map((c) => ({ time: c.time, value: (c.close / base - 1) * 100 }))
}
const periodReturn = (data?: Candle[]) =>
  !data || data.length < 2 ? null : (data[data.length - 1].close / data[0].close - 1) * 100

export default function ComparisonSheet({
  tickers,
  light,
  onClose,
}: {
  tickers: FocusTicker[]
  light: boolean
  onClose: () => void
}) {
  const key = (t: FocusTicker) => `${t.market}-${t.ticker}`
  const [aKey, setAKey] = useState(key(tickers[0]))
  const [bKey, setBKey] = useState(key(tickers[1] ?? tickers[0]))
  const [period, setPeriod] = useState<Period>('3m')

  const a = tickers.find((t) => key(t) === aKey)
  const b = tickers.find((t) => key(t) === bKey)
  const da = useTickerData(a, period)
  const db = useTickerData(b, period)

  const [CA, CB] = colorsFor(light)
  const series = useMemo(
    () => [
      { name: a?.short ?? '', color: CA, data: normalized(da.prices.data) },
      { name: b?.short ?? '', color: CB, data: normalized(db.prices.data) },
    ],
    [a?.short, b?.short, CA, CB, da.prices.data, db.prices.data],
  )

  const priceStr = (d: typeof da, t?: FocusTicker) => {
    const last = d.prices.data?.at(-1)?.close
    return last != null && t ? fmtQuote(last, t) : '—'
  }
  const retVal = (d: typeof da) => periodReturn(d.prices.data)
  const retStr = (r: number | null) => fmtPct(r)

  const Select = ({
    value,
    other,
    label,
    onChange,
  }: {
    value: string
    other: string
    label: string
    onChange: (v: string) => void
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="field compare-select">
      {tickers.map((t) => (
        <option key={key(t)} value={key(t)} disabled={key(t) === other}>
          {t.short}
        </option>
      ))}
    </select>
  )

  const Cell = ({ children, color }: { children: ReactNode; color?: string }) => (
    <td className="text-right py-2 font-mono tnum" style={color ? { color } : undefined}>
      {children}
    </td>
  )

  const ra = retVal(da)
  const rb = retVal(db)

  return (
    <Sheet title="종목 비교" onClose={onClose}>
      {/* 종목 선택 */}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CA }} aria-hidden="true" />
        <Select value={aKey} other={bKey} label="첫 번째 비교 종목" onChange={setAKey} />
        <span className="text-muted text-xs shrink-0 whitespace-nowrap">대</span>
        <Select value={bKey} other={aKey} label="두 번째 비교 종목" onChange={setBKey} />
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CB }} aria-hidden="true" />
      </div>

      {/* 기간 */}
      <div className="segmented segmented--block" role="group" aria-label="비교 기간">
        {PERIODS.map((p) => (
          <button key={p} onClick={() => setPeriod(p)} aria-pressed={p === period}>
            {LABEL[p]}
          </button>
        ))}
      </div>

      {/* 수익률 차트 */}
      <div className="bg-surface border border-border rounded-xl p-3 card-shadow">
        <div className="text-label text-muted mb-1">기간 수익률 비교 (시작점 0%)</div>
        {da.prices.isLoading || db.prices.isLoading ? (
          <Loading />
        ) : da.prices.isError || db.prices.isError ? (
          <ErrorState
            onRetry={() => {
              void da.prices.refetch()
              void db.prices.refetch()
            }}
          />
        ) : series.some((s) => s.data.length === 0) ? (
          <Empty label="비교할 가격 데이터가 부족합니다" />
        ) : (
          <Suspense fallback={<ChartFallback height={200} />}>
            <CompareChart series={series} light={light} />
          </Suspense>
        )}
      </div>

      {/* 지표 표 */}
      <div className="bg-surface border border-border rounded-xl px-4 py-2 card-shadow">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-label text-muted">
              <th className="text-left font-medium py-2">지표</th>
              <th className="text-right font-medium text-text">
                <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: CA }} aria-hidden="true" />
                {a?.short}
              </th>
              <th className="text-right font-medium text-text">
                <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: CB }} aria-hidden="true" />
                {b?.short}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="text-muted py-2">현재가</td>
              <Cell>{priceStr(da, a)}</Cell>
              <Cell>{priceStr(db, b)}</Cell>
            </tr>
            <tr className="border-t border-border">
              <td className="text-muted py-2">기간 수익률</td>
              <td className={`text-right py-2 font-mono tnum ${ra != null ? changeColor(ra) : ''}`}>
                {retStr(ra)}
              </td>
              <td className={`text-right py-2 font-mono tnum ${rb != null ? changeColor(rb) : ''}`}>
                {retStr(rb)}
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="text-muted py-2">신호</td>
              <Cell>{da.sig.data?.verdict ?? '—'}</Cell>
              <Cell>{db.sig.data?.verdict ?? '—'}</Cell>
            </tr>
            <tr className="border-t border-border">
              <td className="text-muted py-2">PER</td>
              <Cell>{fmtNum(da.val.data?.PER, 1)}</Cell>
              <Cell>{fmtNum(db.val.data?.PER, 1)}</Cell>
            </tr>
            <tr className="border-t border-border">
              <td className="text-muted py-2">PBR</td>
              <Cell>{fmtNum(da.val.data?.PBR, 2)}</Cell>
              <Cell>{fmtNum(db.val.data?.PBR, 2)}</Cell>
            </tr>
            <tr className="border-t border-border">
              <td className="text-muted py-2">ROE</td>
              <Cell>{da.val.data?.ROE != null ? `${(da.val.data.ROE * 100).toFixed(1)}%` : '—'}</Cell>
              <Cell>{db.val.data?.ROE != null ? `${(db.val.data.ROE * 100).toFixed(1)}%` : '—'}</Cell>
            </tr>
          </tbody>
        </table>
      </div>
    </Sheet>
  )
}
