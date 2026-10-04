import WatchlistRow from '../components/WatchlistRow'
import Icon from '../components/Icon'
import { useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getIndex, getWatchlist } from '../lib/api'
import type { WatchlistPreferences } from '../lib/homePreferences'
export type { WatchlistPreferences } from '../lib/homePreferences'
import { loadSignalConfig, cfgKey, cfgParams } from '../lib/signalConfig'
import { useMarketStatus } from '../lib/useMarketStatus'
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
import UpcomingEvents from '../components/UpcomingEvents'
import PublicBriefingCard from '../components/PublicBriefingCard'
import MyDayCard from '../components/MyDayCard'
import MarketReviewCard from '../components/MarketReviewCard'
import UsageStatusCard from '../components/UsageStatusCard'

const PERIODS: [WatchlistPreferences['sparkPeriod'], string][] = [
  ['1m', '1개월'],
  ['3m', '3개월'],
  ['6m', '6개월'],
]

/** 지금 보고 있는 숫자가 어느 장의 것인지 — 장 상태와 마지막 거래일을 글자로 보여준다. */
function MarketSession({ updatedAt }: { updatedAt?: Date | null }) {
  const krStatus = useMarketStatus('KR')
  const usStatus = useMarketStatus('US')
  const kospi = useQuery({ queryKey: ['index', 'KOSPI'], queryFn: () => getIndex('KOSPI') })
  const nasdaq = useQuery({ queryKey: ['index', 'NASDAQ'], queryFn: () => getIndex('NASDAQ') })
  const item = (label: string, market: 'KR' | 'US', last?: string) => {
    const st = market === 'KR' ? krStatus : usStatus
    const day = !st.open && last ? ` · ${last.slice(5, 10).replace('-', '.')} ${st.uncertain ? '기준' : '종가'}` : ''
    return (
      <span className="session-item" title={st.detail}>
        <span className={`session-dot ${st.open ? 'is-open' : ''}`} aria-hidden="true" />
        {label} {st.label}
        {day}
      </span>
    )
  }
  return (
    <div className="market-session">
      <div className="session-items">
        {item('한국', 'KR', kospi.data?.quoteAsOf ?? undefined)}
        {item('미국', 'US', nasdaq.data?.quoteAsOf ?? undefined)}
      </div>
      <span className="session-notice">
        지연 시세 · 참고용
        {updatedAt &&
          ` · ${updatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 새로고침`}
      </span>
    </div>
  )
}

