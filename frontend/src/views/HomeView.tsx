import WatchlistRow from '../components/WatchlistRow'
import Icon from '../components/Icon'
import { useEffect, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getIndex, getPrices, type Period } from '../lib/api'
import { marketStatus } from '../lib/market'
import { fmtPct, fmtPrice, changeColor } from '../lib/format'
import { usePortfolioValue } from '../components/usePortfolioValue'
import type { FocusTicker } from '../data/tickers'

import DailyReportCard from '../components/DailyReportCard'
import IndexStrip from '../components/IndexStrip'
import MacroStrip from '../components/MacroStrip'
import PortfolioSummary from '../components/PortfolioSummary'
import MarketTop from '../components/MarketTop'
import GroupsPanel from '../components/GroupsPanel'
import AlertInviteCard from '../components/AlertInviteCard'
import type { Holding } from '../lib/holdings'
import type { Trade } from '../lib/trades'
import PortfolioReviewCard from '../components/PortfolioReviewCard'

const PERIODS: [Period, string][] = [
  ['1m', '1개월'],
  ['3m', '3개월'],
  ['6m', '6개월'],
]

/** 지금 보고 있는 숫자가 어느 장의 것인지 — 장 상태와 마지막 거래일을 글자로 보여준다. */
function MarketSession({ updatedAt }: { updatedAt?: Date | null }) {
  const kospi = useQuery({ queryKey: ['index', 'KOSPI'], queryFn: () => getIndex('KOSPI') })
  const nasdaq = useQuery({ queryKey: ['index', 'NASDAQ'], queryFn: () => getIndex('NASDAQ') })
  const item = (label: string, market: 'KR' | 'US', last?: string) => {
    const st = marketStatus(market)
    const day = !st.open && last ? ` · ${last.slice(5, 10).replace('-', '.')} 종가` : ''
    return (
      <span className="session-item">
        <span className={`session-dot ${st.open ? 'is-open' : ''}`} aria-hidden="true" />
        {label} {st.label}
        {day}
      </span>
    )
  }
  return (
    <div className="market-session">
      <div className="session-items">
        {item('한국', 'KR', kospi.data?.series.at(-1)?.time)}
        {item('미국', 'US', nasdaq.data?.series.at(-1)?.time)}
      </div>
      <span className="session-notice">
        지연 시세 · 참고용
        {updatedAt && ` · ${updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 새로고침`}
      </span>
    </div>
  )
}

/** 휴대폰에서 내 자산 카드는 관심종목 목록 아래에 있다. 목록 위에서 합계만 한 줄로 보여주고 이동시킨다. */
function PortfolioPeek({ holdings }: { holdings: Holding[] }) {
  const { canUnify, uniValue, uniPL, uniPct } = usePortfolioValue(holdings)
  if (holdings.length === 0) return null
  return (
    <button
      className="portfolio-peek"
      onClick={() => document.getElementById('my-assets')?.scrollIntoView({ block: 'start' })}
      aria-label={
        canUnify
          ? `내 자산 ${fmtPrice(uniValue, 'KR')}, 평가손익 ${fmtPct(uniPct)}. 내 자산 요약으로 이동`
          : '내 자산 평가 대기. 내 자산 요약으로 이동'
      }
    >
      <span className="text-label text-muted">내 자산</span>
      {canUnify ? (
        <>
          <span className="font-mono tnum font-semibold">{fmtPrice(uniValue, 'KR')}</span>
          <span className={`font-mono tnum text-label ${changeColor(uniPL)}`}>{fmtPct(uniPct)}</span>
        </>
      ) : (
        <span className="text-caption text-muted">평가 대기</span>
      )}
      <span className="ml-auto text-muted" aria-hidden="true">
        ›
      </span>
    </button>
  )
}

