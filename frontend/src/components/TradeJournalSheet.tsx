import { useState } from 'react'
import type { FocusTicker } from '../data/tickers'
import { realizedPnL, type Trade } from '../lib/trades'
import { fmtPrice, changeColor, changeSign } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)

export default function TradeJournalSheet({
  trades,
  tickers,
  onAdd,
  onRemove,
  onClose,
}: {
  trades: Trade[]
  tickers: FocusTicker[]
  onAdd: (t: Trade) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const options = tickers.filter((t) => t.kind !== 'index')
  const [selKey, setSelKey] = useState(options[0] ? `${options[0].market}-${options[0].ticker}` : '')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')

  const add = () => {
    const t = options.find((o) => `${o.market}-${o.ticker}` === selKey)
    const q = Number(qty)
    const p = Number(price)
    if (!t || !q || !p || !date) return
    onAdd({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      ticker: t.ticker,
      name: t.name,
      market: t.market,
      side,
      qty: q,
      price: p,
      memo: memo.trim() || undefined,
    })
    setQty('')
    setPrice('')
    setMemo('')
  }

  const pnl = realizedPnL(trades)
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  return (
    <div className="fixed inset-0 z-50 bg-ink flex flex-col fade-in">
      <div className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border">
        <span className="text-base font-bold">매매일지</span>
        <button onClick={onClose} className="text-muted text-2xl leading-none px-2 active:text-text">
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 pb-10">
        {/* 실현손익 */}
        {(pnl.KR !== 0 || pnl.US !== 0) && (
          <div className="bg-surface border border-border rounded-xl p-3.5 card-shadow">
            <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted mb-1.5">
              실현손익 (평균단가법)
            </div>
            <div className="flex gap-4">
              {pnl.KR !== 0 && (
                <span className={`font-mono text-sm tnum ${changeColor(pnl.KR)}`}>
                  🇰🇷 {changeSign(pnl.KR)} {fmtPrice(Math.abs(pnl.KR), 'KR')}
                </span>
              )}
              {pnl.US !== 0 && (
                <span className={`font-mono text-sm tnum ${changeColor(pnl.US)}`}>
                  🇺🇸 {changeSign(pnl.US)} {fmtPrice(Math.abs(pnl.US), 'US')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 기록 추가 */}
        <div className="bg-surface border border-border rounded-xl p-3 space-y-2 card-shadow">
          <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted">
            기록 추가
          </div>
          <div className="flex gap-2">
            <select
              value={selKey}
              onChange={(e) => setSelKey(e.target.value)}
              className="flex-1 bg-ink border border-border rounded-lg px-2.5 py-2 text-sm text-text min-w-0"
            >
              {options.map((o) => (
                <option key={`${o.market}-${o.ticker}`} value={`${o.market}-${o.ticker}`}>
                  {o.short}
                </option>
              ))}
            </select>
            <div className="flex gap-1 bg-ink border border-border rounded-lg p-1 shrink-0">
              {(
                [
                  ['buy', '매수'],
                  ['sell', '매도'],
                ] as const
              ).map(([s, label]) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`px-3 py-1 rounded-md text-xs font-medium ${
                    side === s ? (s === 'buy' ? 'bg-up/20 text-up' : 'bg-down/20 text-down') : 'text-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              placeholder="수량"
              className="flex-1 bg-ink border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent min-w-0"
            />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="가격"
              className="flex-1 bg-ink border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent min-w-0"
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-ink border border-border rounded-lg px-2 py-2 text-xs text-text shrink-0"
            />
          </div>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모 (선택) — 매수/매도 이유를 남겨두면 복기에 좋아요"
            className="w-full bg-ink border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={add}
            className="w-full bg-accent/15 border border-accent/50 text-accent rounded-lg py-2 text-sm font-medium active:bg-accent/25"
          >
            기록하기
          </button>
        </div>

        {/* 기록 목록 */}
        {sorted.length === 0 ? (
          <div className="text-muted text-sm text-center py-6">아직 기록이 없어요</div>
        ) : (
          <div className="bg-surface border border-border rounded-xl px-3.5 card-shadow">
            {sorted.map((t) => (
              <div key={t.id} className="py-2.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-[0.6rem] px-1.5 py-0.5 rounded border shrink-0 ${
                      t.side === 'buy' ? 'text-up border-up/40' : 'text-down border-down/40'
                    }`}
                  >
                    {t.side === 'buy' ? '매수' : '매도'}
                  </span>
                  <span className="text-sm font-medium truncate flex-1">{t.name}</span>
                  <span className="font-mono text-xs tnum shrink-0">
                    {t.qty}주 · {fmtPrice(t.price, t.market)}
                  </span>
                  <button onClick={() => onRemove(t.id)} className="text-xs text-down px-1 shrink-0 active:opacity-70">
                    ×
                  </button>
                </div>
                <div className="font-mono text-[0.62rem] text-muted mt-0.5 pl-0.5">
                  {t.date}
                  {t.memo && <span className="text-muted/90 font-sans"> — {t.memo}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[0.6rem] text-muted">
          이 기록은 내 폰에만 저장돼요. 실현손익은 기록 기준 평균단가법 계산 — 참고용이에요.
        </p>
      </div>
    </div>
  )
}
