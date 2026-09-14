import { useQuery } from '@tanstack/react-query'
import { getIndex } from '../lib/api'
import { fmtNum, fmtChange, changeColor } from '../lib/format'

// 장 상태는 홈의 시장 요약 줄(MarketSession)이 글자로 보여준다.
function IndexItem({ name, label }: { name: string; label: string }) {
  const { data, isError, refetch } = useQuery({ queryKey: ['index', name], queryFn: () => getIndex(name) })
  return (
    <div className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2.5 py-2 card-shadow">
      <span className="text-label text-muted truncate block">{label}</span>
      {data ? (
        <div className="min-w-0">
          <div className="font-mono font-semibold tnum text-caption leading-tight truncate">
            {fmtNum(data.last, 2)}
          </div>
          <div className={`font-mono text-label ${changeColor(data.change)}`}>
            {fmtChange(data.changePct, data.change)}
          </div>
        </div>
      ) : isError ? (
        <button
          className="text-label text-muted min-h-[44px]"
          onClick={() => refetch()}
          aria-label={`${label} 다시 조회`}
        >
          조회 실패 · 재시도
        </button>
      ) : (
        <div className="h-8 mt-0.5 rounded bg-surface-2 animate-pulse" />
      )}
    </div>
  )
}

export default function IndexStrip() {
  return (
    <div className="flex gap-2">
      <IndexItem name="KOSPI" label="코스피" />
      <IndexItem name="KOSDAQ" label="코스닥" />
      <IndexItem name="NASDAQ" label="나스닥" />
    </div>
  )
}
