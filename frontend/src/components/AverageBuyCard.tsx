import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices } from '../lib/api'
import type { Holding } from '../lib/holdings'
import { changeColor, fmtChange, fmtPrice } from '../lib/format'

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
      <div className="bg-surface border border-border rounded-xl px-4 py-3 card-shadow flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-label text-muted">내 보유</div>
          <div className="font-mono text-caption tnum truncate">
            {holding.qty.toLocaleString()}주 · 평단 {fmtPrice(holding.avg, holding.market)}
          </div>
          <div className={`font-mono text-label ${changeColor(pl)}`}>
            {fmtChange(cost ? (pl / cost) * 100 : 0, pl)} ({fmtPrice(Math.abs(pl), holding.market)})
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 min-h-[44px] px-3 rounded-lg border border-border text-label text-text active:border-accent"
        >
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
