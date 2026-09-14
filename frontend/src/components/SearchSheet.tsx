import { josa } from '../lib/format'
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSymbols } from '../lib/api'
import type { FocusTicker, Market } from '../data/tickers'
import { Sheet, ErrorState } from './ui'
import Icon from './Icon'

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

  // 가장 그럴듯한 결과가 먼저: 이름·티커가 정확히 같음 → 이름이 검색어로 시작 → 나머지(서버 순서).
  const needle = dq.toLowerCase()
  const rank = (r: { name: string; ticker: string }) =>
    r.name.toLowerCase() === needle || r.ticker.toLowerCase() === needle
      ? 0
      : r.name.toLowerCase().startsWith(needle) || r.ticker.toLowerCase().startsWith(needle)
        ? 1
        : 2
  const results = res.data ? res.data.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i) : []

  return (
    <Sheet title="종목 추가" onClose={onClose} size="tall">
      <div className="segmented segmented--block" role="group" aria-label="시장">
        {(['KR', 'US'] as Market[]).map((m) => (
          <button key={m} onClick={() => setMarket(m)} aria-pressed={m === market}>
            {m === 'KR' ? '한국' : '미국'}
          </button>
        ))}
      </div>

      <div>
        <label className="field-label" htmlFor="symbol-search">
          종목명 또는 티커
        </label>
        <input
          id="symbol-search"
          className="field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder={market === 'KR' ? '예: 카카오, 035720' : '예: Apple, NVDA'}
        />
      </div>

      {notice && (
        <p role="status" className="sheet-notice">
          <Icon name="check" size={16} />
          {notice}
        </p>
      )}
      {res.isLoading && dq && <div className="text-muted text-sm text-center py-3">검색 중…</div>}
      {res.isError && dq && (
        <ErrorState label="검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." onRetry={() => res.refetch()} />
      )}

      {results.length > 0 && (
        <ul className="sheet-list" aria-label="검색 결과">
          {results.map(({ r }) => {
            const added = isAdded(r.ticker)
            return (
              <li key={r.ticker} className="sheet-list-row">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="font-mono text-label text-muted">{r.ticker}</div>
                </div>
                <button
                  disabled={added}
                  onClick={() => {
                    const ok = onAdd({ ticker: r.ticker, name: r.name, short: r.name, market, kind: 'stock' })
                    setNotice(
                      ok
                        ? `${josa(r.name, '을', '를')} 관심종목에 추가했습니다.`
                        : '저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.',
                    )
                  }}
                  className={added ? 'add-done' : 'add-button'}
                >
                  {added ? (
                    <>
                      <Icon name="check" size={14} />
                      추가됨
                    </>
                  ) : (
                    '추가'
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {dq && !res.isError && res.isSuccess && res.data.length === 0 && (
        <p className="text-muted text-sm text-center py-4">
          검색 결과가 없어요.{' '}
          {market === 'KR' ? '미국 종목이라면 위에서 미국을 고르세요.' : '한국 종목이라면 위에서 한국을 고르세요.'}
        </p>
      )}

      {!q && custom.length === 0 && (
        <p className="text-label text-muted">추가한 종목은 관심종목 목록에 바로 나타납니다.</p>
      )}

      {custom.length > 0 && (
        <section>
          <h3 className="section-label mb-2">내가 추가한 종목</h3>
          <ul className="sheet-list">
            {custom.map((t) => (
              <li key={`${t.market}-${t.ticker}`} className="sheet-list-row">
                <span className="text-sm min-w-0 flex-1 truncate">
                  {t.name} <span className="font-mono text-muted text-xs">{t.ticker}</span>
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`${josa(t.name, '을', '를')} 관심종목에서 삭제할까요? 보유 기록은 유지됩니다.`))
                      onRemove(t)
                  }}
                  aria-label={`${t.name} 관심종목에서 삭제`}
                  className="icon-button danger-action"
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  )
}