/** 휴대폰에서 내 자산 카드는 관심종목 목록 아래에 있다. 목록 위에서 합계만 한 줄로 보여주고 이동시킨다. */
function PortfolioPeek({ holdings, onManage }: { holdings: Holding[]; onManage: () => void }) {
  const { canUnify, uniValue, uniPL, uniPct, valuationStale } = usePortfolioValue(holdings)
  if (holdings.length === 0)
    return (
      <button className="portfolio-peek portfolio-peek-empty" onClick={onManage}>
        <span className="peek-icon">
          <Icon name="wallet" size={18} />
        </span>
        <span>
          <strong>내 자산도 함께 확인하세요</strong>
          <small>보유종목 등록하고 손익 보기</small>
        </span>
        <Icon name="plus" size={18} />
      </button>
    )
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
      <span className="text-label text-muted">내 자산{valuationStale ? ' · 마지막 조회값' : ''}</span>
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
  preferences,
  onPreferencesChange,
  onOpenCalendar,
  preferencesError,
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
  preferences: WatchlistPreferences
  onPreferencesChange: (next: Partial<WatchlistPreferences>) => void
  onOpenCalendar: () => void
  preferencesError: boolean
}) {
  const { sort, filter, query, sparkPeriod } = preferences
  const setSort = (sort: WatchlistPreferences['sort']) => onPreferencesChange({ sort })
  const setFilter = (filter: WatchlistPreferences['filter']) => onPreferencesChange({ filter })
  const setQuery = (query: string) => onPreferencesChange({ query })
  const setSparkPeriod = (sparkPeriod: WatchlistPreferences['sparkPeriod']) => onPreferencesChange({ sparkPeriod })
  const [editing, setEditing] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(query !== '')
  const searchInput = useRef<HTMLInputElement>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)

  // 화면에 표시하는 종목만 요청한다. 가격·신호가 한 번의 서버 조회를 공유한다.
  const visibleTickers = tickers.filter((t) =>
    (filter === 'all' || (filter === 'held'
      ? holdings.some((h) => h.ticker === t.ticker && h.market === t.market) : t.market === filter)) &&
    `${t.name} ${t.short} ${t.ticker}`.toLowerCase().includes(query.trim().toLowerCase()))
  // 시장별로 묶어 미국 장중에 휴장 중인 한국 종목까지 재조회하지 않는다.
  const chunks = (['KR', 'US'] as const).flatMap((market) => {
    const codes = [...new Set(visibleTickers.filter((t) => t.market === market).map((t) => t.ticker))].sort()
    return Array.from({ length: Math.ceil(codes.length / 20) }, (_, i) => codes.slice(i * 20, i * 20 + 20))
  })
  const scfg = loadSignalConfig()
  const batches = useQueries({ queries: chunks.map((chunk) => ({
    queryKey: ['watchlist', chunk.join(','), sparkPeriod, cfgKey(scfg)],
    queryFn: () => getWatchlist(chunk, sparkPeriod, cfgParams(scfg)),
    enabled: !editing,
  })) })
  const rows = new Map(batches.flatMap((batch) => (batch.data ?? []).map((row) => [row.ticker, row] as const)))
  const items = visibleTickers.map((t) => {
    const d = rows.get(t.ticker)?.candles
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
      `${t.name} ${t.short} ${t.ticker}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const SORTS: [typeof sort, string][] = [
    ['default', '내 순서'],
    ['gainers', '상승률 순'],
    ['losers', '하락률 순'],
  ]
  const filtering = filter !== 'all' || query.trim() !== ''
  const filterLabel = { all: '전체', KR: '한국', US: '미국', held: '보유' }[filter]
  const resetFilters = () => onPreferencesChange({ filter: 'all', query: '' })

  return (
    <div className="home-layout">
      <div className="dashboard-heading">
        <div>
          <h1 tabIndex={-1}>나의 관심종목</h1>
          <p className="dashboard-description">시장의 흐름과 내 종목의 변화를 한눈에 살펴보세요.</p>
        </div>
        <div className="dashboard-shortcuts" aria-label="홈 바로가기">
          <a
            href="#my-assets"
            onClick={(event) => {
              event.preventDefault()
              document.getElementById('my-assets')?.scrollIntoView({ block: 'start' })
              document.getElementById('my-assets')?.focus({ preventScroll: true })
            }}
          >
            <Icon name="wallet" size={16} /> 내 자산
          </a>
          <a
            href="#market-discovery"
            onClick={(event) => {
              event.preventDefault()
              document.getElementById('market-discovery')?.scrollIntoView({ block: 'start' })
              document.getElementById('market-discovery')?.focus({ preventScroll: true })
            }}
          >
            <Icon name="tech" size={16} /> 시장 탐색
          </a>
        </div>
      </div>
      <section className="market-overview" aria-label="시장 지수와 환율">
        <MarketSession updatedAt={updatedAt} />
        <div className="market-tiles">
          <IndexStrip />
          <MacroStrip />
        </div>
      </section>
      <PortfolioPeek holdings={holdings} onManage={onManageHoldings} />
      {preferencesError && <p role="status" className="text-caption text-muted">홈 설정을 저장하지 못했습니다. 현재 화면에는 적용했습니다.</p>}
      <section className="watchlist-section" aria-labelledby="watchlist-title">
        <div className="section-heading">
          <div>
            <h2 id="watchlist-title">
              관심종목{' '}
              <span className="watchlist-count tnum">
                {filtering && !editing ? `${filtered.length}/${tickers.length}` : tickers.length}
              </span>
            </h2>
            <p>종목을 선택하면 상세 분석으로 이어집니다.</p>
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
        <div className="watchlist-controls watchlist-toolbar">
          {!editing && (
            <>
              <div className="watchlist-primary-controls">
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
                      <span aria-hidden="true" className="filter-count">
                        {key === 'all'
                          ? tickers.length
                          : tickers.filter((t) =>
                              key === 'held'
                                ? holdings.some((h) => h.ticker === t.ticker && h.market === t.market)
                                : t.market === key,
                            ).length}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  ref={searchToggle}
                  className={`list-search-toggle ${searchOpen || query ? 'is-active' : ''}`}
                  aria-label="목록에서 찾기"
                  aria-expanded={searchOpen || query !== ''}
                  onClick={() => {
                    if (searchOpen && query === '') setSearchOpen(false)
                    else {
                      setSearchOpen(true)
                      requestAnimationFrame(() => searchInput.current?.focus())
                    }
                  }}
                >
                  <Icon name="search" size={18} />
                </button>
                <div className={`list-search ${searchOpen || query ? 'is-open' : ''}`}>
                  <Icon name="search" size={16} />
                  <input
                    ref={searchInput}
                    aria-label="관심종목 검색"
                    placeholder="목록에서 찾기"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setQuery('')
                        setSearchOpen(false)
                        if (searchToggle.current?.offsetParent) searchToggle.current.focus()
                      }
                    }}
                  />
                  {query && (
                    <button
                      className="search-clear"
                      aria-label="목록 검색어 지우기"
                      onClick={() => {
                        setQuery('')
                        searchInput.current?.focus()
                      }}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className={`watchlist-result-summary ${!filtering ? 'is-unfiltered' : ''}`}>
                <span role="status" aria-live="polite">
                  {filterLabel} <strong className="tnum">{filtered.length}</strong>개 종목
                  {query.trim() ? ` · “${query.trim()}” 검색 결과` : ''}
                </span>
                {filtering && filtered.length > 0 && (
                  <button className="text-action" onClick={resetFilters}>
                    필터 초기화
                  </button>
                )}
                <button
                  className="view-options-toggle"
                  aria-expanded={optionsOpen}
                  aria-controls="watchlist-view-options"
                  onClick={() => setOptionsOpen((open) => !open)}
                >
                  <Icon name="settings" size={16} /> 보기 설정
                </button>
              </div>
              <div
                id="watchlist-view-options"
                className={`watchlist-secondary-controls ${optionsOpen ? 'is-open' : ''}`}
              >
                <span className="toolbar-label">가격 흐름</span>
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
                <button
                  className="edit-order"
                  onClick={() => {
                    setEditing(true)
                    onPreferencesChange({ sort: 'default', filter: 'all', query: '' })
                    setSearchOpen(false)
                  }}
                >
                  <Icon name="edit" size={14} /> 순서 편집
                </button>
              </div>
            </>
          )}
          {editing && <p className="reorder-hint">화살표로 순서를 바꾸면 바로 저장돼요.</p>}
          {editing && (
            <button className="edit-order is-editing" onClick={() => setEditing(false)}>
              편집 완료
            </button>
          )}
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
                  data={rows.get(t.ticker)}
                  pending={batches.some((batch) => batch.isPending)}
                  failed={batches.some((batch) => batch.isError)}
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
                    resetFilters()
                  }
                }}
              >
                {filter === 'held' && holdings.length === 0 ? '보유종목 등록' : '필터 초기화'}
              </button>
            </div>
          )}
        </div>
        {!editing && (
          <p className="watchlist-footnote">
            가격 흐름 선과 색은 선택 기간의 등락 기준 · 종합 신호는 규칙 기반 참고 정보
          </p>
        )}
      </section>
      <aside className="home-aside" aria-label="내 자산과 시장 요약">
        <PortfolioSummary
          holdings={holdings}
          light={light}
          onManage={onManageHoldings}
          onJournal={onOpenJournal}
        />
        <MyDayCard tickers={tickers} holdings={holdings} rows={rows} onSelect={onSelect} onOpenCalendar={onOpenCalendar} />
        <DailyReportCard />
        <UpcomingEvents onOpen={onOpenCalendar} />
        <PublicBriefingCard />
        <PortfolioReviewCard holdings={holdings} trades={trades} />
        <AlertInviteCard />
        <MarketReviewCard />
        <UsageStatusCard />
      </aside>
      <section id="market-discovery" tabIndex={-1} className="market-discovery" aria-label="시장 탐색">
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
