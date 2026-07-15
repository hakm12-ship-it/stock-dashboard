import { useQuery } from '@tanstack/react-query'
import { getIndex } from '../lib/api'
import { fmtNum, changeColor, changeSign } from '../lib/format'
import { marketStatus } from '../lib/market'
import type { Market } from '../data/tickers'

function IndexItem({ name, market }: { name: string; market: Market }) {
  const { data } = useQuery({ queryKey: ['index', name], queryFn: () => getIndex(name) })
  const st = marketStatus(market)
  return (
    <div className="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2.5 py-2 card-shadow">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[0.6rem] uppercase tracking-[0.05em] text-muted truncate">{name}</span>
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${st.open ? 'bg-accent animate-pulse' : 'bg-muted/50'}`}
          title={st.label}
        />
      </div>
      {data ? (
        <div className="min-w-0">
          <div className="font-mono font-semibold tnum text-[0.85rem] leading-tight truncate">
            {fmtNum(data.last, 2)}
          </div>
          <div className={`font-mono text-[0.64rem] ${changeColor(data.change)}`}>
            {changeSign(data.change)} {Math.abs(data.changePct).toFixed(2)}%
          </div>
        </div>
      ) : (
        <div className="h-8 mt-0.5 rounded bg-surface-2 animate-pulse" />
      )}
    </div>
  )
}

export default function IndexStrip() {
  return (
    <div className="flex gap-2">
      <IndexItem name="KOSPI" market="KR" />
      <IndexItem name="KOSDAQ" market="KR" />
      <IndexItem name="NASDAQ" market="US" />
    </div>
  )
}
