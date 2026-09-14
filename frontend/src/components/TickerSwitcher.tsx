import { useEffect, useRef } from 'react'
import type { FocusTicker } from '../data/tickers'

const same = (a: FocusTicker, b: FocusTicker) => a.ticker === b.ticker && a.market === b.market

export default function TickerSwitcher({
  tickers,
  selected,
  onSelect,
}: {
  tickers: FocusTicker[]
  selected: FocusTicker
  onSelect: (t: FocusTicker) => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const activeChip = useRef<HTMLButtonElement>(null)

  // 선택한 칩이 줄 밖에 있으면 가운데로 옮긴다. scrollIntoView는 페이지까지 세로로 움직여서 쓰지 않는다.
  useEffect(() => {
    const box = strip.current
    const chip = activeChip.current
    if (!box || !chip) return
    box.scrollLeft = chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2
  }, [selected.ticker, selected.market])

  return (
    <div ref={strip} className="ticker-switcher no-scrollbar" role="group" aria-label="분석 종목 선택">
      {tickers.map((t) => {
        const active = same(t, selected)
        return (
          <button
            key={`${t.market}-${t.ticker}`}
            ref={active ? activeChip : undefined}
            onClick={() => onSelect(t)}
            aria-pressed={active}
            className={`ticker-chip ${active ? 'is-active' : ''}`}
          >
            <span className="font-mono text-label opacity-70" aria-hidden="true">
              {t.market}
            </span>
            {t.short}
            <span className="sr-only"> ({t.market === 'KR' ? '한국' : '미국'})</span>
          </button>
        )
      })}
    </div>
  )
}
