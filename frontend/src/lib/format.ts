import type { Market, FocusTicker } from '../data/tickers'

const usd = (v: number): string =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const fmtPrice = (v: number | null | undefined, market: Market): string => {
  if (v == null) return '—'
  return market === 'KR' ? `${Math.round(v).toLocaleString('ko-KR')}원` : usd(v)
}

// 지수는 통화 단위 없이 포인트로, 그 외는 통화 붙여서
export const fmtQuote = (v: number | null | undefined, t: FocusTicker): string => {
  if (v == null) return '—'
  if (t.kind === 'index') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return fmtPrice(v, t.market)
}

export const fmtNum = (v: number | null | undefined, d = 2): string =>
  v == null
    ? '—'
    : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })

/**
 * 부호를 붙인 비율 (예: "+4.95%", "−7.08%"). 매수가 대비 손익·기간 수익률처럼
 * '기준점 대비' 값에 쓴다. 전일 대비는 fmtChange의 ▲/▼로 구분한다.
 */
export const fmtPct = (v: number | null | undefined, d = 2): string =>
  v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}%`

/** 부호를 붙인 금액 (예: "+1,148,420원", "−$120.50"). */
export const fmtSignedPrice = (v: number | null | undefined, market: Market): string =>
  v == null ? '—' : `${v >= 0 ? '+' : '−'}${fmtPrice(Math.abs(v), market)}`

export const fmtCap = (v: number | null | undefined, market: Market): string => {
  if (v == null) return '—'
  if (market === 'US') {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    return `$${(v / 1e6).toFixed(0)}M`
  }
  const jo = v / 1e12
  return jo >= 1
    ? `${jo.toLocaleString('ko-KR', { maximumFractionDigits: jo >= 100 ? 0 : 1 })}조`
    : `${Math.round(v / 1e8).toLocaleString()}억`
}

export const fmtEps = (v: number | null | undefined, market: Market): string => {
  if (v == null) return '—'
  return fmtPrice(v, market)
}

// 상승=빨강 / 하락=파랑 (KR 관례) 클래스
export const changeColor = (v: number): string => (v >= 0 ? 'text-up' : 'text-down')
export const changeSign = (v: number): string => (v >= 0 ? '▲' : '▼')

/**
 * 등락률을 화살표+절댓값으로 (예: "▲ 1.23%"). 부호는 화살표가 나타내므로 숫자는 절댓값.
 * 방향과 크기를 따로 받을 수 있다 — 등락'액'으로 방향을 정하고 등락'률'을 보여주는 자리가 많아서다.
 */
export const fmtChange = (pct: number | null | undefined, dir?: number): string => {
  if (pct == null) return '—'
  return `${changeSign(dir ?? pct)} ${Math.abs(pct).toFixed(2)}%`
}

/**
 * 받침에 맞춰 조사를 붙인다 (예: josa('나스닥', '은', '는') → '나스닥은').
 * 한글로 끝나지 않으면(영문 티커 등) '은(는)'처럼 둘 다 적는다.
 */
export const josa = (word: string, withBatchim: string, withoutBatchim: string): string => {
  const code = word.trim().charCodeAt(word.trim().length - 1)
  if (code >= 0xac00 && code <= 0xd7a3) {
    return `${word}${(code - 0xac00) % 28 ? withBatchim : withoutBatchim}`
  }
  return `${word}${withBatchim}(${withoutBatchim})`
}
