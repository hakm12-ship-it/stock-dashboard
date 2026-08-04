import { useQuery } from '@tanstack/react-query'
import { getNightGapHistory } from '../lib/api'
import { Panel } from './ui'
import { changeColor } from '../lib/format'

export default function NightGapHistoryPanel({ ticker }: { ticker: string }) {
  const { data } = useQuery({
    queryKey: ['night-gap-history', ticker],
    queryFn: () => getNightGapHistory(ticker),
    staleTime: 6 * 60 * 60 * 1000, // 백엔드도 6시간 캐시
  })
  if (!data?.available || !data.buckets?.length) return null

  return (
    <Panel label="🌙 야간 갭, 다음날 시가를 맞췄나">
      <p className="text-[0.7rem] text-muted leading-relaxed mb-3">
        야간 perp 등락과, 그 다음 거래일 <strong>시가</strong>의 전일종가 대비 변화를 짝지어 봤어요.
        (최근 {data.samples}거래일)
      </p>

      <div className="flex gap-2 mb-3">
        <div className="flex-1 bg-surface-2 rounded-lg px-2.5 py-2">
          <div className="text-[0.6rem] text-muted">방향 일치율</div>
          <div className="font-mono text-base font-semibold">
            {(data.directionMatch ?? 0).toFixed(0)}%
          </div>
        </div>
        <div className="flex-1 bg-surface-2 rounded-lg px-2.5 py-2">
          <div className="text-[0.6rem] text-muted">상관계수</div>
          <div className="font-mono text-base font-semibold">
            {(data.correlation ?? 0).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex text-[0.6rem] text-muted pb-1 border-b border-border">
          <span className="flex-1">야간 갭이</span>
          <span className="w-16 text-right">다음날 시가</span>
          <span className="w-14 text-right">상승비율</span>
        </div>
        {data.buckets.map((b) => (
          <div key={b.label} className="flex items-center text-[0.72rem] py-0.5">
            <span className="flex-1">
              {b.label}
              <span className="text-muted text-[0.6rem] ml-1">n={b.count}</span>
            </span>
            <span className={`w-16 text-right font-mono ${changeColor(b.avgOpenChange)}`}>
              {b.avgOpenChange >= 0 ? '+' : ''}
              {b.avgOpenChange.toFixed(2)}%
            </span>
            <span className="w-14 text-right font-mono text-muted">{b.upRatio.toFixed(0)}%</span>
          </div>
        ))}
      </div>

      <p className="text-[0.6rem] text-muted leading-relaxed mt-3">
        표본이 {data.samples}일뿐이고 한 시기의 장세만 담고 있어요 · 과거 성과가 미래를 보장하지
        않아요 · 참고용, 투자 권유 아님
      </p>
    </Panel>
  )
}
