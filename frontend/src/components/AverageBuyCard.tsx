import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices } from '../lib/api'
import type { Holding } from '../lib/holdings'
import { changeColor, fmtPct, fmtPrice, fmtSignedPrice } from '../lib/format'

// 계산기는 열어봐야 필요한 화면이라 초기 번들에 넣지 않는다.
const AverageBuySheet = lazy(() => import('./AverageBuySheet'))

/** 보유 중인 종목의 상세 화면에만 뜨는 줄 — 내 평단·손익과 추가 매수 계산 입구. */
export default function AverageBuyCard({ holding }: { holding: Holding }) {
  const [open, setOpen] = useState(false)
  // 다른 패널이 이미 받아둔 것과 같은 키라 추가 호출이 나가지 않는다.
  const { data } = useQuery({
    queryKey: ['prices', holding.ticker, '1m'],
    queryFn: () => getPrices(holding.ticker, '1m'),
  })
  const last = data?.at(-1)?.close
  const cost = holding.avg * holding.qty
  const value = last != null ? last * holding.qty : cost
  const pl = value - cost

  return (
    <>
      <div className="bg-surface border border-border rounded-xl px-4 py-3 card-shadow flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[8.5rem] flex-1">
          <div className="text-label text-muted">내 보유</div>
          <div className="font-mono text-caption tnum flex flex-wrap gap-x-2">
            <span className="whitespace-nowrap">{holding.qty.toLocaleString('ko-KR')}주</span>
            <span className="whitespace-nowrap">평단 {fmtPrice(holding.avg, holding.market)}</span>
          </div>
          {last != null ? (
            <div className={`font-mono text-label tnum flex flex-wrap gap-x-1.5 ${changeColor(pl)}`}>
              <span className="text-muted font-sans">평가손익</span>
              <span className="whitespace-nowrap">{fmtSignedPrice(pl, holding.market)}</span>
              <span className="whitespace-nowrap">({fmtPct(cost ? (pl / cost) * 100 : 0)})</span>
            </div>
          ) : (
            <div className="text-label text-muted">시세 조회 전 · 평가 대기</div>
          )}
        </div>
        <button onClick={() => setOpen(true)} className="button button-quiet shrink-0 px-3">
          추가 매수 계산
        </button>
      </div>
      {open && (
        <Suspense fallback={null}>
          <AverageBuySheet holding={holding} price={last} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
