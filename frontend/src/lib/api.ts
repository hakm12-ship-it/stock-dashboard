import axios from 'axios'
import type { Market } from '../data/tickers'

const api = axios.create({ baseURL: '' })

export type Period = '1m' | '3m' | '6m' | '1y'

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface IndexData {
  name: string
  last: number
  change: number
  changePct: number
  series: { time: string; close: number }[]
}

export interface Indicators {
  time: string[]
  rsi: (number | null)[]
  macd: (number | null)[]
  signal: (number | null)[]
  hist: (number | null)[]
  bb_upper: (number | null)[]
  bb_lower: (number | null)[]
  ma20: (number | null)[]
  ma60: (number | null)[]
}

export interface Valuation {
  종목: string
  섹터: string | null
  통화: string | null
  PER: number | null
  PBR: number | null
  EPS: number | null
  ROE: number | null
  배당수익률: number | null
  주당배당금: number | null
  시가총액: number | null
}

export interface ForwardPe {
  price: number | null
  trailing: number | null
  forward: { period: string; eps: number; per: number }[]
}

export type Trend = { years: number[] } & Record<string, (number | null)[] | number[]>

export interface SignalItem {
  name: string
  score: number
  detail: string
}
export interface SignalData {
  signals: SignalItem[]
  total: number
  verdict: string
  maxScore: number
  price: number
  support: { label: string; value: number }[]
  resistance: { label: string; value: number }[]
}

export interface SignalPerf {
  count: number
  avgReturn: number
  winRate: number
}
export interface SignalHistory {
  horizon: number
  evaluated: number
  buy: SignalPerf | null
  sell: SignalPerf | null
  recent: { date: string; verdict: string; fwdReturn: number | null }[]
}

export interface ForecastBand {
  time: string
  upper_inner: number
  lower_inner: number
  upper_outer: number
  lower_outer: number
}
export interface Forecast {
  last: number
  sigma: number
  band: ForecastBand[]
}

export interface NewsItem {
  title: string
  link: string
  source: string
  published: string
}

export interface SymbolResult {
  ticker: string
  name: string
}

export interface Target {
  target: number | null
  recomm: number | null
}

const get = <T>(url: string, params: Record<string, unknown>) =>
  api.get<T>(url, { params }).then((r) => r.data)

export const getIndex = (name: string) => get<IndexData>('/api/index', { name })
export const getPrices = (ticker: string, period: Period) =>
  get<Candle[]>('/api/prices', { ticker, period })
export const getIndicators = (ticker: string, period: Period) =>
  get<Indicators>('/api/indicators', { ticker, period })
export const getValuation = (market: Market, ticker: string) =>
  get<Valuation>('/api/valuation', { market, ticker })
export const getForwardPe = (market: Market, ticker: string) =>
  get<ForwardPe>('/api/forward-pe', { market, ticker })
export const getTrend = (market: Market, ticker: string) =>
  get<Trend | null>('/api/trend', { market, ticker })
export const getSignal = (ticker: string, cfg?: Record<string, number>) =>
  get<SignalData>('/api/signal', { ticker, ...(cfg ?? {}) })
export const getSignalHistory = (ticker: string, cfg?: Record<string, number>) =>
  get<SignalHistory>('/api/signal-history', { ticker, ...(cfg ?? {}) })
export const getForecast = (ticker: string) => get<Forecast>('/api/forecast', { ticker })
export const getNews = (market: Market, name: string) =>
  get<NewsItem[]>('/api/news', { market, name })
export const getSymbols = (market: Market, q: string) =>
  get<SymbolResult[]>('/api/symbols', { market, q })
export const getTarget = (market: Market, ticker: string) =>
  get<Target>('/api/target', { market, ticker })

export interface Fx {
  usdkrw: number
  change: number
  changePct: number
}
export const getFx = () => get<Fx>('/api/fx', {})
export interface FxPoint {
  time: string
  rate: number
}
export const getFxHistory = (period: Period) => get<FxPoint[]>('/api/fx-history', { period })

export interface MacroItem {
  last: number
  change: number
  changePct: number
}
export interface Macro {
  usdkrw: MacroItem
  wti: MacroItem
}
export const getMacro = () => get<Macro>('/api/macro', {})

export interface DailyReport {
  date: string
  summary: string
  tags: { label: string; pct: number }[]
}
export const getDailyReport = () => get<DailyReport>('/api/daily-report', {})

