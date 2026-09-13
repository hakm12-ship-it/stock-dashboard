import { ErrorState } from './ui'
import { useQuery } from '@tanstack/react-query'
import { getMacro, type MacroItem as MacroValue } from '../lib/api'
import { fmtNum, fmtChange, changeColor } from '../lib/format'

function MacroItem({ label, unit, value }: { label: string; unit: string; value?: MacroValue }) {
  return (
    <div className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2.5 py-2 card-shadow">
      <span className="text-label uppercase tracking-[0.05em] text-muted truncate block">{label}</span>
      {value ? (
        <div className="min-w-0">
          <div className="font-mono font-semibold tnum text-caption leading-tight truncate">
            {fmtNum(value.last, 2)}
            {unit}
          </div>
          <div className={`font-mono text-label ${changeColor(value.change)}`}>
            {fmtChange(value.changePct, value.change)}
          </div>
        </div>
      ) : (
        <div className="h-8 mt-0.5 rounded bg-surface-2 animate-pulse" />
      )}
    </div>
  )
}

export default function MacroStrip() {
  const { data, isError, isPending, refetch } = useQuery({ queryKey: ['macro'], queryFn: getMacro })
  if (isError) return <ErrorState label="환율·원유 조회 실패" onRetry={() => refetch()} />
  if (!isPending && !data?.usdkrw && !data?.wti)
    return <p className="text-label text-muted p-3">환율·원유 데이터 없음</p>
  return (
    <div className="flex gap-2">
      <MacroItem label="원/달러" unit="원" value={data?.usdkrw} />
      <MacroItem label="WTI 원유" unit="$" value={data?.wti} />
    </div>
  )
}
