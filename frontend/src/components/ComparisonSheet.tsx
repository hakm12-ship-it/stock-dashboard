import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices, getValuation, getSignal, type Period, type Candle } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { fmtQuote, fmtNum, changeColor } from '../lib/format'
import CompareChart from './CompareChart'

const PERIODS: Period[] = ['1m', '3m', '6m', '1y']
const LABEL: Record<Period, string> = { '1m': '1개월', '3m': '3개월', '6m': '6개월', '1y': '1년' }
const CA = '#E0A63C'
const CB = '#3B82F6'

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
  const sig = useQuery({ queryKey: ['signal', t?.ticker], queryFn: () => getSignal(t!.ticker), enabled: !!t })
  return { prices, val, sig }
}

const normalized = (data?: Candle[]) => {
  if (!data || !data.length) return []
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

  const series = [
    { name: a?.short ?? '', color: CA, data: normalized(da.prices.data) },
    { name: b?.short ?? '', color: CB, data: normalized(db.prices.data) },
  ]

  const priceStr = (d: typeof da, t?: FocusTicker) => {
    const last = d.prices.data?.at(-1)?.close
    return last != null && t ? fmtQuote(last, t) : '—'
  }
  const retVal = (d: typeof da) => periodReturn(d.prices.data)
  const retStr = (r: number | null) => (r == null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`)

  const Select = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-ink border border-border rounded-lg px-2.5 py-2 text-sm text-text"
    >
      {tickers.map((t) => (
        <option key={key(t)} value={key(t)}>
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
    <div className="fixed inset-0 z-50 bg-ink flex flex-col fade-in">
      <div className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border">
        <span className="text-base font-bold">종목 비교</span>
        <button onClick={onClose} className="text-muted text-2xl leading-none px-2 active:text-text">
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 pb-10">
        {/* 종목 선택 */}
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CA }} />
          <Select value={aKey} onChange={setAKey} />
          <span className="text-muted text-xs">vs</span>
          <Select value={bKey} onChange={setBKey} />
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: CB }} />
        </div>

        {/* 기간 */}
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium ${
                p === period ? 'bg-accent/20 text-text' : 'text-muted'
              }`}
            >
              {LABEL[p]}
            </button>
          ))}
        </div>

        {/* 수익률 차트 */}
        <div className="bg-surface border border-border rounded-xl p-3 card-shadow">
          <div className="text-[0.66rem] text-muted mb-1">기간 수익률 비교 (시작점 0%)</div>
          <CompareChart series={series} light={light} />
        </div>

        {/* 지표 표 */}
        <div className="bg-surface border border-border rounded-xl px-4 py-2 card-shadow">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[0.66rem] text-muted uppercase tracking-wide">
                <th className="text-left font-medium py-2">지표</th>
                <th className="text-right font-medium" style={{ color: CA }}>
                  {a?.short}
                </th>
                <th className="text-right font-medium" style={{ color: CB }}>
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
                <td className={`text-right py-2 font-mono tnum ${ra != null ? changeColor(ra) : ''}`}>{retStr(ra)}</td>
                <td className={`text-right py-2 font-mono tnum ${rb != null ? changeColor(rb) : ''}`}>{retStr(rb)}</td>
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
      </div>
    </div>
  )
}
