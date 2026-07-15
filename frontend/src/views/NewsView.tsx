import { useQuery } from '@tanstack/react-query'
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

export default function NewsView({ t }: { t: FocusTicker }) {
  const news = useQuery({ queryKey: ['news', t.market, t.name], queryFn: () => getNews(t.market, t.name) })

  if (news.isLoading) return <Loading />
  if (news.isError) return <ErrorState onRetry={() => news.refetch()} />
  if (!news.data || news.data.length === 0) return <Empty label="관련 뉴스를 찾지 못했어요" />

  // 최신순 정렬 (파싱 실패는 뒤로)
  const items: { n: NewsItem; d: Date | null }[] = news.data
    .map((n) => ({ n, d: parseDate(n.published) }))
    .sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0))

  const DAY = 24 * 60 * 60 * 1000

  return (
    <div className="space-y-2">
      <p className="text-[0.66rem] text-muted">'{t.name}' 관련 최신 뉴스 · 출처 Google News · 최신순</p>
      {items.map(({ n, d }, i) => {
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
            <div className="text-[0.66rem] text-muted mt-1.5 font-mono">
              {[n.source, d ? relTime(d) : n.published].filter(Boolean).join(' · ')}
            </div>
          </a>
        )
      })}
    </div>
  )
}
