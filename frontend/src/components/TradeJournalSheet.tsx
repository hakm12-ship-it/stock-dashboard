import { useState } from 'react'
import type { FocusTicker } from '../data/tickers'
import { realizedPnL, type Trade } from '../lib/trades'
import { fmtPrice, fmtSignedPrice, changeColor } from '../lib/format'
import { Sheet } from './ui'
import Icon from './Icon'
import { parseAmount, positive, validDate } from '../lib/validation'

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

export default function TradeJournalSheet({
  trades,
  tickers,
  onAdd,
  onRemove,
  onClose,
}: {
  trades: Trade[]
  tickers: FocusTicker[]
  onAdd: (t: Trade) => boolean
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
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const selected = options.find((o) => `${o.market}-${o.ticker}` === selKey)
  const currency = selected?.market === 'US' ? 'USD' : 'KRW'

  const q = parseAmount(qty)
  const p = parseAmount(price)
  const qtyBad = qty !== '' && !positive(q)
  const priceBad = price !== '' && !positive(p)

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    if (!selected || !positive(q) || !positive(p) || !Number.isFinite(q * p) || !validDate(date) || date > today()) {
      setError('수량과 가격은 0보다 큰 숫자로, 날짜는 오늘 또는 이전 날짜로 입력해 주세요. 쉼표는 넣어도 됩니다.')
      return
    }
    if (
      !onAdd({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date,
        ticker: selected.ticker,
        name: selected.name,
        market: selected.market,
        side,
        qty: q,
        price: p,
        memo: memo.trim() || undefined,
      })
    ) {
      setError('저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
      return
    }
    setError('')
    setMessage(`${selected.short} ${side === 'buy' ? '매수' : '매도'} 기록을 저장했습니다.`)
    setQty('')
    setPrice('')
    setMemo('')
  }

  const pnl = realizedPnL(trades)
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  return (
    <Sheet title="매매일지" onClose={onClose} dismissOnBackdrop={false}>
      {(pnl.KR !== 0 || pnl.US !== 0) && (
        <section className="form-panel">
          <h3 className="section-label mb-1.5">실현손익 · 평균단가법</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {pnl.KR !== 0 && (
              <span className="text-sm">
                <span className="text-muted mr-1.5">한국</span>
                <span className={`font-mono tnum ${changeColor(pnl.KR)}`}>{fmtSignedPrice(pnl.KR, 'KR')}</span>
              </span>
            )}
            {pnl.US !== 0 && (
              <span className="text-sm">
                <span className="text-muted mr-1.5">미국</span>
                <span className={`font-mono tnum ${changeColor(pnl.US)}`}>{fmtSignedPrice(pnl.US, 'US')}</span>
              </span>
            )}
          </div>
        </section>
      )}

      <form onSubmit={add} className="form-panel space-y-3" noValidate>
        <h3 className="section-label">기록 추가</h3>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
          <label className="field-label">
            종목
            <select className="field" value={selKey} onChange={(e) => setSelKey(e.target.value)}>
              {options.map((o) => (
                <option key={`${o.market}-${o.ticker}`} value={`${o.market}-${o.ticker}`}>
                  {o.short} ({o.ticker})
                </option>
              ))}
            </select>
          </label>
          <div className="segmented trade-side" role="group" aria-label="매매 구분">
            {(
              [
                ['buy', '매수'],
                ['sell', '매도'],
              ] as const
            ).map(([s, label]) => (
              <button type="button" key={s} onClick={() => setSide(s)} aria-pressed={side === s} className={`is-${s}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="field-label">
            수량 (주)
            <input
              className={`field ${qtyBad ? 'is-invalid' : ''}`}
              aria-invalid={qtyBad}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              placeholder="예: 10"
            />
          </label>
          <label className="field-label">
            1주당 가격 ({currency})
            <input
              className={`field ${priceBad ? 'is-invalid' : ''}`}
              aria-invalid={priceBad}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder={currency === 'KRW' ? '예: 231,000' : '예: 104.50'}
            />
          </label>
        </div>
        {positive(q) && positive(p) && selected && (
          <p className="text-label text-muted tnum">
            = {fmtPrice(p, selected.market)} × {q.toLocaleString('ko-KR')}주 · 합계 {fmtPrice(p * q, selected.market)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="field-label">
            매매 날짜
            <input type="date" className="field" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field-label">
            메모 (선택)
            <input
              className="field"
              maxLength={2000}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 실적 발표 전 분할 매수"
            />
          </label>
        </div>
        <button type="submit" className="button button-primary w-full">
          기록하기
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="sheet-notice">
            <Icon name="check" size={16} />
            {message}
          </p>
        )}
      </form>

      {sorted.length === 0 ? (
        <p className="text-muted text-sm text-center py-6">아직 기록이 없어요</p>
      ) : (
        <section>
          <h3 className="section-label mb-2">기록 {sorted.length}건</h3>
          <ul className="sheet-list">
            {sorted.map((t) => (
              <li key={t.id} className="sheet-list-row">
                <span className={`trade-badge ${t.side === 'buy' ? 'text-up bg-up/10' : 'text-down bg-down/10'}`}>
                  {t.side === 'buy' ? '매수' : '매도'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium truncate">{t.name}</span>
                    <span className="font-mono text-xs tnum text-muted shrink-0 ml-auto">
                      {t.qty.toLocaleString('ko-KR')}주 · {fmtPrice(t.price, t.market)}
                    </span>
                  </div>
                  <div className="text-label text-muted">
                    <span className="font-mono tnum">{t.date.replaceAll('-', '.')}</span>
                    {' · '}합계 <span className="font-mono tnum">{fmtPrice(t.qty * t.price, t.market)}</span>
                    {t.memo && <span> · {t.memo}</span>}
                  </div>
                </div>
                <button
                  aria-label={`${t.name} 매매 기록 삭제`}
                  onClick={() => {
                    if (window.confirm(`${t.date} ${t.name} 매매 기록을 삭제할까요?`)) onRemove(t.id)
                  }}
                  className="icon-button danger-action"
                >
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-label text-muted">
        기록은 이 브라우저에만 저장됩니다. 백업은 보유 관리의 전체 데이터 백업에서 할 수 있어요. 실현손익은 기록한
        매매를 평균단가법으로 계산한 참고값이에요.
      </p>
    </Sheet>
  )
}
