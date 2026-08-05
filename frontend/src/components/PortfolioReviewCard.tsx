import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { postPortfolioReview } from '../lib/api'
import type { Holding } from '../lib/holdings'
import type { Trade } from '../lib/trades'
import { changeColor, fmtChange } from '../lib/format'
import { Panel } from './ui'

// 비중 막대 색. 앰버는 1등 하나만 — 화면당 2~3곳 원칙이라 여기서 다 써버리면
// 정작 강조해야 할 곳이 묻힌다. 나머지는 무채색 계조로 순서만 읽히게 한다.
const BAR = ['bg-accent', 'bg-slate-400', 'bg-slate-500', 'bg-slate-600', 'bg-slate-700']

export default function PortfolioReviewCard({
  holdings,
  trades,
}: {
  holdings: Holding[]
  trades: Trade[]
}) {
  const [open, setOpen] = useState(false)
  // 구성이 바뀌지 않으면 다시 물어볼 이유가 없다 — 백엔드도 2시간 캐시한다.
  const key = holdings.map((h) => `${h.ticker}:${h.qty}:${h.avg}`).join('|')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['portfolio-review', key],
    queryFn: () =>
      postPortfolioReview(
        holdings.map((h) => ({
          ticker: h.ticker, name: h.name, market: h.market, qty: h.qty, avg: h.avg,
        })),
        trades.map((t) => ({ ticker: t.ticker, date: t.date, side: t.side })),
      ),
    enabled: holdings.length > 0,
    retry: false,
    staleTime: 2 * 60 * 60 * 1000,
  })

  if (holdings.length === 0) return null
  if (isLoading) return <div className="h-40 rounded-xl bg-surface-2 animate-pulse" />
  if (isError || !data?.available || !data.analysis) return null

  const a = data.analysis
  const c = data.comment
  const hasDetail = (data.observations?.length ?? 0) > 0 || (c?.watchPoints?.length ?? 0) > 0

  return (
    <Panel label="🔍 포트폴리오 진단">
      {c?.headline && <p className="text-caption font-semibold leading-snug mb-1.5">{c.headline}</p>}
      {c?.summary && <p className="text-label text-muted leading-relaxed mb-3">{c.summary}</p>}

      {/* 비중 — 숫자를 나열하는 것보다 한 줄 막대가 쏠림을 훨씬 빨리 보여준다 */}
      <div className="flex h-2 rounded-full overflow-hidden mb-2">
        {a.positions.map((p, i) => (
          <div
            key={p.ticker}
            className={BAR[Math.min(i, BAR.length - 1)]}
            style={{ width: `${p.weight}%` }}
          />
        ))}
      </div>
      <div className="space-y-1 mb-3">
        {a.positions.map((p, i) => (
          <div key={p.ticker} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-sm shrink-0 ${BAR[Math.min(i, BAR.length - 1)]}`} />
            <span className="text-label truncate flex-1">{p.name}</span>
            {p.leverage > 1 && (
              <span className="text-label text-muted shrink-0">{p.leverage}x</span>
            )}
            <span className="font-mono text-label tnum shrink-0">{p.weight.toFixed(0)}%</span>
            <span className={`font-mono text-label tnum shrink-0 w-14 text-right ${changeColor(p.plPct)}`}>
              {fmtChange(p.plPct)}
            </span>
          </div>
        ))}
      </div>

      {/* 근거는 접어둔다. 코멘트·관찰·주의점이 같은 사실을 세 번 반복해서,
          다 펼치면 카드 하나가 화면을 꽉 채우고 홈의 나머지가 그만큼 밀린다.
          코멘트가 없을 때(LLM 실패)는 관찰이 유일한 내용이라 펼친 채로 둔다. */}
      {hasDetail && (
        <div className="pt-3 border-t border-border">
          {c && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="w-full min-h-[44px] -my-2 flex items-center justify-center text-label text-muted active:opacity-70"
            >
              {open ? '근거 수치 접기 ▴' : '근거 수치 보기 ▾'}
            </button>
          )}
          {(open || !c) && (
            <div className={c ? 'mt-2' : ''}>
              <ul className="space-y-1.5">
                {data.observations?.map((o, i) => (
                  <li key={i} className="text-label text-muted leading-relaxed flex gap-1.5">
                    <span className="shrink-0">·</span>
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
              {c?.watchPoints && c.watchPoints.length > 0 && (
                <>
                  <div className="text-label font-semibold text-muted mt-3 mb-1.5">
                    값이 크게 움직일 수 있는 지점
                  </div>
                  <ul className="space-y-1">
                    {c.watchPoints.map((w, i) => (
                      <li key={i} className="text-label text-muted leading-relaxed flex gap-1.5">
                        <span className="shrink-0">·</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-label text-muted/70 mt-3">
        보유 구성을 수치로 설명한 참고 자료예요 · 매수·매도 권유가 아니며 판단은 본인 몫입니다
        {data.comment == null && ' · AI 코멘트를 못 받아 수치 관찰만 표시했어요'}
        {data.stale && ' · 새 코멘트를 못 받아 직전 것을 보여주고 있어요'}
      </p>
    </Panel>
  )
}
