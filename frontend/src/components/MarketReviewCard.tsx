import { marketReview } from '../lib/marketReview'

export default function MarketReviewCard() {
  const review = marketReview()
  return (
    <details className="bg-surface border border-border rounded-xl p-4 text-label market-review">
      <summary className="cursor-pointer min-h-[32px] font-medium">거래일 갱신 점검 · {review.alerts.length ? `${review.alerts.length}건 확인 필요` : '등록 범위 정상'}</summary>
      <p className="text-muted mt-2">일정 검증일 {review.reviewedAt} · 한국 {review.coverage.KR.join('·')}년 · 미국 {review.coverage.US.join('·')}년</p>
      {review.alerts.length ? <ul className="space-y-2 mt-2">{review.alerts.map((alert) => <li key={alert.id}>
        <p>{alert.message}</p>
        <a className="text-action min-h-[44px]" href={alert.source} target="_blank" rel="noreferrer">거래소 공식 일정 확인 ↗</a>
      </li>)}</ul> : <p className="text-muted mt-2">현재 연도가 등록되어 있고 가까운 특별 거래시간 미확인 건이 없습니다.</p>}
      <p className="text-muted mt-2">등록 데이터의 누락을 점검합니다. 새로운 임시 휴장 공지는 거래소 확인 후 반영해야 합니다.</p>
    </details>
  )
}
