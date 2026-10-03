import { useQuery, useQueries } from '@tanstack/react-query'
import { getPrices, getFx } from '../lib/api'
import type { Holding } from '../lib/holdings'
import type { Market } from '../data/tickers'

/**
 * 보유종목 평가액·손익(원 환산). 홈의 요약 줄과 내 자산 카드가 같은 값을 쓰도록 한곳에서 계산한다.
 * 쿼리 키는 관심종목 행과 같아서 추가 요청이 생기지 않는다.
 */
export function usePortfolioValue(holdings: Holding[]) {
  const qs = useQueries({
    queries: holdings.map((h) => ({
      queryKey: ['prices', h.ticker, '1m'],
      queryFn: () => getPrices(h.ticker, '1m'),
    })),
  })
  const fx = useQuery({ queryKey: ['fx'], queryFn: getFx, enabled: holdings.length > 0 })
  const rate = fx.data?.usdkrw
  const hasMissingPrices = holdings.some((_, i) => !qs[i].data?.length)

  const groups: Record<Market, { cost: number; value: number }> = {
    KR: { cost: 0, value: 0 },
    US: { cost: 0, value: 0 },
  }
  holdings.forEach((h, i) => {
    const last = qs[i].data?.at(-1)?.close
    const cost = h.avg * h.qty
    groups[h.market].cost += cost
    groups[h.market].value += last != null ? last * h.qty : cost
  })

  const rows = (['KR', 'US'] as Market[])
    .filter((m) => groups[m].cost > 0)
    .map((m) => {
      const { cost, value } = groups[m]
      const pl = value - cost
      return { m, value, pl, pct: cost ? (pl / cost) * 100 : 0 }
    })

  const hasUS = groups.US.cost > 0
  const valuationStale = qs.some((query) => query.isError && query.data != null) || (hasUS && fx.isError && rate != null)
  const canUnify = !hasMissingPrices && (!hasUS || rate != null)
  const uniCost = groups.KR.cost + (rate ? groups.US.cost * rate : 0)
  const uniValue = groups.KR.value + (rate ? groups.US.value * rate : 0)
  const uniPL = uniValue - uniCost
  const uniPct = uniCost ? (uniPL / uniCost) * 100 : 0
  const fetching = qs.some((q) => q.isFetching) || fx.isFetching
  const refetch = () => {
    qs.forEach((q) => void q.refetch())
    void fx.refetch()
  }

  return { rows, rate, fx, hasMissingPrices, canUnify, uniValue, uniPL, uniPct, fetching, refetch, valuationStale }
}
