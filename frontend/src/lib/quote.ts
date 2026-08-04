import type { Candle, IndexData } from './api'

export interface Quote {
  /** 표시할 현재가. 데이터가 아직 없으면 undefined */
  price?: number
  /** 전일 대비 등락액 */
  change: number
  /** 전일 대비 등락률(%) */
  changePct: number
  /** 등락을 계산할 만큼 데이터가 있는지 — false면 등락 표시를 숨긴다 */
  hasChange: boolean
}

/**
 * 표시용 시세를 고른다.
 *
 * 지수는 FDR 일봉 갱신이 느려서 네이버 실시간 값을 쓰고, 개별 종목은 일봉의
 * 마지막 두 개로 등락을 낸다. 홈 카드와 종목 상세가 **같은 규칙**을 써야
 * 한 화면에서 다른 가격이 보이지 않는다 — 그래서 한 곳에 모아둔다.
 */
export function pickQuote(candles: Candle[] | undefined, index: IndexData | undefined): Quote {
  if (index) {
    return {
      price: index.last,
      change: index.change,
      changePct: index.changePct,
      hasChange: true,
    }
  }
  const last = candles?.at(-1)
  if (!last) return { change: 0, changePct: 0, hasChange: false }

  const prev = candles?.at(-2)
  if (!prev) return { price: last.close, change: 0, changePct: 0, hasChange: false }

  const change = last.close - prev.close
  return {
    price: last.close,
    change,
    changePct: prev.close ? (change / prev.close) * 100 : 0,
    hasChange: true,
  }
}
