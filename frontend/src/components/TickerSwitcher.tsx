import type { FocusTicker } from '../data/tickers'

export default function TickerSwitcher({
  tickers,
  selected,
  onSelect,
}: {
  tickers: FocusTicker[]
  selected: FocusTicker
  onSelect: (t: FocusTicker) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3">
      {tickers.map((t) => {
        const active = t.ticker === selected.ticker
        return (
          <button
            key={t.ticker}
            onClick={() => onSelect(t)}
            className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
              active
                ? 'bg-accent/15 border-accent text-text'
                : 'bg-surface border-border text-muted active:bg-surface-2'
            }`}
          >
            <span className="font-mono text-[0.7rem] mr-1.5 opacity-70">
              {t.market}
            </span>
            {t.short}
          </button>
        )
      })}
    </div>
  )
}