export default function HomeView({
  tickers,
  holdings,
  trades,
  light,
  onSelect,
  onAddClick,
  onAddTicker,
  onMove,
  onManageHoldings,
  onOpenJournal,
  onCompare,
  updatedAt,
}: {
  tickers: FocusTicker[]
  holdings: Holding[]
  trades: Trade[]
  light: boolean
  onSelect: (t: FocusTicker) => void
  onAddClick: () => void
  onAddTicker: (t: FocusTicker) => void
  onMove: (key: string, dir: -1 | 1) => void
  onManageHoldings: () => void
  onOpenJournal: () => void
  onCompare: () => void
  updatedAt?: Date | null
}) {
  const [sort, setSort] = useState<'default' | 'gainers' | 'losers'>('default')
  const [filter, setFilter] = useState<'all' | 'KR' | 'US' | 'held'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [sparkPeriod, setSparkPeriod] = useState<Period>('1m')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])

  // 정렬용 등락률 (카드와 같은 쿼리키 → 캐시 공유, 중복 요청 없음)
  const priceQs = useQueries({
    queries: tickers.map((t) => ({
      queryKey: ['prices', t.ticker, sparkPeriod],
      queryFn: () => getPrices(t.ticker, sparkPeriod),
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

  const filtered = ordered.filter(
    ({ t }) =>
      (filter === 'all' ||
        (filter === 'held'
          ? holdings.some((h) => h.ticker === t.ticker && h.market === t.market)
          : t.market === filter)) &&
      `${t.name} ${t.ticker}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const SORTS: [typeof sort, string][] = [
    ['default', '내 순서'],
    ['gainers', '상승률 순'],
    ['losers', '하락률 순'],
  ]
  const filtering = filter !== 'all' || query.trim() !== ''

  return (
    <div className="home-layout">
      <section className="market-overview" aria-label="시장 지수와 환율">
        <MarketSession updatedAt={updatedAt} />
        <div className="market-tiles">
          <IndexStrip />
          <MacroStrip />
        </div>
      </section>
      <PortfolioPeek holdings={holdings} />
      <section className="watchlist-section" aria-labelledby="watchlist-title">
        <div className="section-heading">
          <div>
            <h2 id="watchlist-title">
              관심종목{' '}
              <span className="text-muted text-sm font-mono tnum">
                {filtering && !editing ? `${filtered.length}/${tickers.length}` : tickers.length}
              </span>
            </h2>
          </div>
          <div className="flex gap-2">
            <button className="button button-quiet" onClick={onCompare}>
              <Icon name="compare" size={16} /> 비교
            </button>
            <button className="button button-primary" onClick={onAddClick}>
              <Icon name="plus" size={16} /> 종목 추가
            </button>
          </div>
        </div>
        <div className="watchlist-controls">
          {!editing && (
            <>
              <div className="segmented" role="group" aria-label="시장 필터">
                {(
                  [
                    ['all', '전체'],
                    ['KR', '한국'],
                    ['US', '미국'],
                    ['held', '보유'],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <button
                className={`list-search-toggle ${searchOpen || query ? 'is-active' : ''}`}
                aria-label="목록에서 찾기"
                aria-expanded={searchOpen || query !== ''}
                onClick={() => {
                  if (searchOpen && query === '') setSearchOpen(false)
                  else setSearchOpen(true)
                }}
              >
                <Icon name="search" size={18} />
              </button>
              <label className={`list-search ${searchOpen || query ? 'is-open' : ''}`}>
                <Icon name="search" size={16} />
                <input
                  ref={searchInput}
                  aria-label="관심종목 검색"
                  placeholder="목록에서 찾기"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (query === '') setSearchOpen(false)
                  }}
                />
              </label>
              <div className="period-controls" role="group" aria-label="가격 흐름 기간">
                {PERIODS.map(([p, label]) => (
                  <button key={p} aria-pressed={sparkPeriod === p} onClick={() => setSparkPeriod(p)}>
                    {label}
                  </button>
                ))}
              </div>
              <select
                className="sort-select"
                aria-label="전일 대비 정렬"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                {SORTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          {editing && <p className="reorder-hint">화살표로 순서를 바꾸면 바로 저장돼요.</p>}
          <button
            className={`edit-order ${editing ? 'is-editing' : ''}`}
            onClick={() => {
              setEditing(!editing)
              if (!editing) {
                setSort('default')
                setFilter('all')
                setQuery('')
                setSearchOpen(false)
              }
            }}
          >
            {editing ? '편집 완료' : '순서 편집'}
          </button>
        </div>
        {!editing && (
          <div className="watchlist-columns" aria-hidden="true">
            <span>종목</span>
            <span>현재가 · 전일 대비</span>
            <span>가격 흐름 · {PERIODS.find(([p]) => p === sparkPeriod)?.[1]}</span>
            <span>종합 신호</span>
          </div>
        )}
        <div className="watchlist-rows">
          {editing
            ? tickers.map((t, i) => (
                <div key={`${t.market}-${t.ticker}`} className="reorder-row">
                  <span className="font-mono text-label text-muted w-5 tnum">{i + 1}</span>
                  <span className="text-sm font-medium flex-1 truncate">{t.short}</span>
                  <span className="font-mono text-label text-muted reorder-code">
                    {t.market} · {t.ticker}
                  </span>
                  <button
                    aria-label={`${t.short} 위로 이동`}
                    onClick={() => onMove(`${t.market}-${t.ticker}`, -1)}
                    disabled={i === 0}
                    className={`min-w-[44px] min-h-[44px] rounded-md border border-border text-sm ${i === 0 ? 'text-muted/30' : 'text-text active:bg-surface-2'}`}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`${t.short} 아래로 이동`}
                    onClick={() => onMove(`${t.market}-${t.ticker}`, 1)}
                    disabled={i === tickers.length - 1}
                    className={`min-w-[44px] min-h-[44px] rounded-md border border-border text-sm ${i === tickers.length - 1 ? 'text-muted/30' : 'text-text active:bg-surface-2'}`}
                  >
                    ↓
                  </button>
                </div>
              ))
            : filtered.map(({ t }) => (
                <WatchlistRow
                  key={`${t.market}-${t.ticker}`}
                  t={t}
                  period={sparkPeriod}
                  holding={holdings.find((h) => h.ticker === t.ticker && h.market === t.market)}
                  onClick={() => onSelect(t)}
                />
              ))}
          {!editing && filtered.length === 0 && (
            <div className="empty-state">
              <h3>
                {filter === 'held' && holdings.length === 0
                  ? '보유종목을 등록해 보세요'
                  : '조건에 맞는 종목이 없습니다'}
              </h3>
              <p>
                {filter === 'held' && holdings.length === 0
                  ? '수량과 평균 매수가를 입력하면 손익을 함께 볼 수 있습니다.'
                  : '검색어를 바꾸거나 필터를 초기화해 주세요.'}
              </p>
              <button
                className="button button-quiet"
                onClick={() => {
                  if (filter === 'held' && holdings.length === 0) onManageHoldings()
                  else {
                    setFilter('all')
                    setQuery('')
                  }
                }}
              >
                {filter === 'held' && holdings.length === 0 ? '보유종목 등록' : '필터 초기화'}
              </button>
            </div>
          )}
        </div>
        {!editing && (
          <p className="watchlist-footnote">가격 흐름 선과 색은 선택 기간의 등락 기준 · 종합 신호는 규칙 기반 참고 정보</p>
        )}
      </section>
      <aside className="home-aside" aria-label="내 자산과 시장 요약">
        <PortfolioSummary
          holdings={holdings}
          light={light}
          onManage={onManageHoldings}
          onJournal={onOpenJournal}
        />
        <DailyReportCard />
        <PortfolioReviewCard holdings={holdings} trades={trades} />
        <AlertInviteCard />
      </aside>
      <section className="market-discovery" aria-label="시장 탐색">
        <div className="section-heading">
          <div>
            <h2>시장 둘러보기</h2>
            <p>오늘의 움직임과 업종별 흐름을 확인하세요.</p>
          </div>
        </div>
        <div className="discovery-grid">
          <MarketTop existing={tickers} onAdd={onAddTicker} onOpen={onSelect} />

          <GroupsPanel existing={tickers} onAdd={onAddTicker} onOpen={onSelect} />
        </div>
      </section>
    </div>
  )
}
