import { useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { getNews, type NewsItem } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Loading, Empty, ErrorState } from '../components/ui'

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

const DAY = 24 * 60 * 60 * 1000

interface Entry {
  n: NewsItem
  d: Date | null
  tag?: string
}

export default function NewsView({ t, tickers }: { t: FocusTicker; tickers: FocusTicker[] }) {
  const [mode, setMode] = useState<'one' | 'all'>('one')

  const single = useQuery({
    queryKey: ['news', t.market, t.name],
    queryFn: () => getNews(t.market, t.name),
    enabled: mode === 'one',
  })
  const allQs = useQueries({
    queries: tickers.map((tk) => ({
      queryKey: ['news', tk.market, tk.name],
      queryFn: () => getNews(tk.market, tk.name),
      enabled: mode === 'all',
    })),
  })

  let entries: Entry[] = []
  if (mode === 'one') {
    entries = (single.data ?? []).map((n) => ({ n, d: parseDate(n.published) }))
  } else {
    const seen = new Set<string>()
    tickers.forEach((tk, i) => {
      for (const n of allQs[i].data ?? []) {
        if (seen.has(n.title)) continue // 여러 종목에 걸친 같은 기사 중복 제거
        seen.add(n.title)
        entries.push({ n, d: parseDate(n.published), tag: tk.short })
      }
    })
  }
  entries.sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0))
  if (mode === 'all') entries = entries.slice(0, 40)

  const isLoading = mode === 'one' ? single.isLoading : allQs.every((q) => q.isLoading)
  const isError = mode === 'one' && single.isError

  return (
    <div className="space-y-2">
      {/* 범위 토글 */}
      <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
        {(
          [
            ['one', `${t.short} 뉴스`],
            ['all', '관심종목 전체'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              m === mode ? 'bg-accent/20 text-text' : 'text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState onRetry={() => single.refetch()} />
      ) : entries.length === 0 ? (
        <Empty label="관련 뉴스를 찾지 못했어요" />
      ) : (
        <>
          <p className="text-[0.66rem] text-muted">
            {mode === 'one' ? `'${t.name}' 관련 최신 뉴스` : '관심종목 전체 뉴스'} · 출처 Google News ·
            최신순
          </p>
          {entries.map(({ n, d, tag }, i) => {
            const fresh = d != null && Date.now() - d.getTime() < DAY
            return (
              <a
                key={i}
                href={n.link}
                target="_blank"
                rel="noreferrer"
                className="block bg-surface border border-border rounded-xl px-4 py-3 card-shadow active:bg-surface-2 transition-colors"
              >
                <div className="text-sm font-medium leading-snug">
                  {fresh && (
                    <span className="font-mono text-[0.55rem] text-accent border border-accent/40 rounded px-1 py-0.5 mr-1.5 align-middle">
                      NEW
                    </span>
                  )}
                  {n.title}
                </div>
                <div className="text-[0.66rem] text-muted mt-1.5 font-mono flex items-center gap-1.5 flex-wrap">
                  {tag && (
                    <span className="border border-border rounded px-1 py-0.5 text-[0.6rem]">{tag}</span>
                  )}
                  <span>{[n.source, d ? relTime(d) : n.published].filter(Boolean).join(' · ')}</span>
                </div>
              </a>
            )
          })}
        </>
      )}
    </div>
  )
}
