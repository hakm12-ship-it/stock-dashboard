import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSymbols } from '../lib/api'
import type { FocusTicker, Market } from '../data/tickers'

export default function SearchSheet({
  existing,
  custom,
  onAdd,
  onRemove,
  onClose,
}: {
  existing: FocusTicker[]
  custom: FocusTicker[]
  onAdd: (t: FocusTicker) => void
  onRemove: (t: FocusTicker) => void
  onClose: () => void
}) {
  const [market, setMarket] = useState<Market>('KR')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])

  const res = useQuery({
    queryKey: ['symbols', market, dq],
    queryFn: () => getSymbols(market, dq),
    enabled: dq.length >= 1,
  })

  const isAdded = (ticker: string) =>
    existing.some((x) => x.ticker === ticker && x.market === market)

  return (
    <div className="fixed inset-0 z-50 bg-ink flex flex-col fade-in">
      <div className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border">
        <span className="text-base font-bold">종목 추가</span>
        <button onClick={onClose} className="text-muted text-2xl leading-none px-2 active:text-text">
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 pb-10">
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
          {(['KR', 'US'] as Market[]).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                m === market ? 'bg-accent/20 text-text' : 'text-muted'
              }`}
            >
              {m === 'KR' ? '한국' : '미국'}
            </button>
          ))}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder={market === 'KR' ? '예: 카카오, 035720' : '예: Apple, NVDA'}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent"
        />

        {res.isLoading && dq && <div className="text-muted text-sm text-center py-3">검색 중…</div>}

        {res.data?.map((r) => {
          const added = isAdded(r.ticker)
          return (
            <div
              key={r.ticker}
              className="flex items-center justify-between gap-2 bg-surface border border-border rounded-lg px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.name}</div>
                <div className="font-mono text-[0.66rem] text-muted">{r.ticker}</div>
              </div>
              <button
                disabled={added}
                onClick={() => onAdd({ ticker: r.ticker, name: r.name, short: r.name, market, kind: 'stock' })}
                className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border ${
                  added ? 'text-muted border-border' : 'text-accent border-accent/50 active:bg-accent/10'
                }`}
              >
                {added ? '추가됨' : '추가'}
              </button>
            </div>
          )
        })}

        {dq && res.isFetched && (!res.data || res.data.length === 0) && (
          <div className="text-muted text-sm text-center py-4">검색 결과가 없어요</div>
        )}

        {custom.length > 0 && (
          <div className="pt-3">
            <div className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted mb-2">
              내가 추가한 종목
            </div>
            {custom.map((t) => (
              <div
                key={`${t.market}-${t.ticker}`}
                className="flex items-center justify-between py-2 border-b border-border last:border-0"
              >
                <span className="text-sm">
                  {t.name} <span className="font-mono text-muted text-xs">{t.ticker}</span>
                </span>
                <button onClick={() => onRemove(t)} className="text-xs text-down px-2 active:opacity-70">
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
