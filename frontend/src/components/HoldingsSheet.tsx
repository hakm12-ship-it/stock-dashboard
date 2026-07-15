import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrices } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import type { Holding } from '../lib/holdings'
import { fmtPrice, changeColor, changeSign } from '../lib/format'

function HoldingRow({ h, onRemove }: { h: Holding; onRemove: () => void }) {
  const { data } = useQuery({ queryKey: ['prices', h.ticker, '1m'], queryFn: () => getPrices(h.ticker, '1m') })
  const last = data?.at(-1)?.close
  const cost = h.avg * h.qty
  const value = last != null ? last * h.qty : cost
  const pl = value - cost
  const pct = cost ? (pl / cost) * 100 : 0
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{h.name}</div>
        <div className="font-mono text-[0.66rem] text-muted">
          {h.qty}주 · 평균 {fmtPrice(h.avg, h.market)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono text-sm tnum">{fmtPrice(value, h.market)}</div>
        <div className={`font-mono text-[0.7rem] ${changeColor(pl)}`}>
          {changeSign(pl)} {Math.abs(pct).toFixed(2)}%
        </div>
      </div>
      <button onClick={onRemove} className="text-xs text-down px-1 shrink-0 active:opacity-70">
        삭제
      </button>
    </div>
  )
}

export default function HoldingsSheet({
  holdings,
  custom,
  tickers,
  onSave,
  onRemove,
  onImport,
  onClose,
}: {
  holdings: Holding[]
  custom: FocusTicker[]
  tickers: FocusTicker[]
  onSave: (h: Holding) => void
  onRemove: (h: Holding) => void
  onImport: (d: { holdings?: Holding[]; customTickers?: FocusTicker[] }) => void
  onClose: () => void
}) {
  const options = tickers.filter((t) => t.kind !== 'index')
  const [selKey, setSelKey] = useState(options[0] ? `${options[0].market}-${options[0].ticker}` : '')
  const [qty, setQty] = useState('')
  const [avg, setAvg] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [backupMsg, setBackupMsg] = useState('')

  const doExport = async () => {
    const payload = JSON.stringify({ v: 1, holdings, customTickers: custom })
    try {
      await navigator.clipboard.writeText(payload)
      setBackupMsg('클립보드에 복사됐어요 — 메모장·메신저 등에 붙여넣어 보관하세요.')
    } catch {
      setImportText(payload)
      setImportOpen(true)
      setBackupMsg('아래 내용을 길게 눌러 직접 복사해 보관하세요.')
    }
  }
  const doImport = () => {
    try {
      const d = JSON.parse(importText)
      if (!Array.isArray(d.holdings) && !Array.isArray(d.customTickers)) throw new Error('bad')
      onImport(d)
      setBackupMsg('가져오기 완료! 목록이 교체됐어요.')
      setImportOpen(false)
      setImportText('')
    } catch {
      setBackupMsg('형식이 올바르지 않아요 — 내보내기로 복사한 내용을 그대로 붙여넣어 주세요.')
    }
  }

  const add = () => {
    const t = options.find((o) => `${o.market}-${o.ticker}` === selKey)
    const q = Number(qty)
    const a = Number(avg)
    if (!t || !q || !a) return
    onSave({ ticker: t.ticker, name: t.name, market: t.market, kind: t.kind, qty: q, avg: a })
    setQty('')
    setAvg('')
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink flex flex-col fade-in">
      <div className="flex items-center justify-between px-4 pt-safe pb-3 border-b border-border">
        <span className="text-base font-bold">보유종목 · 손익</span>
        <button onClick={onClose} className="text-muted text-2xl leading-none px-2 active:text-text">
          ×
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 overflow-y-auto flex-1 pb-10">
        <div className="bg-surface border border-border rounded-xl p-3 space-y-2 card-shadow">
          <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted">
            보유 추가 / 수정
          </div>
          <select
            value={selKey}
            onChange={(e) => setSelKey(e.target.value)}
            className="w-full bg-ink border border-border rounded-lg px-3 py-2 text-sm text-text"
          >
            {options.map((o) => (
              <option key={`${o.market}-${o.ticker}`} value={`${o.market}-${o.ticker}`}>
                {o.name} ({o.ticker})
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              placeholder="수량(주)"
              className="flex-1 bg-ink border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <input
              value={avg}
              onChange={(e) => setAvg(e.target.value)}
              inputMode="decimal"
              placeholder="평균 매수가"
              className="flex-1 bg-ink border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={add}
            className="w-full bg-accent/15 border border-accent/50 text-accent rounded-lg py-2 text-sm font-medium active:bg-accent/25"
          >
            추가 / 수정
          </button>
          <p className="text-[0.6rem] text-muted">
            같은 종목을 다시 추가하면 덮어써요. 보유하려는 종목이 목록에 없으면 홈에서 먼저 검색·추가하세요.
          </p>
        </div>

        {holdings.length === 0 ? (
          <div className="text-muted text-sm text-center py-6">아직 보유종목이 없어요</div>
        ) : (
          <div className="bg-surface border border-border rounded-xl px-3 card-shadow">
            {holdings.map((h) => (
              <HoldingRow key={`${h.market}-${h.ticker}`} h={h} onRemove={() => onRemove(h)} />
            ))}
          </div>
        )}

        {/* 백업 · 복원 */}
        <div className="bg-surface border border-border rounded-xl p-3 space-y-2 card-shadow">
          <div className="text-[0.7rem] font-semibold uppercase tracking-[0.07em] text-muted">
            백업 · 복원
          </div>
          <p className="text-[0.62rem] text-muted leading-relaxed">
            데이터는 이 기기에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우면 사라지니, 가끔
            내보내기로 백업해두세요.
          </p>
          <div className="flex gap-2">
            <button
              onClick={doExport}
              className="flex-1 border border-border rounded-lg py-2 text-sm text-text active:bg-surface-2"
            >
              내보내기 (복사)
            </button>
            <button
              onClick={() => {
                setImportOpen((v) => !v)
                setBackupMsg('')
              }}
              className="flex-1 border border-border rounded-lg py-2 text-sm text-text active:bg-surface-2"
            >
              가져오기
            </button>
          </div>
          {importOpen && (
            <div className="space-y-2">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
                placeholder="내보내기로 복사한 내용을 붙여넣으세요"
                className="w-full bg-ink border border-border rounded-lg px-3 py-2 text-[0.7rem] font-mono outline-none focus:border-accent"
              />
              <button
                onClick={doImport}
                className="w-full bg-accent/15 border border-accent/50 text-accent rounded-lg py-2 text-sm font-medium active:bg-accent/25"
              >
                적용 (기존 목록 교체)
              </button>
            </div>
          )}
          {backupMsg && <p className="text-[0.66rem] text-accent">{backupMsg}</p>}
        </div>
      </div>
    </div>
  )
}
