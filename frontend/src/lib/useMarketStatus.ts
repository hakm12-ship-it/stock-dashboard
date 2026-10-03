import { useEffect, useState } from 'react'
import type { Market } from '../data/tickers'
import { marketStatus } from './market'

// Keep the label current at session boundaries even when network polling has stopped.
export function useMarketStatus(market: Market) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return marketStatus(market, now)
}
