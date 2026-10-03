import { josa } from '../lib/format'
import { useState, useEffect, useRef } from 'react'
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
  onSelect,
}: {
  existing: FocusTicker[]
  custom: FocusTicker[]
  onAdd: (t: FocusTicker) => Promise<boolean>
  onRemove: (t: FocusTicker) => void
  onClose: () => void
  onSelect?: (t: FocusTicker) => void
}) {
  const [market, setMarket] = useState<Market>('KR')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const selected = useRef<FocusTicker | null>(null)
  const query = q.trim()
  const marketLabel = market === 'KR' ? '한국' : '미국'

  useEffect(() => {
    // The dialog opens in a layout effect; focus after it is visible, including StrictMode replay.
    input.current?.focus()
  }, [])

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
  const currentQuery = query.length > 0 && query === dq
  const searching = query.length > 0 && (!currentQuery || res.isPending || (res.isFetching && !res.data))
  const results =
    currentQuery && res.data
      ? res.data.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      : []
  const status = !query
    ? '종목명 또는 티커를 입력해 주세요.'
    : searching
      ? `${marketLabel} 종목을 검색하고 있어요…`
      : res.isError
        ? '검색 결과를 불러오지 못했습니다.'
        : `${marketLabel} 검색 결과 ${results.length}개`
  const openTicker = (ticker: FocusTicker) => {
    if (!onSelect || selected.current) return
    selected.current = ticker
    onClose()
  }
  const afterClose = () => {
    const ticker = selected.current
    selected.current = null
    if (ticker) onSelect?.(ticker)
  }

  return (
    <Sheet title="종목 검색" onClose={onClose} onAfterClose={afterClose} size="tall">
      <p className="text-sm text-muted">
        {onSelect ? '종목을 눌러 분석을 보거나 관심종목에 추가하세요.' : '관심종목에 추가할 종목을 찾아보세요.'}
      </p>
      <div className="segmented segmented--block" role="group" aria-label="시장">
        {(['KR', 'US'] as Market[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMarket(m)
              setNotice(null)
            }}
            aria-pressed={m === market}
          >
            {m === 'KR' ? '한국' : '미국'}
          </button>
        ))}
      </div>

      <div>
        <label className="field-label" htmlFor="symbol-search">
          종목명 또는 티커
        </label>
        <div className="relative">
          <input
            ref={input}
            id="symbol-search"
            className="field"
            style={{ paddingRight: 48 }}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setNotice(null)
            }}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby="symbol-search-status"
            placeholder={market === 'KR' ? '예: 카카오, 035720' : '예: Apple, NVDA'}
          />
          {q && (
            <button
              type="button"
              className="icon-button absolute right-0.5 top-1/2 -translate-y-1/2"
              aria-label="검색어 지우기"
              onClick={() => {
                setQ('')
                setDq('')
                setNotice(null)
                input.current?.focus()
              }}
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'form-error' : 'sheet-notice'}>
          {!notice.error && <Icon name="check" size={16} />}
          {notice.text}
        </p>
      )}
      <p
        id="symbol-search-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-label text-muted"
      >
        {status}
      </p>
      {res.isError && currentQuery && !searching && (
        <ErrorState
          label="검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
          onRetry={() => res.refetch()}
        />
      )}

      {results.length > 0 && (
        <ul className="sheet-list" aria-label="검색 결과">
          {results.map(({ r }) => {
            const added = isAdded(r.ticker)
            const ticker = existing.find((t) => t.ticker === r.ticker && t.market === market) ?? {
              ticker: r.ticker,
              name: r.name,
              short: r.name,
              market,
              kind: 'stock' as const,
            }
            const label = (
              <>
                <span className="block text-sm font-medium leading-snug break-words">{r.name}</span>
                <span className="block text-label text-muted mt-1">
                  {r.ticker}
                  {onSelect ? ' · 분석 보기' : ''}
                </span>
              </>
            )
            return (
              <li key={r.ticker} className="sheet-list-row">
                {onSelect ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 min-h-[44px] py-2 text-left rounded-lg hover:text-accent"
                    aria-label={`${r.name} (${r.ticker}) 분석 열기`}
                    onClick={() => openTicker(ticker)}
                  >
                    {label}
                  </button>
                ) : (
                  <div className="min-w-0 flex-1 py-2">{label}</div>
                )}
                <button
                  disabled={added || adding === r.ticker}
                  aria-label={added ? `${r.name} 관심종목에 추가됨` : `${r.name} 관심종목에 추가`}
                  onClick={async () => {
                    setAdding(r.ticker)
                    const ok = await onAdd(ticker)
                    setAdding(null)
                    setNotice({
                      text: ok
                        ? `${josa(r.name, '을', '를')} 관심종목에 추가했습니다.`
                        : '저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.',
                      error: !ok,
                    })
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

      {currentQuery && !res.isError && res.isSuccess && results.length === 0 && (
        <div className="empty-state">
          <h3>‘{query}’ 검색 결과가 없어요</h3>
          <p>종목명이나 티커를 확인하거나 다른 시장에서 찾아보세요.</p>
          <button className="button button-quiet" onClick={() => setMarket(market === 'KR' ? 'US' : 'KR')}>
            {market === 'KR' ? '미국' : '한국'} 시장에서 검색
          </button>
        </div>
      )}

      {!query && existing.length > 0 && (
        <section>
          <h3 className="section-label mb-2">내 관심종목 · {existing.length}</h3>
          <ul className="sheet-list">
            {existing.map((t) => (
              <li key={`${t.market}-${t.ticker}`} className="sheet-list-row">
                {onSelect ? (
                  <button
                    type="button"
                    className="text-sm min-w-0 flex-1 min-h-[44px] py-2 text-left rounded-lg hover:text-accent"
                    aria-label={`${t.name} (${t.ticker}) 분석 열기`}
                    onClick={() => openTicker(t)}
                  >
                    <span className="block font-medium break-words">{t.name}</span>
                    <span className="block text-muted text-xs mt-1">
                      {t.market === 'KR' ? '한국' : '미국'} · {t.ticker} · 분석 보기
                    </span>
                  </button>
                ) : (
                  <span className="text-sm min-w-0 flex-1 break-words">
                    {t.name} <span className="font-mono text-muted text-xs">{t.ticker}</span>
                  </span>
                )}
                {custom.some((item) => item.ticker === t.ticker && item.market === t.market) && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `${josa(t.name, '을', '를')} 관심종목에서 삭제할까요? 보유 기록은 유지됩니다.`,
                        )
                      )
                        onRemove(t)
                    }}
                    aria-label={`${t.name} 관심종목에서 삭제`}
                    className="icon-button danger-action"
                  >
                    <Icon name="trash" size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  )
}
