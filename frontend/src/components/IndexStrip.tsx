import { useQuery } from '@tanstack/react-query'
import { getIndex } from '../lib/api'
import { fmtNum, changeColor, changeSign } from '../lib/format'
import { marketStatus } from '../lib/market'
import type { Market } from '../data/tickers'

function IndexItem({ name, market }: { name: string; market: Market }) {
  const { data } = useQuery({ queryKey: ['index', name], queryFn: () => getIndex(name) })
  const st = marketStatus(market)
  return (
    <div className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 card-shadow">
      <div className="flex items-center justify-between">
        <span className="text-[0.62rem] uppercase tracking-[0.06em] text-muted">{name}</span>
        <span className={`flex items-center gap-1 text-[0.55rem] ${st.open ? 'text-accent' : 'text-muted'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st.open ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
          {st.label}
        </span>
      </div>
      {data ? (
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-semibold tnum text-[0.95rem]">{fmtNum(data.last, 2)}</span>
          <span className={`font-mono text-[0.72rem] ${changeColor(data.change)}`}>
            {changeSign(data.change)} {Math.abs(data.changePct).toFixed(2)}%
          </span>
        </div>
      ) : (
        <div className="h-5 mt-0.5 rounded bg-surface-2 animate-pulse" />
      )}
    </div>
  )
}

export default function IndexStrip() {
  return (
    <div className="flex gap-2">
      <IndexItem name="KOSPI" market="KR" />
      <IndexItem name="NASDAQ" market="US" />
    </div>
  )
}
