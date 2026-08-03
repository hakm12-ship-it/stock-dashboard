import { useQuery } from '@tanstack/react-query'
import { getMacro } from '../lib/api'
import { fmtNum, changeColor, changeSign } from '../lib/format'

function MacroItem({ label, unit, value }: { label: string; unit: string; value?: { last: number; change: number; changePct: number } }) {
  return (
    <div className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2.5 py-2 card-shadow">
      <span className="text-[0.6rem] uppercase tracking-[0.05em] text-muted truncate block">{label}</span>
      {value ? (
        <div className="min-w-0">
          <div className="font-mono font-semibold tnum text-[0.85rem] leading-tight truncate">
            {fmtNum(value.last, 2)}
            {unit}
          </div>
          <div className={`font-mono text-[0.64rem] ${changeColor(value.change)}`}>
            {changeSign(value.change)} {Math.abs(value.changePct).toFixed(2)}%
          </div>
        </div>
      ) : (
        <div className="h-8 mt-0.5 rounded bg-surface-2 animate-pulse" />
      )}
    </div>
  )
}

export default function MacroStrip() {
  const { data } = useQuery({ queryKey: ['macro'], queryFn: getMacro })
  return (
    <div className="flex gap-2">
      <MacroItem label="원/달러" unit="원" value={data?.usdkrw} />
      <MacroItem label="WTI 원유" unit="$" value={data?.wti} />
    </div>
  )
}
