import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getPrices } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import type { Holding } from '../lib/holdings'
import type { Trade } from '../lib/trades'
import { parseAmount, parseBackup, positive, type Backup } from '../lib/validation'
import { fmtPrice, fmtPct, fmtSignedPrice, changeColor } from '../lib/format'
import { Sheet } from './ui'
import Icon from './Icon'
import { BACKUP_REQUEST_KEY, createBackupSnapshot, loadBackupStatus, recordBackupRequest } from '../lib/backup'
import { DATA_REVISION_KEY } from '../lib/storage'

function HoldingRow({ h, onEdit, onRemove }: { h: Holding; onEdit: () => void; onRemove: () => void }) {
  const prices = useQuery({ queryKey: ['prices', h.ticker, '1m'], queryFn: () => getPrices(h.ticker, '1m') })
  const last = prices.data?.at(-1)?.close
  const value = last == null ? null : last * h.qty
  const cost = h.avg * h.qty
  return (
    <li className="holding-row">
      <div className="min-w-0">
        <strong className="block text-sm truncate">{h.name}</strong>
        <span className="text-label text-muted">
          <span className="font-mono tnum">{h.qty.toLocaleString('ko-KR')}</span>주 · 평균{' '}
          <span className="font-mono tnum">{fmtPrice(h.avg, h.market)}</span>
        </span>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tnum">{value == null ? prices.isError ? '시세 조회 실패' : '평가 대기' : fmtPrice(value, h.market)}</div>
        {prices.isError && value != null && <p className="text-label text-muted">갱신 실패 · 마지막 조회값</p>}
        {value != null && (
          <span className={`font-mono tnum text-label ${changeColor(value - cost)}`}>
            {fmtSignedPrice(value - cost, h.market)} ({fmtPct((value / cost - 1) * 100)})
          </span>
        )}
      </div>
      <div className="flex">
        <button className="icon-button" onClick={onEdit} aria-label={`${h.name} 수정`}>
          <Icon name="edit" size={18} />
        </button>
        <button className="icon-button danger-action" onClick={onRemove} aria-label={`${h.name} 보유 삭제`}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
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
  onSave: (h: Holding) => Promise<boolean>
  onRemove: (h: Holding) => void
  onImport: (d: Backup) => Promise<boolean>
  onClose: () => void
}) {
  const options = [...tickers.filter((t) => t.kind !== 'index')]
  for (const h of holdings)
    if (!options.some((t) => t.market === h.market && t.ticker === h.ticker))
      options.push({ ...h, short: h.name, kind: h.kind === 'etf' ? 'etf' : 'stock' })
  const keyOf = (t: { market: string; ticker: string }) => `${t.market}-${t.ticker}`
  const heldKey = (k: string) => holdings.some((h) => keyOf(h) === k)
  // 처음엔 아직 보유하지 않은 종목을 골라 둔다. 보유 중인 종목이 선택돼 있으면 빈 칸인데도 '수정' 모드로 열렸다.
  const firstFree = options.find((o) => !heldKey(keyOf(o))) ?? options[0]
  const [selKey, setSelKey] = useState(firstFree ? keyOf(firstFree) : '')
  const [qty, setQty] = useState(''),
    [avg, setAvg] = useState('')
  const [formOpen, setFormOpen] = useState(holdings.length === 0)
  const formRef = useRef<HTMLFormElement>(null)
  const [backupMessage, setBackupMessage] = useState(''),
    [backupError, setBackupError] = useState('')
  const [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [importOpen, setImportOpen] = useState(false),
    [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<Backup | null>(null)
  const [saving, setSaving] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backupStatus, setBackupStatus] = useState(() => loadBackupStatus())
  useEffect(() => {
    setBackupStatus(loadBackupStatus())
  }, [holdings, custom, trades])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === DATA_REVISION_KEY || event.key === BACKUP_REQUEST_KEY || event.key == null)) {
        setBackupStatus(loadBackupStatus())
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const selected = options.find((t) => `${t.market}-${t.ticker}` === selKey)
  const existing = holdings.find((h) => `${h.market}-${h.ticker}` === selKey)
  const choose = (k: string) => {
    setSelKey(k)
    const h = holdings.find((x) => keyOf(x) === k)
    setQty(h ? String(h.qty) : '')
    setAvg(h ? String(h.avg) : '')
    setMessage('')
    setError('')
  }
  const edit = (h: Holding) => {
    setFormOpen(true)
    choose(keyOf(h))
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'nearest' })
      document.getElementById('holding-qty')?.focus()
    })
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setMessage('')
    setError('')
    const q = parseAmount(qty),
      a = parseAmount(avg)
    if (!selected || !positive(q) || !positive(a) || !Number.isFinite(q * a)) {
      setError('수량과 평균 매수가는 0보다 큰 숫자로 입력해 주세요. 쉼표는 넣어도 됩니다.')
      return
    }
    setSaving(true)
    const ok = await onSave({
        ticker: selected.ticker,
        name: selected.name,
        market: selected.market,
        kind: selected.kind,
        qty: q,
        avg: a,
      })
    setSaving(false)
    if (!ok) {
      setError('저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
      return
    }
    setQty('')
    setAvg('')
    setMessage(`${selected.name} 보유 기록을 저장했습니다.`)
  }
  const exportData = async () => {
    if (backingUp) return
    setBackingUp(true)
    setBackupError('')
    setBackupMessage('')
    try {
      const snapshot = await createBackupSnapshot()
      if (!snapshot.ok) throw new Error('저장된 기록을 읽지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
      const blob = new Blob([JSON.stringify(snapshot.value.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url
      link.download = `stock-insight-${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())}.json`
      document.body.appendChild(link)
      try { link.click() } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      const recorded = await recordBackupRequest(snapshot.value)
      setBackupStatus(loadBackupStatus())
      setBackupMessage('백업 파일 다운로드를 요청했습니다. 브라우저 다운로드 목록에서 저장된 파일을 확인해 주세요.')
      if (!recorded.ok) setBackupError('다운로드를 요청했지만 요청 이력은 저장하지 못했습니다.')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '백업 다운로드를 요청하지 못했습니다.')
    } finally {
      setBackingUp(false)
    }
  }
  return (
    <Sheet title="보유종목 관리" onClose={onClose} dismissOnBackdrop={false}>
      {holdings.length > 0 && (
        <section aria-labelledby="held-title">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 id="held-title" className="section-label">
              보유 {holdings.length}종목
            </h3>
            {!formOpen && (
              <button
                className="button button-quiet"
                onClick={() => {
                  setFormOpen(true)
                  choose(firstFree ? keyOf(firstFree) : selKey)
                }}
              >
                <Icon name="plus" size={16} /> 보유종목 추가
              </button>
            )}
          </div>
          <ul className="m-0 p-0 list-none">
            {holdings.map((h) => (
              <HoldingRow
                key={keyOf(h)}
                h={h}
                onEdit={() => edit(h)}
                onRemove={() => {
                  if (window.confirm(`${h.name} 보유 기록을 삭제할까요? 매매일지는 유지됩니다.`)) onRemove(h)
                }}
              />
            ))}
          </ul>
        </section>
      )}
      {formOpen && (
        <form ref={formRef} onSubmit={add} className="form-panel space-y-3" noValidate>
          <h3 className="section-label">{existing ? '보유 기록 수정' : '보유종목 등록'}</h3>
          <div>
            <label className="field-label" htmlFor="holding-ticker">
              종목
            </label>
            <select id="holding-ticker" className="field" value={selKey} onChange={(e) => choose(e.target.value)}>
              {options.map((o) => (
                <option key={keyOf(o)} value={keyOf(o)}>
                  {o.name} ({o.ticker}){heldKey(keyOf(o)) ? ' · 보유 중' : ''}
                </option>
              ))}
            </select>
          </div>
          {existing && (
            <p className="text-label text-muted">
              보유 중 · {existing.qty.toLocaleString('ko-KR')}주 · 평균 {fmtPrice(existing.avg, existing.market)} → 저장하면
              입력한 값으로 바뀝니다.
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
                placeholder={selected?.market === 'US' ? '예: 104.50' : '예: 231,000'}
              />
            </label>
          </div>
          {positive(parseAmount(qty)) && positive(parseAmount(avg)) && selected && (
            <p className="text-label text-muted tnum">
              매수 원금 {fmtPrice(parseAmount(qty) * parseAmount(avg), selected.market)}
            </p>
          )}
          <div className="flex gap-2">
            {holdings.length > 0 && (
              <button type="button" className="button button-quiet" onClick={() => setFormOpen(false)}>
                닫기
              </button>
            )}
            <button className="button button-primary flex-1" type="submit" disabled={saving}>
              {saving ? '저장 중…' : existing ? '보유 기록 수정' : '보유종목 저장'}
            </button>
          </div>
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
      )}
      {holdings.length === 0 && (
        <p className="text-label text-muted">수량과 매수가를 기록하면 손익을 볼 수 있어요. 데이터는 이 브라우저에만 저장됩니다.</p>
      )}
      <section className="form-panel space-y-3">
        <h3 className="font-semibold">전체 데이터 백업</h3>
        <p className="text-label text-muted">
          보유종목·추가한 관심종목·매매일지를 파일 하나로 내려받아요. 브라우저 데이터를 지우거나 기기를 바꾸기 전에
          백업하세요. 이전 버전 백업도 복원할 수 있고, 백업에 없는 목록은 그대로 유지됩니다.
        </p>
        <div className="text-label space-y-1" aria-live="polite">
          <p>마지막 다운로드 요청: {backupStatus.requestedAt ? <time dateTime={backupStatus.requestedAt}>{new Date(backupStatus.requestedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국시간)</time> : '이력 없음'}</p>
          <p className={backupStatus.changed ? 'text-loss' : 'text-muted'}>{backupStatus.requestedAt
            ? backupStatus.changed ? '마지막 백업 요청 이후 기록이 변경되었습니다. 새 백업을 만들어 주세요.' : '마지막 백업 요청 이후 기록 변경이 없습니다.'
            : '이 브라우저에서 기록된 백업 요청이 없습니다. 첫 백업을 만들어 주세요.'}</p>
          <p className="text-muted">요청 이력은 파일 저장 완료를 뜻하지 않습니다. 실제 파일은 다운로드 목록에서 확인하세요.</p>
        </div>
        <div className="flex gap-2">
          <button className="button button-quiet flex-1" onClick={exportData} disabled={backingUp}>
            {backingUp ? '백업 준비 중…' : '백업 파일 다운로드'}
          </button>
          <button
            className="button button-quiet"
            aria-expanded={importOpen}
            onClick={() => {
              setImportOpen(!importOpen)
              setPreview(null)
            }}
          >
            백업에서 복원
          </button>
        </div>
        {importOpen && (
          <div className="space-y-3">
            <label className="button button-quiet w-full">
              백업 파일 선택
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setImportText(await file.text())
                  setPreview(null)
                  setBackupError('')
                  setBackupMessage(`${file.name}을(를) 읽었습니다. 복원 내용을 확인하세요.`)
                }}
              />
            </label>
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
                placeholder="파일을 고르거나 백업 내용을 직접 붙여넣으세요"
              />
            </label>
            {!preview ? (
              <button
                className="button button-quiet"
                onClick={() => {
                  try {
                    setPreview(parseBackup(importText))
                    setBackupError('')
                  } catch (e) {
                    setBackupMessage('')
                    setBackupError(
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
                  disabled={saving}
                  onClick={async () => {
                    if (saving) return
                    setSaving(true)
                    const ok = await onImport(preview)
                    setSaving(false)
                    if (ok) {
                      setBackupMessage('백업을 복원했습니다.')
                      setPreview(null)
                      setImportOpen(false)
                      setImportText('')
                    } else setBackupError('복원하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')
                  }}
                >
                  확인한 목록으로 교체
                </button>
              </div>
            )}
          </div>
        )}
        {backupError && (
          <p role="alert" className="form-error">
            {backupError}
          </p>
        )}
        {backupMessage && (
          <p role="status" className="sheet-notice">
            <Icon name="check" size={16} />
            {backupMessage}
          </p>
        )}
      </section>
    </Sheet>
  )
}
