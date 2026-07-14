import { useQuery } from '@tanstack/react-query'
import { getNews } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { Loading, Empty, ErrorState } from '../components/ui'

export default function NewsView({ t }: { t: FocusTicker }) {
  const news = useQuery({ queryKey: ['news', t.market, t.name], queryFn: () => getNews(t.market, t.name) })

  if (news.isLoading) return <Loading />
  if (news.isError) return <ErrorState onRetry={() => news.refetch()} />
  if (!news.data || news.data.length === 0) return <Empty label="관련 뉴스를 찾지 못했어요" />

  return (
    <div className="space-y-2">
      <p className="text-[0.66rem] text-muted">'{t.name}' 관련 최신 뉴스 · 출처 Google News</p>
      {news.data.map((n, i) => (
        <a
          key={i}
          href={n.link}
          target="_blank"
          rel="noreferrer"
          className="block bg-surface border border-border rounded-xl px-4 py-3 active:bg-surface-2 transition-colors"
        >
          <div className="text-sm font-medium leading-snug">{n.title}</div>
          <div className="text-[0.66rem] text-muted mt-1.5 font-mono">
            {[n.source, n.published].filter(Boolean).join(' · ')}
          </div>
        </a>
      ))}
    </div>
  )
}
