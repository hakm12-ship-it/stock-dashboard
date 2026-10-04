import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AI_STATUS_LABELS, getUsageStatus } from '../lib/usageStatus'
import { calendarTimestamp } from '../lib/calendar'

export default function UsageStatusCard() {
  const [open, setOpen] = useState(false)
  const query = useQuery({ queryKey: ['usage-status'], queryFn: getUsageStatus, enabled: open,
    retry: false, staleTime: 30_000, refetchOnWindowFocus: false, refetchInterval: false })
  const data = query.data
  return (
    <section className="bg-surface border border-border rounded-xl p-4 usage-status">
      <button className="w-full min-h-[44px] flex items-center justify-between gap-2 text-caption font-semibold" aria-expanded={open} aria-controls="usage-status-content" onClick={() => setOpen((value) => !value)}>
        호출량·운영 상태 <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div id="usage-status-content">
        <p className="text-label text-muted mb-3">서버 전체 집계 · 한국시간 기준 · 열거나 다시 조회할 때 확인합니다.</p>
        {query.isFetching && !data ? <p className="text-caption text-muted" role="status">집계를 확인하고 있어요.</p>
          : !data ? <p className="text-caption text-muted" role="alert">호출량을 확인하지 못했습니다.</p>
            : <>
              {query.isError && <p className="text-label text-muted mb-2" role="status">새 집계를 받지 못해 마지막 확인값을 표시합니다.</p>}
              <dl className="grid grid-cols-2 gap-2 text-label">
                {[['오늘 AI 생성 시도', `${data.ai.attempts} / ${data.ai.limit}회`], ['남은 생성 한도', `${data.ai.remaining}회`],
                  ['AI 분석 재사용', `${data.ai.cacheHits}회`], ['진행 중 AI', `${data.ai.inflight}건`],
                  ['오늘 API 응답', `${data.api.requests}회`], ['데이터 캐시 적중률', data.api.cacheHitRate == null ? '집계 없음' : `${data.api.cacheHitRate}%`],
                  ['API 오류 응답', `${data.api.httpErrors}회`], ['캐시 원본 조회 실패', `${data.api.cacheErrors}회`]].map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 p-2"><dt className="text-muted">{label}</dt><dd className="font-mono text-caption mt-1">{value}</dd></div>)}
              </dl>
              {!data.ai.configured && <p className="text-label text-muted mt-2">AI 연결이 설정되어 있지 않습니다.</p>}
              {data.ai.cooldownSeconds > 0 && <p className="text-label text-muted mt-2">AI 제공처 제한으로 약 {Math.ceil(data.ai.cooldownSeconds / 60)}분 대기 중입니다.</p>}
              <p className="text-label text-muted mt-3">집계 시작 {calendarTimestamp(data.api.startedAt)} · AI 기준일 {data.ai.date}</p>
              <p className="text-label text-muted mt-2">실패한 모델 요청도 생성 시도에 포함합니다. API 응답 수와 캐시 통계는 외부 제공처의 호출·청구량과 다릅니다.</p>
              <p className="text-label text-muted mt-2">재시작·재배포하면 집계와 AI 한도가 초기화됩니다. 하루 전체 사용량의 영구 기록이나 비용 상한은 아닙니다.</p>
              <h3 className="text-label font-semibold mt-3">최근 AI 오류·요청 대기</h3>
              {data.ai.recentErrors.length ? <ul className="text-label text-muted space-y-1 mt-1">{[...data.ai.recentErrors].reverse().map((error, i) => <li key={i}>{calendarTimestamp(error.at)} · {AI_STATUS_LABELS[error.reason] ?? 'AI 요청 대기'}</li>)}</ul> : <p className="text-label text-muted mt-1">오늘 기록된 오류·대기가 없습니다.</p>}
              {data.api.recentErrors.length > 0 && <details className="text-label text-muted mt-2"><summary className="min-h-[32px] cursor-pointer">최근 API 오류</summary><ul>{[...data.api.recentErrors].reverse().map((error, i) => <li key={i}>{calendarTimestamp(error.at)} · {error.path} · HTTP {error.status}</li>)}</ul></details>}
            </>}
        <button className="button button-quiet mt-3" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? '조회 중…' : '집계 다시 조회'}</button>
      </div>}
    </section>
  )
}
