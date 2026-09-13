import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import type { Holding } from '../lib/holdings'
import type { Trade } from '../lib/trades'
import { parseBackup, positive, type Backup } from '../lib/validation'
import { fmtPrice, fmtChange, changeColor } from '../lib/format'
import { Sheet } from './ui'

function HoldingRow({ h, onEdit, onRemove }: { h: Holding; onEdit: () => void; onRemove: () => void }) {
  const prices = useQuery({ queryKey: ['prices', h.ticker, '1m'], queryFn: () => getPrices(h.ticker, '1m') })
  const last = prices.data?.at(-1)?.close
  const value = last == null ? null : last * h.qty
  const cost = h.avg * h.qty
  return (
    <div className="holding-row">
      <div className="min-w-0">
        <strong className="block text-sm">{h.name}</strong>
        <span className="text-label text-muted">
          {h.qty}주 · 평균 {fmtPrice(h.avg, h.market)}
        </span>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">{value == null ? '평가 대기' : fmtPrice(value, h.market)}</div>
        {value != null && (
          <span className={`text-label ${changeColor(value - cost)}`}>
            {fmtChange((value / cost - 1) * 100, value - cost)}
          </span>
        )}
      </div>
      <div className="flex">
        <button className="button" onClick={onEdit} aria-label={`${h.name} 수정`}>
          수정
        </button>
        <button className="button text-down" onClick={onRemove} aria-label={`${h.name} 보유 삭제`}>
          삭제
        </button>
      </div>
    </div>
  )
}
export default function HoldingsSheet({
  holdings,
  custom,
  trades,
  tickers,
  onSave,
  onRemove,
  onImport,
  onClose,
}: {
  holdings: Holding[]
  custom: FocusTicker[]
  trades: Trade[]
  tickers: FocusTicker[]
  onSave: (h: Holding) => boolean
  onRemove: (h: Holding) => void
  onImport: (d: Backup) => boolean
  onClose: () => void
}) {
  const options = [...tickers.filter((t) => t.kind !== 'index')]
  for (const h of holdings)
    if (!options.some((t) => t.market === h.market && t.ticker === h.ticker))
      options.push({ ...h, short: h.name, kind: h.kind === 'etf' ? 'etf' : 'stock' })
  const [selKey, setSelKey] = useState(options[0] ? `${options[0].market}-${options[0].ticker}` : '')
  const [qty, setQty] = useState(''),
    [avg, setAvg] = useState('')
  const [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false),
    [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<Backup | null>(null)
  const selected = options.find((t) => `${t.market}-${t.ticker}` === selKey)
  const existing = holdings.find((h) => `${h.market}-${h.ticker}` === selKey)
  const edit = (h: Holding) => {
    setSelKey(`${h.market}-${h.ticker}`)
    setQty(String(h.qty))
    setAvg(String(h.avg))
    setMessage('보유 수량과 평균 매수가를 수정한 뒤 저장하세요.')
    setError('')
    document.getElementById('holding-qty')?.focus()
  }
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    setError('')
    const q = Number(qty),
      a = Number(avg)
    if (!selected || !positive(q) || !positive(a) || !Number.isFinite(q * a)) {
      setError('수량과 평균 매수가는 0보다 큰 유한한 숫자로 입력해 주세요.')
      return
    }
    if (
      !onSave({
        ticker: selected.ticker,
        name: selected.name,
        market: selected.market,
        kind: selected.kind,
        qty: q,
        avg: a,
      })
    ) {
      setError('저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
      return
    }
    setQty('')
    setAvg('')
    setMessage(`${selected.name} 보유 기록을 저장했습니다.`)
  }
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ v: 2, holdings, customTickers: custom, trades }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = url
    link.download = `stock-insight-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('보유종목·관심종목·매매일지 백업 파일을 내려받았습니다.')
  }
  return (
    <Sheet title="보유종목 관리" onClose={onClose}>
      <p className="text-sm text-muted">
        수량과 매수가를 기록해 손익을 확인하세요. 데이터는 이 브라우저에만 저장됩니다.
      </p>
      <form onSubmit={add} className="form-panel space-y-3">
        <label className="field-label" htmlFor="holding-ticker">
          종목
        </label>
        <select
          id="holding-ticker"
          className="field"
          value={selKey}
          onChange={(e) => {
            setSelKey(e.target.value)
            setQty('')
            setAvg('')
            setMessage('')
            setError('')
          }}
        >
          {options.map((o) => (
            <option key={`${o.market}-${o.ticker}`} value={`${o.market}-${o.ticker}`}>
              {o.name} ({o.ticker})
            </option>
          ))}
        </select>
        {existing && (
          <p className="text-label text-muted">
            기존 {existing.qty}주 · 평균 {fmtPrice(existing.avg, existing.market)}{' '}
            <button
              type="button"
              className="underline text-accent min-h-[44px]"
              onClick={() => edit(existing)}
            >
              기존 값 불러오기
            </button>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="field-label">
            보유 수량 (주)
            <input
              id="holding-qty"
              className="field"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="예: 10"
            />
          </label>
          <label className="field-label">
            평균 매수가 ({selected?.market === 'US' ? 'USD' : 'KRW'})
            <input
              className="field"
              inputMode="decimal"
              value={avg}
              onChange={(e) => setAvg(e.target.value)}
              placeholder="1주당 매수가"
            />
          </label>
        </div>
        <button className="button button-primary w-full" type="submit">
          {existing ? '보유 기록 수정' : '보유종목 저장'}
        </button>
        <p className="text-label text-muted">
          수정하면 이 종목의 기존 수량과 평균 매수가가 입력한 값으로 바뀝니다.
        </p>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-accent">
          {message}
        </p>
      )}
      <section aria-label="저장된 보유종목">
        {holdings.length === 0 ? (
          <div className="empty-state">
            <h3>아직 등록된 보유종목이 없습니다</h3>
            <p>위에서 첫 보유종목을 등록해 보세요.</p>
          </div>
        ) : (
          holdings.map((h) => (
            <HoldingRow
              key={`${h.market}-${h.ticker}`}
              h={h}
              onEdit={() => edit(h)}
              onRemove={() => {
                if (window.confirm(`${h.name} 보유 기록을 삭제할까요? 매매일지는 유지됩니다.`)) onRemove(h)
              }}
            />
          ))
        )}
      </section>
      <section className="form-panel space-y-3">
        <h3 className="font-semibold">백업과 복원</h3>
        <p className="text-label text-muted">
          브라우저 데이터를 지우기 전에 백업하세요. 이전 버전 백업도 가져올 수 있습니다. 백업에 없는 목록은
          그대로 유지됩니다.
        </p>
        <div className="flex gap-2">
          <button className="button button-quiet flex-1" onClick={exportData}>
            백업 파일 다운로드
          </button>
          <button
            className="button button-quiet"
            aria-expanded={importOpen}
            onClick={() => {
              setImportOpen(!importOpen)
              setPreview(null)
            }}
          >
            가져오기
          </button>
        </div>
        {importOpen && (
          <div className="space-y-3">
            <label className="field-label">
              백업 JSON
              <textarea
                className="field font-mono text-xs"
                rows={5}
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value)
                  setPreview(null)
                }}
                placeholder="백업 파일 내용 또는 이전에 복사한 JSON을 붙여넣으세요"
              />
            </label>
            {!preview ? (
              <button
                className="button button-quiet"
                onClick={() => {
                  try {
                    setPreview(parseBackup(importText))
                    setError('')
                  } catch (e) {
                    setError(
                      e instanceof SyntaxError
                        ? '올바른 JSON이 아닙니다. 백업 내용을 확인해 주세요.'
                        : (e as Error).message,
                    )
                  }
                }}
              >
                복원 내용 확인
              </button>
            ) : (
              <div className="restore-preview">
                <strong>다음 목록이 교체됩니다</strong>
                <ul>
                  {preview.holdings && (
                    <li>
                      보유종목: {holdings.length} → {preview.holdings.length}개
                    </li>
                  )}
                  {preview.customTickers && (
                    <li>
                      추가한 관심종목: {custom.length} → {preview.customTickers.length}개
                    </li>
                  )}
                  {preview.trades && (
                    <li>
                      매매일지: {trades.length} → {preview.trades.length}개
                    </li>
                  )}
                </ul>
                <p>현재 기록을 보관하려면 먼저 백업을 내려받으세요.</p>
                <button
                  className="button button-primary"
                  onClick={() => {
                    if (onImport(preview)) {
                      setMessage('백업을 복원했습니다.')
                      setPreview(null)
                      setImportOpen(false)
                      setImportText('')
                    } else setError('복원하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
                  }}
                >
                  확인한 목록으로 교체
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </Sheet>
  )
}
