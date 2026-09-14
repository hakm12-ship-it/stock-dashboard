import { ErrorState } from './ui'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getGroups, getGroupStocks } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { changeColor, changeSign, fmtPrice } from '../lib/format'
import Icon from './Icon'

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
  onOpen: (ticker: FocusTicker) => void
}) {
  const q = useQuery({ queryKey: ['groupStocks', kind, no], queryFn: () => getGroupStocks(kind, no) })
  if (q.isLoading) return <div className="h-20 rounded-lg shimmer my-1" />
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />
  if (!q.data || q.data.length === 0)
    return <div className="text-muted text-xs py-2 text-center">구성 종목이 없어요</div>

  const findAdded = (code: string) => existing.some((x) => x.ticker === code && x.market === 'KR')

  return (
    <div className="pl-5 pb-1">
      {q.data.map((s) => {
        const added = findAdded(s.ticker)
        return (
          <div key={s.ticker} className="flex items-center gap-2 min-h-[44px] border-t border-border/60">
            <button
              onClick={() =>
                onOpen({ ticker: s.ticker, name: s.name, short: s.name, market: 'KR', kind: 'stock' })
              }
              className="min-w-0 flex-1 self-stretch text-left"
            >
              <span className="block text-sm font-medium truncate">
                {s.name} <span className="text-muted" aria-hidden="true">›</span>
              </span>
            </button>
            <span className="font-mono text-xs tnum shrink-0">
              {fmtPrice(s.price, 'KR')}
            </span>
            <span
              className={`font-mono text-label w-14 text-right shrink-0 ${s.changePct != null ? changeColor(s.changePct) : 'text-muted'}`}
            >
              {s.changePct != null ? `${changeSign(s.changePct)}${Math.abs(s.changePct).toFixed(1)}%` : '—'}
            </span>
            {added ? (
              <span className="add-state" aria-label={`${s.name} 관심종목에 있음`}>
                <Icon name="check" size={14} />
              </span>
            ) : (
              <button
                onClick={() => onAdd({ ticker: s.ticker, name: s.name, short: s.name, market: 'KR', kind: 'stock' })}
                aria-label={`${s.name} 관심종목에 담기`}
                className="add-button"
              >
                <Icon name="plus" size={14} /> 담기
              </button>
            )}
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
  onOpen: (ticker: FocusTicker) => void
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
        <span className="panel-title">
          업종·테마 시세
        </span>
        <div className="segmented" role="group" aria-label="분류">
          {(
            [
              ['industry', '업종'],
              ['theme', '테마'],
            ] as [Kind, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k)
                setOpenNo(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="h-40 rounded-lg shimmer" />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <div className="text-muted text-xs text-center py-4">데이터가 없어요</div>
      ) : (
        <div>
          {rows.map((g) => (
            <div key={g.no} className="border-b border-border last:border-0">
              <button
                onClick={() => setOpenNo(openNo === g.no ? null : g.no)}
                aria-expanded={openNo === g.no}
                aria-label={`${g.name} 등락률 ${changeSign(g.changeRate)} ${Math.abs(g.changeRate).toFixed(2)}%, 상승 ${g.rise}종목 하락 ${g.fall}종목`}
                className="w-full flex items-center gap-2 min-h-[44px] text-left"
              >
                <span className="text-sm font-medium flex-1 truncate">{g.name}</span>
                <span className="text-label text-muted shrink-0 whitespace-nowrap">
                  상승 <span className="font-mono tnum">{g.rise}</span> · 하락 <span className="font-mono tnum">{g.fall}</span>
                </span>
                <span
                  className={`font-mono text-sm tnum w-16 text-right shrink-0 ${changeColor(g.changeRate)}`}
                >
                  {changeSign(g.changeRate)}
                  {Math.abs(g.changeRate).toFixed(2)}%
                </span>
                <span
                  className={`text-muted text-label transition-transform ${openNo === g.no ? 'rotate-90' : ''}`}
                >
                  ›
                </span>
              </button>
              {openNo === g.no && (
                <GroupStocks kind={kind} no={g.no} existing={existing} onAdd={onAdd} onOpen={onOpen} />
              )}
            </div>
          ))}
          <p className="text-label text-muted mt-2">등락률 상위 순 · 누르면 구성 종목이 펼쳐져요 · 장중에 갱신돼요</p>
        </div>
      )}
    </section>
  )
}
