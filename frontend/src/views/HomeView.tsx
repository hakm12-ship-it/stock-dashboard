import WatchlistRow from '../components/WatchlistRow'
import Icon from '../components/Icon'
import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getPrices, type Period } from '../lib/api'
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
}) {
  const [sort, setSort] = useState<'default' | 'gainers' | 'losers'>('default')
  const [filter, setFilter] = useState<'all' | 'KR' | 'US' | 'held'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [sparkPeriod, setSparkPeriod] = useState<Period>('1m')

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
    ['default', '기본'],
    ['gainers', '상승순'],
    ['losers', '하락순'],
  ]

  return (
    <div className="home-layout">
      <section className="market-overview" aria-label="시장 지수와 환율">
        <IndexStrip />
        <MacroStrip />
      </section>
      <section className="watchlist-section" aria-labelledby="watchlist-title">
        <div className="section-heading">
          <div>
            <h2 id="watchlist-title">
              관심종목 <span className="text-muted text-sm">{tickers.length}</span>
            </h2>
            <p>종목을 선택하면 상세 분석으로 이동합니다.</p>
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
        <div className="watchlist-filters">
          <div className="segmented" aria-label="시장 필터">
            {(
              [
                ['all', '전체'],
                ['KR', '한국'],
                ['US', '미국'],
                ['held', '보유'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key)
                  setEditing(false)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="list-search">
            <Icon name="search" size={16} />
            <input
              aria-label="관심종목 검색"
              placeholder="목록에서 찾기"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="watchlist-toolbar">
          {!editing && (
            <>
              <div className="period-controls" aria-label="가격 흐름 기간">
                {(['1m', '3m', '6m'] as Period[]).map((p) => (
                  <button key={p} aria-pressed={sparkPeriod === p} onClick={() => setSparkPeriod(p)}>
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
              <select
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
          <button
            className="edit-order"
            onClick={() => {
              setEditing(!editing)
              if (!editing) {
                setSort('default')
                setFilter('all')
                setQuery('')
              }
            }}
          >
            {editing ? '편집 완료' : '순서 편집'}
          </button>
        </div>
        <div className="watchlist-columns">
          <span>종목</span>
          <span>현재가 / 전일 대비</span>
          <span>가격 흐름 / 종합 신호</span>
        </div>
        <div className="watchlist-rows">
          {editing
            ? tickers.map((t, i) => (
                <div
                  key={`${t.market}-${t.ticker}`}
                  className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3.5 py-2.5 card-shadow"
                >
                  <span className="font-mono text-label text-muted w-4">{i + 1}</span>
                  <span className="text-sm font-medium flex-1 truncate">{t.short}</span>
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
        <p className="watchlist-footnote">가격 흐름은 선택 기간 기준 · 종합 신호는 규칙 기반 참고 정보</p>
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
