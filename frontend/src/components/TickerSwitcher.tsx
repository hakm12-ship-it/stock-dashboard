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
            className={`shrink-0 px-4 min-h-[44px] rounded-full border text-sm font-medium transition-colors ${
              // 선택 칩은 배경 단차만으로는 surface/surface-2 차이가 너무 옅어
              // 어느 종목을 보고 있는지 놓친다. 테두리를 밝혀 확실히 구분한다.
              active
                ? 'bg-surface-2 border-muted/60 text-text'
                : 'bg-surface border-border text-muted active:bg-surface-2'
            }`}
          >
            <span className="font-mono text-label mr-1.5 opacity-70">
              {t.market}
            </span>
            {t.short}
          </button>
        )
      })}
    </div>
  )
}
