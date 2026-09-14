import { lazy, Suspense, useState } from 'react'
import type { Holding } from '../lib/holdings'
import { fmtPrice, fmtNum, fmtChange, fmtPct, fmtSignedPrice, changeColor } from '../lib/format'
import { ChartFallback } from './ui'
import { usePortfolioValue } from './usePortfolioValue'

// 차트 라이브러리(lightweight-charts)는 무거워서 실제로 펼칠 때만 받는다.
const PortfolioChart = lazy(() => import('./PortfolioChart'))

export default function PortfolioSummary({
  holdings,
  light,
  onManage,
  onJournal,
}: {
  holdings: Holding[]
  light: boolean
  onManage: () => void
  onJournal: () => void
}) {
  const [chartOpen, setChartOpen] = useState(false)
  const { rows, rate, fx, hasMissingPrices, canUnify, uniValue, uniPL, uniPct, fetching, refetch } =
    usePortfolioValue(holdings)
  const hasHoldings = rows.length > 0

  return (
    <section
      id="my-assets"
      className="bg-surface border border-border rounded-xl p-4 card-shadow scroll-mt-24"
      aria-labelledby="my-assets-title"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 id="my-assets-title" className="panel-title">
          내 자산
        </h2>
        {/* -my-3로 탭 영역만 넓히고 줄 높이는 유지 (터치타겟 44px) */}
        <div className="flex gap-1 -my-3 -mr-2">
          <button onClick={onJournal} className="text-action">
            매매일지
          </button>
          <button onClick={onManage} className="text-action text-action-strong">
            보유 관리
          </button>
        </div>
      </div>

      {!hasHoldings ? (
        <div className="pt-1">
          <p className="text-caption text-muted leading-relaxed">
            보유 수량과 평균 매수가를 입력하면 원화로 합친 평가액과 손익을 볼 수 있어요.
          </p>
          <button onClick={onManage} className="button button-quiet w-full mt-3" aria-label="보유종목 등록하기">
            보유종목 등록하기
          </button>
        </div>
      ) : (
        <>
          {!canUnify && (
            <div className="py-3 text-sm text-muted" role="status">
              <p>
                {fetching
                  ? '평가에 필요한 시세와 환율을 조회하고 있습니다.'
                  : '시세 또는 환율이 없어 평가액을 계산할 수 없습니다.'}
              </p>
              {!fetching && (
                <button className="button button-quiet mt-2" onClick={refetch}>
                  다시 조회
                </button>
              )}
            </div>
          )}
          {canUnify && (
            <div className="mb-3">
              <div className="text-label text-muted">총 평가액 · 원화 환산</div>
              <div className="font-mono text-2xl font-semibold tnum leading-tight">{fmtPrice(uniValue, 'KR')}</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-label text-muted">평가손익</span>
                <span className={`font-mono text-sm tnum ${changeColor(uniPL)}`}>
                  {fmtSignedPrice(uniPL, 'KR')} ({fmtPct(uniPct)})
                </span>
              </div>
            </div>
          )}

          {!hasMissingPrices && (rows.length > 1 || !canUnify) && (
            <div className="pt-2 border-t border-border">
              <div className="flex justify-between text-label text-muted mb-1">
                <span>시장별</span>
                <span>평가액 · 손익률</span>
              </div>
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.m} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">{r.m === 'KR' ? '한국' : '미국'}</span>
                    <div className="text-right whitespace-nowrap">
                      <span className="font-mono tnum text-sm">{fmtPrice(r.value, r.m)}</span>
                      <span className={`font-mono tnum text-label ml-2 ${changeColor(r.pl)}`}>{fmtPct(r.pct)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rate != null && (
            <div className="text-label text-muted mt-2 flex justify-between gap-2">
              <span>적용 환율</span>
              <span className="font-mono tnum">
                {fmtNum(rate, 1)}원
                {fx.data && (
                  <span className={changeColor(fx.data.change)}> {fmtChange(fx.data.changePct, fx.data.change)}</span>
                )}
              </span>
            </div>
          )}

          <button
            onClick={() => setChartOpen((v) => !v)}
            aria-expanded={chartOpen}
            className="text-action w-full justify-center mt-1"
          >
            {chartOpen ? '자산 추이 접기' : '자산 추이 차트 보기'}
          </button>
          {chartOpen && (
            <Suspense fallback={<ChartFallback height={180} />}>
              <PortfolioChart holdings={holdings} light={light} />
            </Suspense>
          )}
        </>
      )}
    </section>
  )
}
