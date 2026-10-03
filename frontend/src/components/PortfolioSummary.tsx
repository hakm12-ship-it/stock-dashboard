import { lazy, Suspense, useState } from 'react'
import type { Holding } from '../lib/holdings'
import { fmtPrice, fmtNum, fmtChange, fmtPct, fmtSignedPrice, changeColor } from '../lib/format'
import { ChartFallback } from './ui'
import { usePortfolioValue } from './usePortfolioValue'
import Icon from './Icon'

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
  const { rows, rate, fx, hasMissingPrices, canUnify, uniValue, uniPL, uniPct, fetching, refetch, valuationStale } =
    usePortfolioValue(holdings)
  const hasHoldings = rows.length > 0

  return (
    <section
      id="my-assets"
      tabIndex={-1}
      className="portfolio-card bg-surface border border-border rounded-xl p-4 card-shadow scroll-mt-24"
      aria-labelledby="my-assets-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 mb-3">
        <h2 id="my-assets-title" className="panel-title">
          내 자산
        </h2>
        <div className="flex shrink-0 gap-1 -my-2 -mr-2">
          <button onClick={onJournal} className="text-action">
            매매일지
          </button>
          <button onClick={onManage} className="text-action text-action-strong">
            보유 관리
          </button>
        </div>
      </div>

      {!hasHoldings ? (
        <div className="portfolio-empty-state pt-1">
          <div className="flex items-start gap-3">
            <span className="portfolio-empty-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent">
              <Icon name="wallet" size={22} />
            </span>
            <div className="min-w-0">
              <p className="text-caption font-semibold text-text">평가액과 손익을 한눈에</p>
              <p className="text-caption text-muted leading-relaxed mt-1">
                보유 수량과 평균 매수가를 등록하면 원화로 합친 자산을 확인할 수 있어요.
              </p>
            </div>
          </div>
          <button onClick={onManage} className="button button-primary w-full mt-4" aria-label="보유종목 등록하기">
            <Icon name="plus" size={16} />
            보유종목 등록하기
          </button>
        </div>
      ) : (
        <>
          {valuationStale && <div role="status" className="text-caption text-muted py-2">
            <p>시세·환율 갱신에 실패해 마지막 조회값으로 평가한 금액입니다.</p>
            <button className="text-action" onClick={refetch} disabled={fetching}>{fetching ? '조회 중…' : '평가액 다시 조회'}</button>
          </div>}
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
            <div className="portfolio-total mb-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-caption text-muted">총 평가액</span>
                <span className="text-label text-muted">원화 환산</span>
              </div>
              <div className="font-mono text-h1 font-semibold tnum leading-tight break-words mt-1">
                {fmtPrice(uniValue, 'KR')}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-2">
                <span className="text-caption text-muted">평가손익</span>
                <div
                  className={`flex flex-wrap items-baseline gap-x-1.5 font-mono text-caption font-medium tnum ${changeColor(uniPL)}`}
                >
                  <span>{fmtSignedPrice(uniPL, 'KR')}</span>
                  <span>({fmtPct(uniPct)})</span>
                </div>
              </div>
            </div>
          )}

          {!hasMissingPrices && (rows.length > 1 || !canUnify) && (
            <div className="pt-3 border-t border-border">
              <div className="flex justify-between gap-2 text-label text-muted mb-2">
                <span>시장별</span>
                <span>평가액 · 손익률</span>
              </div>
              <div className="space-y-3">
                {rows.map((r) => (
                  <div key={r.m} className="portfolio-market-row flex items-start justify-between gap-3">
                    <div className="shrink-0 text-caption">
                      <span>{r.m === 'KR' ? '한국' : '미국'}</span>
                      <span className="block text-label text-muted mt-0.5">{r.m === 'KR' ? 'KRW' : 'USD'}</span>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="font-mono tnum text-caption font-medium break-words">
                        {fmtPrice(r.value, r.m)}
                      </div>
                      <div className={`font-mono tnum text-label mt-0.5 ${changeColor(r.pl)}`}>
                        {fmtPct(r.pct)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rate != null && (
            <div className="text-label text-muted mt-3 flex flex-wrap justify-between gap-x-2 gap-y-1">
              <span>적용 환율</span>
              <span className="font-mono tnum">
                1 USD = {fmtNum(rate, 1)}원
                {fx.data && (
                  <span className={changeColor(fx.data.change)}>
                    {' '}
                    {fmtChange(fx.data.changePct, fx.data.change)}
                  </span>
                )}
              </span>
            </div>
          )}

          <button
            onClick={() => setChartOpen((v) => !v)}
            aria-expanded={chartOpen}
            aria-controls="portfolio-history-chart"
            className="text-action w-full justify-center mt-3 border-t border-border"
          >
            {chartOpen ? '자산 추이 접기' : '자산 추이 차트 보기'}
          </button>
          <div id="portfolio-history-chart" hidden={!chartOpen}>
            {chartOpen && (
              <Suspense fallback={<ChartFallback height={180} />}>
                <PortfolioChart holdings={holdings} light={light} />
              </Suspense>
            )}
          </div>
        </>
      )}
    </section>
  )
}
