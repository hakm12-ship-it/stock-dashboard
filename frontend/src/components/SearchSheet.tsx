import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSymbols } from '../lib/api'
import type { FocusTicker, Market } from '../data/tickers'
import { Sheet, ErrorState } from './ui'

export default function SearchSheet({
  existing,
  custom,
  onAdd,
  onRemove,
  onClose,
}: {
  existing: FocusTicker[]
  custom: FocusTicker[]
  onAdd: (t: FocusTicker) => boolean
  onRemove: (t: FocusTicker) => void
  onClose: () => void
}) {
  const [market, setMarket] = useState<Market>('KR')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])

  const res = useQuery({
    queryKey: ['symbols', market, dq],
    queryFn: () => getSymbols(market, dq),
    enabled: dq.length >= 1,
  })

  const isAdded = (ticker: string) => existing.some((x) => x.ticker === ticker && x.market === market)

  return (
    <Sheet title="종목 추가" onClose={onClose}>
      <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
        {(['KR', 'US'] as Market[]).map((m) => (
          <button
            key={m}
            onClick={() => setMarket(m)}
            aria-pressed={m === market}
            className={`flex-1 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
              m === market ? 'bg-surface-2 text-text' : 'text-muted'
            }`}
          >
            {m === 'KR' ? '한국' : '미국'}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="symbol-search">
        종목명 또는 티커
      </label>
      <input
        id="symbol-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        placeholder={market === 'KR' ? '예: 카카오, 035720' : '예: Apple, NVDA'}
        className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent"
      />

      {res.isLoading && dq && <div className="text-muted text-sm text-center py-3">검색 중…</div>}
      {!q && (
        <p className="text-sm text-muted">
          시장 선택 후 종목명이나 코드를 입력하세요. 추가한 종목은 관심종목 목록에서 확인할 수 있습니다.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-accent">
          {notice}
        </p>
      )}
      {res.isError && dq && (
        <ErrorState
          label="검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
          onRetry={() => res.refetch()}
        />
      )}

      {res.data?.map((r) => {
        const added = isAdded(r.ticker)
        return (
          <div
            key={r.ticker}
            className="flex items-center justify-between gap-2 bg-surface border border-border rounded-lg px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{r.name}</div>
              <div className="font-mono text-label text-muted">{r.ticker}</div>
            </div>
            <button
              disabled={added}
              onClick={() => {
                const ok = onAdd({ ticker: r.ticker, name: r.name, short: r.name, market, kind: 'stock' })
                setNotice(
                  ok
                    ? `${r.name}을 관심종목에 추가했습니다.`
                    : '저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.',
                )
              }}
              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border ${
                added ? 'text-muted border-border' : 'text-text border-border active:border-accent'
              }`}
            >
              {added ? '추가됨' : '추가'}
            </button>
          </div>
        )
      })}

      {dq && !res.isError && res.isSuccess && res.data.length === 0 && (
        <div className="text-muted text-sm text-center py-4">검색 결과가 없어요</div>
      )}

      {custom.length > 0 && (
        <div className="pt-3">
          <div className="text-label font-semibold uppercase tracking-[0.08em] text-muted mb-2">
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
              <button
                onClick={() => {
                  if (window.confirm(`${t.name}을 관심종목에서 삭제할까요? 보유 기록은 유지됩니다.`))
                    onRemove(t)
                }}
                className="text-xs text-down px-2 min-h-[44px] shrink-0 active:opacity-70"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