export interface AiBriefing {
  available: boolean
  /** LLM 호출 실패(할당량 초과 등)로 직전 분석을 대신 내려준 경우 true */
  stale?: boolean
  error?: string
  stance?: '강세' | '약세' | '중립'
  summary?: string
  bullets?: string[]
}
export const getAiBriefing = (market: Market, ticker: string, name: string) =>
  get<AiBriefing>('/api/ai-briefing', { market, ticker, name })

export interface NightPrice {
  available: boolean
  usd?: number
  krw?: number
  krxClose?: number
  gapPct?: number
}
export const getNightPrice = (ticker: string) => get<NightPrice>('/api/night-price', { ticker })

export type NightInterval = '5m' | '15m' | '60m' | '1d'
export interface NightCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface NightCandles {
  available: boolean
  candles: NightCandle[]
}
export const getNightCandles = (ticker: string, interval: NightInterval) =>
  get<NightCandles>('/api/night-candles', { ticker, interval })

/** 미국 정규장 밖에서 기초자산 perp로 합성한 레버리지 ETF 추정가 */
export interface SynthPrice {
  available: boolean
  estimate?: number
  lastClose?: number
  lastCloseAt?: number
  changePct?: number
  underlyingName?: string
  underlyingPct?: number
  leverage?: number
  asOf?: number
}
export const getSynthPrice = (ticker: string) => get<SynthPrice>('/api/synth-price', { ticker })

export interface RelatedStock {
  ticker: string
  name: string
  role: string
  changePct: number | null
}
export interface RelatedInsight {
  available: boolean
  insight?: string | null
  /** LLM 호출 실패로 직전 문구를 대신 내려준 경우 true (등락률은 항상 최신) */
  stale?: boolean
  stocks?: RelatedStock[]
}
export const getRelatedInsight = (ticker: string) =>
  get<RelatedInsight>('/api/related-insight', { ticker })

export interface LeverageDecay {
  available: boolean
  underlyingTicker?: string
  underlyingName?: string
  leverage?: number
  days?: number
  underlyingReturn?: number
  naiveExpected?: number
  theoretical?: number
  actualReturn?: number
  totalDecay?: number
  compoundingDrag?: number
  costDrag?: number
  underlyingVol?: number
}
export const getLeverageDecay = (ticker: string, period: Period) =>
  get<LeverageDecay>('/api/leverage-decay', { ticker, period })

export interface NightGapBucket {
  label: string
  count: number
  avgOpenChange: number
  upRatio: number
}
export interface NightGapHistory {
  available: boolean
  samples?: number
  correlation?: number
  directionMatch?: number
  buckets?: NightGapBucket[]
}
export const getNightGapHistory = (ticker: string) =>
  get<NightGapHistory>('/api/night-gap-history', { ticker })

export interface FxAttribution {
  available: boolean
  days?: number
  priceReturn?: number
  fxReturn?: number
  crossTerm?: number
  krwReturn?: number
  fxStart?: number
  fxEnd?: number
}
export const getFxAttribution = (ticker: string, market: Market, period: Period) =>
  get<FxAttribution>('/api/fx-attribution', { ticker, market, period })

export interface MarketTopItem {
  ticker: string
  name: string
  price: number | null
  changePct: number | null
}
export const getMarketTop = (
  direction: 'up' | 'down',
  market: 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'CRYPTO',
) => get<MarketTopItem[]>('/api/market-top', { direction, market })

export interface Group {
  no: number
  name: string
  changeRate: number
  rise: number
  fall: number
}
export const getGroups = (kind: 'industry' | 'theme') => get<Group[]>('/api/groups', { kind })
export const getGroupStocks = (kind: 'industry' | 'theme', no: number) =>
  get<MarketTopItem[]>('/api/group-stocks', { kind, no })

export interface Peer {
  ticker: string
  name: string
  price: number | null
  changePct: number | null
  marketCap: number | null
}
export const getPeers = (market: Market, ticker: string) =>
  get<Peer[]>('/api/peers', { market, ticker })

export interface DealTrend {
  date: string
  foreign: number | null
  organ: number | null
  individual: number | null
  foreignHoldRatio: number | null
  close: number | null
}
export const getDealTrend = (market: Market, ticker: string) =>
  get<DealTrend[]>('/api/deal-trend', { market, ticker })

export interface Profile {
  name: string | null
  description: string | null
  logo: string | null
  researches: { title: string; brokerage: string; date: string }[]
}
export const getProfile = (market: Market, ticker: string) =>
  get<Profile>('/api/profile', { market, ticker })
