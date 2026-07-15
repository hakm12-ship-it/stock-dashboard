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
