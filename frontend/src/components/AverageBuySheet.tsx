import { useState } from 'react'
import {
  afterBuy,
  DEFAULT_MOVES,
  plAt,
  qtyForAmount,
  scenarios,
  toBreakEven,
} from '../lib/averaging'
import type { Holding } from '../lib/holdings'
import { changeColor, fmtPrice } from '../lib/format'
import { Sheet } from './ui'
import { parseAmount } from '../lib/validation'

const num = (s: string) => {
  const v = parseAmount(s)
  return Number.isFinite(v) && v > 0 ? v : 0
}

export default function AverageBuySheet({
  holding,
  price,
  onClose,
}: {
  holding: Holding
  /** 현재가. 없으면 평단을 기준으로 계산한다. */
  price: number | undefined
  onClose: () => void
}) {
  const cur = price ?? holding.avg
  const whole = holding.market === 'KR' // 국내는 소수점 매수가 안 된다
  const [mode, setMode] = useState<'qty' | 'amount'>('amount')
  const [raw, setRaw] = useState('')
  // 미국 종목은 센트 단위까지 살려야 계산이 현재가와 맞는다.
  const [buyPrice, setBuyPrice] = useState(whole ? String(Math.round(cur)) : cur.toFixed(2))
  const currency = whole ? 'KRW' : 'USD'

  const px = num(buyPrice) || cur
  const addQty = mode === 'qty' ? num(raw) : qtyForAmount(num(raw), px, whole)
  const spend = addQty * px

  // 곱셈 몇 번이라 메모이제이션할 이유가 없다.
  const before = { qty: holding.qty, avg: holding.avg }
  const after = afterBuy(before, addQty, px)
  const rows = scenarios(before, after, cur, DEFAULT_MOVES)

  const beBefore = toBreakEven(before, cur)
  const beAfter = toBreakEven(after, cur)
  const nowBefore = plAt(before, cur)
  const nowAfter = plAt(after, cur)
  const active = addQty > 0

  return (
    <Sheet title={`${holding.name} 추가 매수 계산`} onClose={onClose} dismissOnBackdrop={false}>
      <div className="bg-surface border border-border rounded-xl p-4 card-shadow">
        <div className="text-label text-muted mb-2">
          지금 {holding.qty}주 · 평단 {fmtPrice(holding.avg, holding.market)} · 현재가{' '}
          {fmtPrice(cur, holding.market)}
        </div>

        <div className="segmented segmented--block mb-3" role="group" aria-label="계산 기준">
          {(['amount', 'qty'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                setRaw('')
              }}
            >
              {m === 'amount' ? '금액으로' : '수량으로'}
            </button>
          ))}
        </div>

        <label className="block mb-2">
          <span className="text-label text-muted">
            {mode === 'amount' ? `추가 매수 금액 (${currency})` : '추가 매수 수량 (주)'}
          </span>
          <input
            inputMode="decimal"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={mode === 'amount' ? (whole ? '예: 1,000,000' : '예: 1,000') : '예: 10'}
            className="field font-mono tnum"
          />
        </label>
        <label className="block">
          <span className="text-label text-muted">1주당 매수 가격 ({currency})</span>
          <input
            inputMode="decimal"
            value={buyPrice}
            onChange={(e) => setBuyPrice(e.target.value)}
            className="field font-mono tnum"
          />
        </label>

        {active && (
          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
            <Line
              label="추가 매수"
              value={`${addQty.toLocaleString()}주 · ${fmtPrice(spend, holding.market)}`}
            />
            <Line
              label="평단"
              value={`${fmtPrice(holding.avg, holding.market)} → ${fmtPrice(after.avg, holding.market)}`}
              accent
            />
            <Line label="총 수량" value={`${holding.qty} → ${after.qty.toLocaleString()}주`} />
            <Line
              label="투입 원금"
              value={`${fmtPrice(nowBefore.cost, holding.market)} → ${fmtPrice(nowAfter.cost, holding.market)}`}
            />
            {beBefore != null && beAfter != null && (
              <Line
                label="본전까지 필요한 상승"
                value={`${beBefore >= 0 ? '+' : ''}${beBefore.toFixed(1)}% → ${
                  beAfter >= 0 ? '+' : ''
                }${beAfter.toFixed(1)}%`}
              />
            )}
          </div>
        )}
      </div>

      {active && (
        <div className="bg-surface border border-border rounded-xl p-4 card-shadow">
          <div className="section-label mb-1">
            현재가가 움직이면
          </div>
          <p className="text-label text-muted mb-3 leading-relaxed">
            평단이 내려가도 투입 원금이 늘어난 만큼 <b className="text-text">손실 금액은 커집니다</b>.
            비율과 금액을 같이 보세요.
          </p>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-label font-mono tnum">
              <thead>
                <tr className="text-muted font-sans">
                  <th className="text-left font-medium py-1">현재가가</th>
                  <th className="text-right font-medium">지금 그대로면</th>
                  <th className="text-right font-medium">추가 매수하면</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.movePct} className={`border-t border-border ${r.movePct === 0 ? 'bg-surface-2' : ''}`}>
                    <td className="py-1.5 text-left">
                      <div>{fmtPrice(r.price, holding.market)}</div>
                      <div className="text-muted">
                        {r.movePct > 0 ? '+' : r.movePct < 0 ? '−' : ''}
                        {Math.abs(r.movePct)}%
                      </div>
                    </td>
                    <Cell pct={r.before.pct} pl={r.before.pl} market={holding.market} />
                    <Cell pct={r.after.pct} pl={r.after.pl} market={holding.market} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-label text-muted mt-3 leading-relaxed">
            가격이 그렇게 될 거라는 예측이 아니라, 그 가격이 되면 이렇게 된다는 계산이에요 ·
            수수료·세금은 넣지 않았습니다
          </p>
        </div>
      )}

      {!active && (
        <p className="text-label text-muted text-center py-4">
          위에 금액이나 수량을 넣으면 평단과 손익이 어떻게 바뀌는지 보여드려요.
        </p>
      )}
    </Sheet>
  )
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-label text-muted shrink-0">{label}</span>
      <span className={`font-mono text-caption tnum text-right ${accent ? 'text-accent font-semibold' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function Cell({ pct, pl, market }: { pct: number; pl: number; market: 'KR' | 'US' }) {
  return (
    <td className={`text-right py-1.5 ${changeColor(pl)}`}>
      <div>
        {pct >= 0 ? '+' : '−'}
        {Math.abs(pct).toFixed(1)}%
      </div>
      <div className="opacity-80">
        {pl >= 0 ? '+' : '−'}
        {fmtPrice(Math.abs(pl), market)}
      </div>
    </td>
  )
}
