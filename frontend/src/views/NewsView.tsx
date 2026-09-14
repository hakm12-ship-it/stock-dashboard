import { useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { getNews, type NewsItem } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Loading, Empty, ErrorState } from '../components/ui'
import Icon from '../components/Icon'

// 백엔드 published 형식: "YYYY-MM-DD HH:MM" (KST)
function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return null
  const d = new Date(s.replace(' ', 'T') + ':00+09:00')
  return isNaN(d.getTime()) ? null : d
}

function relTime(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return '방금'
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}일 전`
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}

// 뉴스는 최신순이라 24시간 기준이면 거의 전부에 NEW가 붙어 신호 역할을 못 했다.
// 정말 방금 들어온 것만 표시한다.
const FRESH_MS = 3 * 60 * 60 * 1000

interface Entry {
  n: NewsItem
  d: Date | null
  tag?: string
}

export default function NewsView({ t, tickers }: { t: FocusTicker; tickers: FocusTicker[] }) {
  // 종목을 바꿔도 보던 범위를 유지한다.
  const [mode, setModeState] = useState<'one' | 'all'>(() =>
    sessionStorage.getItem('newsMode') === 'all' ? 'all' : 'one',
  )
  const setMode = (m: 'one' | 'all') => {
    setModeState(m)
    try {
      sessionStorage.setItem('newsMode', m)
    } catch {
      /* 이번 화면에서만 유지 */
    }
  }
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [withIndex, setWithIndex] = useState(false)
  // 지수 뉴스는 개별 종목과 무관한 기사가 많아 기본으로 뺀다.
  const feedTickers = tickers.filter((tk) => withIndex || tk.kind !== 'index')

  const single = useQuery({
    queryKey: ['news', t.market, t.name],
    queryFn: () => getNews(t.market, t.name),
    enabled: mode === 'one',
  })
  const allQs = useQueries({
    queries: feedTickers.map((tk) => ({
      queryKey: ['news', tk.market, tk.name],
      queryFn: () => getNews(tk.market, tk.name),
      enabled: mode === 'all',
    })),
  })

  let entries: Entry[] = []
  const counts = new Map<string, number>()
  if (mode === 'one') {
    entries = (single.data ?? []).map((n) => ({ n, d: parseDate(n.published) }))
  } else {
    const seen = new Set<string>()
    feedTickers.forEach((tk, i) => {
      for (const n of allQs[i]?.data ?? []) {
        if (seen.has(n.title)) continue // 여러 종목에 걸친 같은 기사 중복 제거
        seen.add(n.title)
        entries.push({ n, d: parseDate(n.published), tag: tk.short })
      }
    })
  }
  entries.sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0))
  if (mode === 'all') {
    entries = entries.slice(0, 60)
    entries.forEach((e) => e.tag && counts.set(e.tag, (counts.get(e.tag) ?? 0) + 1))
    if (tagFilter) entries = entries.filter((e) => e.tag === tagFilter)
  }

  const loaded = allQs.filter((q) => !q.isLoading).length
  const stillLoading = mode === 'all' && allQs.some((q) => q.isLoading)
  const isLoading = mode === 'one' ? single.isLoading : entries.length === 0 && stillLoading
  const isError = mode === 'one' ? single.isError : entries.length === 0 && allQs.some((q) => q.isError)
  const partialError = mode === 'all' && entries.length > 0 && allQs.some((q) => q.isError)
  const retry = () => {
    if (mode === 'one') void single.refetch()
    else allQs.filter((q) => q.isError).forEach((q) => void q.refetch())
  }

  return (
    <div className="space-y-3">
      {/* 범위 토글 */}
      <div className="segmented news-scope" role="group" aria-label="뉴스 범위">
        {(
          [
            ['one', `${t.short} 뉴스`],
            ['all', '관심종목 전체'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'all' && (
        <div className="ticker-switcher no-scrollbar" role="group" aria-label="종목별로 거르기">
          <button className={`ticker-chip ${tagFilter == null ? 'is-active' : ''}`} aria-pressed={tagFilter == null} onClick={() => setTagFilter(null)}>
            전체
          </button>
          {feedTickers
            .filter((tk) => counts.has(tk.short))
            .map((tk) => (
              <button
                key={`${tk.market}-${tk.ticker}`}
                className={`ticker-chip ${tagFilter === tk.short ? 'is-active' : ''}`}
                aria-pressed={tagFilter === tk.short}
                onClick={() => setTagFilter(tagFilter === tk.short ? null : tk.short)}
              >
                {tk.short} <span className="font-mono text-label opacity-70">{counts.get(tk.short)}</span>
              </button>
            ))}
          <button
            className={`ticker-chip ${withIndex ? 'is-active' : ''}`}
            aria-pressed={withIndex}
            onClick={() => {
              setWithIndex((v) => !v)
              setTagFilter(null)
            }}
          >
            지수 뉴스 포함
          </button>
        </div>
      )}

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState label="뉴스를 불러오지 못했어요" onRetry={retry} />
      ) : entries.length === 0 ? (
        <Empty label="관련 뉴스를 찾지 못했어요" />
      ) : (
        <>
          {stillLoading && (
            <p role="status" className="text-label text-muted">
              관심종목 {feedTickers.length}개 중 {loaded}개 불러옴 · 나머지가 도착하면 목록에 더해져요
            </p>
          )}
          {partialError && (
            <p role="status" className="text-sm text-muted">
              일부 종목의 뉴스를 가져오지 못했습니다.{' '}
              <button className="text-action underline" onClick={retry}>
                실패한 종목 다시 조회
              </button>
            </p>
          )}
          <p className="text-label text-muted">
            {mode === 'one' ? `'${t.name}' 관련 최신 뉴스` : `관심종목 ${feedTickers.length}개`} · 출처 Google News ·
            최신순 · 누르면 새 탭에서 열려요
          </p>
          <ul className="news-list">
            {entries.map(({ n, d, tag }, i) => {
              const fresh = d != null && Date.now() - d.getTime() < FRESH_MS
              return (
                <li key={i}>
                  <a href={n.link} target="_blank" rel="noreferrer" className="news-item group">
                    <span className="news-title">
                      {fresh && <span className="news-new">새 기사</span>}
                      {n.title}
                    </span>
                    <span className="news-meta">
                      {tag && <span className="text-accent font-medium">{tag}</span>}
                      <span>{[n.source, d ? relTime(d) : n.published].filter(Boolean).join(' · ')}</span>
                      <Icon name="external" size={13} />
                      <span className="sr-only">(새 탭에서 열림)</span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
