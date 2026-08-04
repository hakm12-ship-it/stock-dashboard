import { useQuery } from '@tanstack/react-query'
import { getFxAttribution, type Period } from '../lib/api'
import type { Market } from '../data/tickers'
import { Panel } from './ui'
import { changeColor } from '../lib/format'

const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export default function FxAttributionPanel({
  ticker,
  market,
  period,
}: {
  ticker: string
  market: Market
  period: Period
}) {
  const { data } = useQuery({
    queryKey: ['fx-attribution', ticker, market, period],
    queryFn: () => getFxAttribution(ticker, market, period),
  })
  if (!data?.available) return null

  const krw = data.krwReturn ?? 0
  const price = data.priceReturn ?? 0
  const fx = data.fxReturn ?? 0
  const cross = data.crossTerm ?? 0
  // 환율이 수익의 방향을 뒤집었거나 크게 갉아먹었는지
  const fxHurt = (krw < 0 && price > 0) || (krw > 0 && price < 0)

  const Row = ({ label, value, sub }: { label: string; value: number; sub?: string }) => (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-[0.72rem]">
        {label}
        {sub && <span className="text-muted text-[0.6rem] ml-1">{sub}</span>}
      </span>
      <span className={`font-mono text-[0.78rem] ${changeColor(value)}`}>{sign(value)}</span>
    </div>
  )

  return (
    <Panel label="💱 원화 수익, 얼마가 환율이었나">
      <p className="text-[0.7rem] text-muted leading-relaxed mb-2">
        미국 자산이라 원화 수익엔 주가와 환율이 섞여 있어요. 최근 {data.days}거래일 · 환율{' '}
        {Math.round(data.fxStart ?? 0).toLocaleString()}원 →{' '}
        {Math.round(data.fxEnd ?? 0).toLocaleString()}원
      </p>

      <div className="divide-y divide-border">
        <Row label="주가 기여" value={price} sub="달러 기준" />
        <Row label="환율 기여" value={fx} sub="원/달러" />
        {Math.abs(cross) >= 0.05 && <Row label="교차 효과" value={cross} sub="둘의 곱" />}
      </div>

      <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-border">
        <span className="text-[0.75rem] font-semibold">원화 기준 합계</span>
        <span className={`font-mono text-base font-semibold ${changeColor(krw)}`}>{sign(krw)}</span>
      </div>

      {fxHurt && (
        <p className="text-[0.68rem] leading-relaxed mt-3 bg-surface-2 border border-border rounded-lg px-2.5 py-2">
          달러로는 {sign(price)}인데 원화로는 {sign(krw)}예요 — 환율이 결과를 뒤집었습니다.
        </p>
      )}

      <p className="text-[0.6rem] text-muted mt-2">기간 수익률 기준 · 내 매수 시점과는 달라요</p>
    </Panel>
  )
}
