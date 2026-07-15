import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGroups, getGroupStocks } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { changeColor, changeSign } from '../lib/format'

type Kind = 'industry' | 'theme'

function GroupStocks({
  kind,
  no,
  existing,
  onAdd,
  onOpen,
}: {
  kind: Kind
  no: number
  existing: FocusTicker[]
  onAdd: (t: FocusTicker) => void
  onOpen: (ticker: string) => void
}) {
  const q = useQuery({ queryKey: ['groupStocks', kind, no], queryFn: () => getGroupStocks(kind, no) })
  if (q.isLoading) return <div className="h-20 rounded-lg shimmer my-1" />
  if (!q.data || q.data.length === 0)
    return <div className="text-muted text-xs py-2 text-center">구성 종목이 없어요</div>

  const findAdded = (code: string) => existing.some((x) => x.ticker === code && x.market === 'KR')

  return (
    <div className="pl-5 pb-1">
      {q.data.map((s) => {
        const added = findAdded(s.ticker)
        return (
          <div key={s.ticker} className="flex items-center gap-2 py-1.5 border-t border-border/60">
            <button onClick={() => added && onOpen(s.ticker)} className="min-w-0 flex-1 text-left">
              <span className="text-xs font-medium truncate">
                {s.name}
                {added && <span className="text-accent text-[0.6rem] ml-1">›</span>}
              </span>
            </button>
            <span className="font-mono text-xs tnum shrink-0">
              {s.price != null ? `${Math.round(s.price).toLocaleString()}원` : '—'}
            </span>
            <span
              className={`font-mono text-[0.66rem] w-14 text-right shrink-0 ${s.changePct != null ? changeColor(s.changePct) : 'text-muted'}`}
            >
              {s.changePct != null ? `${changeSign(s.changePct)}${Math.abs(s.changePct).toFixed(1)}%` : '—'}
            </span>
            <button
              disabled={added}
              onClick={() =>
                onAdd({ ticker: s.ticker, name: s.name, short: s.name, market: 'KR', kind: 'stock' })
              }
              className={`shrink-0 text-[0.6rem] px-1.5 py-0.5 rounded border ${
                added ? 'text-muted border-border' : 'text-accent border-accent/50 active:bg-accent/10'
              }`}
            >
              {added ? '✓' : '+'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function GroupsPanel({
  existing,
  onAdd,
  onOpen,
}: {
  existing: FocusTicker[]
  onAdd: (t: FocusTicker) => void
  onOpen: (ticker: string) => void
}) {
  const [kind, setKind] = useState<Kind>('industry')
  const [openNo, setOpenNo] = useState<number | null>(null)

  const q = useQuery({
    queryKey: ['groups', kind],
    queryFn: () => getGroups(kind),
    staleTime: 5 * 60 * 1000,
  })
  const rows = (q.data ?? []).slice(0, 7)

  return (
    <section className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          🏷️ 업종·테마 시세
        </span>
        <div className="flex gap-1">
          {(
            [
              ['industry', '업종'],
              ['theme', '테마'],
            ] as [Kind, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setKind(k)
                setOpenNo(null)
              }}
              className={`text-[0.66rem] px-2 py-1 rounded-md ${
                kind === k ? 'bg-accent/15 text-accent' : 'text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="h-40 rounded-lg shimmer" />
      ) : rows.length === 0 ? (
        <div className="text-muted text-xs text-center py-4">데이터가 없어요</div>
      ) : (
        <div>
          {rows.map((g) => (
            <div key={g.no} className="border-b border-border last:border-0">
              <button
                onClick={() => setOpenNo(openNo === g.no ? null : g.no)}
                className="w-full flex items-center gap-2 py-2.5 text-left"
              >
                <span className="text-sm font-medium flex-1 truncate">{g.name}</span>
                <span className="font-mono text-[0.62rem] text-muted shrink-0">
                  <span className="text-up">▲{g.rise}</span> <span className="text-down">▼{g.fall}</span>
                </span>
                <span className={`font-mono text-sm tnum w-16 text-right shrink-0 ${changeColor(g.changeRate)}`}>
                  {changeSign(g.changeRate)}
                  {Math.abs(g.changeRate).toFixed(2)}%
                </span>
                <span className={`text-muted text-[0.6rem] transition-transform ${openNo === g.no ? 'rotate-90' : ''}`}>
                  ›
                </span>
              </button>
              {openNo === g.no && (
                <GroupStocks kind={kind} no={g.no} existing={existing} onAdd={onAdd} onOpen={onOpen} />
              )}
            </div>
          ))}
          <p className="text-[0.58rem] text-muted mt-2">
            등락률 상위 순 · 탭하면 구성 종목 · 장중에 갱신돼요
          </p>
        </div>
      )}
    </section>
  )
}
