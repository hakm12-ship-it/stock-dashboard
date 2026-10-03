import { useState } from 'react'
import type { FocusTicker } from '../data/tickers'
import { realizedPnL, type Trade } from '../lib/trades'
import { fmtPrice, fmtSignedPrice, changeColor } from '../lib/format'
import { Sheet } from './ui'
import Icon from './Icon'
import { parseAmount, positive, validDate } from '../lib/validation'
import type { Holding } from '../lib/holdings'

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

export default function TradeJournalSheet({
  trades,
  holdings,
  tickers,
  onAdd,
  onRemove,
  onClose,
}: {
  trades: Trade[]
  holdings: Holding[]
  tickers: FocusTicker[]
  onAdd: (t: Trade) => Promise<boolean>
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const options = tickers.filter((t) => t.kind !== 'index')
  for (const record of [...holdings, ...trades]) {
    if (!options.some((ticker) => ticker.market === record.market && ticker.ticker === record.ticker)) {
      options.push({ ticker: record.ticker, name: record.name, short: record.name, market: record.market, kind: 'stock' })
    }
  }
  const [selKey, setSelKey] = useState(options[0] ? `${options[0].market}-${options[0].ticker}` : '')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sequence, setSequence] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = options.find((o) => `${o.market}-${o.ticker}` === selKey)
  const currency = selected?.market === 'US' ? 'USD' : 'KRW'

  const q = parseAmount(qty)
  const p = parseAmount(price)
  const qtyBad = qty !== '' && !positive(q)
  const priceBad = price !== '' && !positive(p)
  const nextSequence = Math.max(0, ...trades.filter((trade) => `${trade.market}-${trade.ticker}` === selKey && trade.date === date).map((trade) => trade.sequence ?? 0)) + 1
  const sequenceText = sequence ?? String(nextSequence)
  const reset = () => {
    setEditingId(null)
    setSequence(null)
    setQty('')
    setPrice('')
    setMemo('')
    setError('')
  }
  const edit = (trade: Trade) => {
    setEditingId(trade.id)
    setSelKey(`${trade.market}-${trade.ticker}`)
    setSide(trade.side)
    setQty(String(trade.qty))
    setPrice(String(trade.price))
    setDate(trade.date)
    setSequence(trade.sequence == null ? '' : String(trade.sequence))
    setMemo(trade.memo ?? '')
    setMessage('')
    setError('')
    requestAnimationFrame(() => document.getElementById('trade-sequence')?.focus())
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setMessage('')
    if (!selected || !positive(q) || !positive(p) || !Number.isFinite(q * p) || !validDate(date) || date > today()) {
      setError('수량과 가격은 0보다 큰 숫자로, 날짜는 오늘 또는 이전 날짜로 입력해 주세요. 쉼표는 넣어도 됩니다.')
      return
    }
    const order = Number(sequenceText)
    if (!Number.isSafeInteger(order) || order <= 0) {
      setError('같은 종목·날짜의 실제 거래 순서를 1 이상의 정수로 입력해 주세요.')
      return
    }
    if (trades.some((trade) => trade.id !== editingId && trade.date === date && `${trade.market}-${trade.ticker}` === selKey && trade.sequence === order)) {
      setError('이 날짜·종목에 같은 거래 순서가 있습니다. 기존 기록의 순서를 확인해 주세요.')
      return
    }
    setSaving(true)
    const ok = await onAdd({
        id: editingId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date,
        ticker: selected.ticker,
        name: selected.name,
        market: selected.market,
        side,
        qty: q,
        price: p,
        memo: memo.trim() || undefined,
        sequence: order,
      })
    setSaving(false)
    if (!ok) {
      setError('저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
      return
    }
    reset()
    setMessage(`${selected.short} ${side === 'buy' ? '매수' : '매도'} 기록을 저장했습니다. 보유 수량은 자동으로 바뀌지 않습니다.`)
  }

  const pnl = realizedPnL(trades)
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  return (
    <Sheet title="매매일지" onClose={onClose} dismissOnBackdrop={false}>
      {trades.length > 0 && (
        <section className="form-panel">
          <h3 className="section-label mb-1.5">실현손익 · 평균단가법</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {trades.some((trade) => trade.market === 'KR') && (
              <span className="text-sm">
                <span className="text-muted mr-1.5">한국</span>
                <span className={`font-mono tnum ${pnl.totals.KR == null ? 'text-muted' : changeColor(pnl.totals.KR)}`}>{pnl.totals.KR == null ? '계산 보류' : fmtSignedPrice(pnl.totals.KR, 'KR')}</span>
              </span>
            )}
            {trades.some((trade) => trade.market === 'US') && (
              <span className="text-sm">
                <span className="text-muted mr-1.5">미국</span>
                <span className={`font-mono tnum ${pnl.totals.US == null ? 'text-muted' : changeColor(pnl.totals.US)}`}>{pnl.totals.US == null ? '계산 보류' : fmtSignedPrice(pnl.totals.US, 'US')}</span>
              </span>
            )}
          </div>
          {pnl.issues.length > 0 && <div role="status" className="text-caption text-muted mt-3">
            <p>기록이 불완전한 통화의 합계는 표시하지 않습니다.</p>
            <ul className="mt-2 space-y-1">{pnl.issues.map((issue) => <li key={`${issue.market}-${issue.ticker}-${issue.date}-${issue.reason}`}>
              {issue.date} {issue.name}: {issue.reason === 'ambiguous_order' ? '같은 날 매수·매도 순서를 기록 수정에서 입력해 주세요.' : '매도 수량보다 앞선 매수 기록이 부족합니다. 누락된 매수·수량·순서를 확인해 주세요.'}
            </li>)}</ul>
          </div>}
        </section>
      )}

      <form onSubmit={add} className="form-panel space-y-3" noValidate>
        <h3 className="section-label">{editingId ? '기록 수정' : '기록 추가'}</h3>
        <p className="text-label text-muted">매매일지는 보유 수량과 별도로 관리합니다. 보유 현황은 보유 관리에서 직접 수정해 주세요.</p>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
          <label className="field-label">
            종목
            <select className="field" value={selKey} onChange={(e) => { setSelKey(e.target.value); setSequence(null) }}>
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
            <input type="date" className="field" max={today()} value={date} onChange={(e) => { setDate(e.target.value); setSequence(null) }} />
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
        <label className="field-label" htmlFor="trade-sequence">
          같은 날 실제 거래 순서
          <input id="trade-sequence" className="field" inputMode="numeric" value={sequenceText} onChange={(e) => setSequence(e.target.value)} aria-describedby="trade-sequence-help" />
        </label>
        <p id="trade-sequence-help" className="text-label text-muted">같은 종목·날짜의 실제 체결 순서대로 1, 2, 3을 입력하세요. 나중에 기록한 거래라도 실제 순서는 유지해 주세요. 기존 기록도 수정할 수 있습니다.</p>
        <button type="submit" className="button button-primary w-full" disabled={saving}>
          {saving ? '저장 중…' : editingId ? '수정 저장' : '기록하기'}
        </button>
        {editingId && <button type="button" className="button button-quiet w-full" disabled={saving} onClick={reset}>수정 취소</button>}
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
                    {' · '}{t.sequence == null ? '거래 순서 미입력' : `${t.sequence}번째 거래`}
                    {' · '}합계 <span className="font-mono tnum">{fmtPrice(t.qty * t.price, t.market)}</span>
                    {t.memo && <span> · {t.memo}</span>}
                  </div>
                </div>
                <button className="icon-button" aria-label={`${t.name} ${t.date} 매매 기록 수정`} onClick={() => edit(t)}><Icon name="edit" size={18} /></button>
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
