import { useQuery } from '@tanstack/react-query'
import { getAiBriefing } from '../lib/api'
import type { FocusTicker } from '../data/tickers'

const STANCE_STYLE: Record<string, string> = {
  강세: 'bg-up/15 border-up/40 text-up',
  약세: 'bg-down/15 border-down/40 text-down',
  중립: 'bg-surface-2 border-border text-muted',
}

export default function AiBriefingPanel({ t }: { t: FocusTicker }) {
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['ai-briefing', t.market, t.ticker],
    queryFn: () => getAiBriefing(t.market, t.ticker, t.short),
    // refetch()만 허용해 화면 진입·포커스·전체 새로고침으로 AI를 호출하지 않는다.
    enabled: false,
    retry: false,
    // 백엔드가 3시간 캐시하므로 창 포커스마다 다시 물어볼 이유가 없다.
    staleTime: 3 * 60 * 60 * 1000,
  })

  if (!data?.available) {
    const messages: Record<string, string> = {
      daily_limit: '오늘의 AI 생성 한도에 도달했습니다. 기존 분석과 시세는 계속 확인할 수 있어요.',
      quota_cooldown: 'AI 제공처의 요청 제한으로 잠시 쉬고 있습니다. 잠시 후 다시 확인해 주세요.',
      busy: '다른 AI 분석이 진행 중입니다. 잠시 후 다시 조회해 주세요.',
      temporarily_unavailable: 'AI 연결을 잠시 이용할 수 없습니다. 잠시 후 다시 확인해 주세요.',
    }
    const message = messages[data?.reason ?? ''] ?? (data?.stale ? data.error : undefined)
      ?? (isError || data ? 'AI 분석을 가져오지 못했습니다. 잠시 후 다시 요청해 주세요.' : '버튼을 누르면 이 종목의 AI 분석을 요청합니다. 저장된 분석이 있으면 재사용합니다.')
    return (
      <section className="bg-surface border border-border rounded-xl p-4" role="status">
        <h2 className="panel-title">AI 브리핑</h2>
        <p className="text-label text-muted mt-2">{message}</p>
        <button className="button button-quiet mt-2" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'AI 분석 요청 중…' : isError || data ? 'AI 분석 다시 요청' : 'AI 분석 요청'}
        </button>
      </section>
    )
  }

  return (
    <section className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="panel-title">AI 브리핑</h2>
        {data.stance && (
          <span className={`text-label font-semibold px-2 py-0.5 rounded-full border ${STANCE_STYLE[data.stance] ?? STANCE_STYLE['중립']}`}>
            AI 판단 {data.stance}
          </span>
        )}
      </div>
      <p className="text-caption leading-relaxed font-medium">{data.summary}</p>
      {data.bullets && data.bullets.length > 0 && (
        <ul className="mt-2 space-y-1">
          {data.bullets.map((b, i) => (
            <li key={i} className="text-caption text-muted flex gap-1.5">
              <span>·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-label text-muted mt-2">
        AI 생성 분석 — 참고용, 투자 권유 아님
        {data.stale && ' · 새 분석을 못 받아 직전 분석을 보여주고 있어요'}
      </p>
      <button className="button button-quiet mt-2" disabled={isFetching} onClick={() => void refetch()}>
        {isFetching ? 'AI 분석 요청 중…' : 'AI 분석 다시 확인'}
      </button>
      {isError && <p className="text-label text-muted mt-2" role="status">연결하지 못해 이전 분석을 표시합니다.</p>}
    </section>
  )
}
