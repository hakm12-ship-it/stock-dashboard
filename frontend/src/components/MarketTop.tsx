import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMarketTop } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { changeColor, changeSign } from '../lib/format'

type Dir = 'up' | 'down'
type Mkt = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'CRYPTO'
const MKTS: Mkt[] = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'CRYPTO']

const fmtCoin = (p: number): string =>
  p >= 100
    ? `${Math.round(p).toLocaleString()}원`
    : `${p.toLocaleString(undefined, { maximumFractionDigits: p >= 1 ? 1 : 4 })}원`

export default function MarketTop({
  existing,
  onAdd,
  onOpen,
}: {
  existing: FocusTicker[]
  onAdd: (t: FocusTicker) => void
  onOpen: (ticker: string) => void
}) {
  const [dir, setDir] = useState<Dir>('up')
  const [mkt, setMkt] = useState<Mkt>('KOSPI')

  const q = useQuery({
    queryKey: ['marketTop', dir, mkt],
    queryFn: () => getMarketTop(dir, mkt),
    staleTime: 5 * 60 * 1000,
  })

  const mktKr = mkt === 'KOSPI' || mkt === 'KOSDAQ'
  const isCrypto = mkt === 'CRYPTO'
  const tickerMarket = mktKr ? 'KR' : 'US'
  const isAdded = (ticker: string) =>
    existing.some((x) => x.ticker === ticker && x.market === tickerMarket)

  return (
    <section className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
          🔥 오늘의 시장 TOP
        </span>
        <div className="flex gap-0.5">
          {MKTS.map((m) => (
            <button
              key={m}
              onClick={() => setMkt(m)}
              className={`font-mono text-[0.56rem] px-1 py-1 rounded ${
                mkt === m ? 'bg-accent/15 text-accent' : 'text-muted/70'
              }`}
            >
              {m === 'NASDAQ' ? 'NAS' : m === 'KOSPI' ? '코스피' : m === 'KOSDAQ' ? '코스닥' : '코인'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 bg-ink/40 border border-border rounded-lg p-1 mb-3">
        {(
          [
            ['up', '🔺 급등'],
            ['down', '🔻 급락'],
          ] as [Dir, string][]
        ).map(([d, label]) => (
          <button
            key={d}
            onClick={() => setDir(d)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              d === dir ? 'bg-accent/20 text-text' : 'text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="h-32 rounded-lg shimmer" />
      ) : !q.data || q.data.length === 0 ? (
        <div className="text-muted text-xs text-center py-4">데이터가 없어요</div>
      ) : (
        <div>
          {q.data.map((s, i) => {
            const added = !isCrypto && isAdded(s.ticker)
            return (
              <div
                key={s.ticker}
                className="flex items-center gap-2 py-2 border-b border-border last:border-0"
              >
                <span className="font-mono text-[0.66rem] text-muted w-4 shrink-0">{i + 1}</span>
                <button
                  onClick={() => added && onOpen(s.ticker)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="text-sm font-medium truncate">
                    {s.name}
                    {added && <span className="text-accent text-[0.6rem] ml-1">›</span>}
                  </div>
                  <div className="font-mono text-[0.62rem] text-muted">{s.ticker}</div>
                </button>
                <div className="text-right shrink-0">
                  <div className="font-mono text-sm tnum">
                    {s.price == null
                      ? '—'
                      : isCrypto
                        ? fmtCoin(s.price)
                        : mktKr
                          ? `${Math.round(s.price).toLocaleString()}원`
                          : `$${s.price.toFixed(2)}`}
                  </div>
                  <div className={`font-mono text-[0.7rem] ${s.changePct != null ? changeColor(s.changePct) : 'text-muted'}`}>
                    {s.changePct != null
                      ? `${changeSign(s.changePct)} ${Math.abs(s.changePct).toFixed(2)}%`
                      : '—'}
                  </div>
                </div>
                {!isCrypto && (
                  <button
                    disabled={added}
                    onClick={() =>
                      onAdd({
                        ticker: s.ticker,
                        name: s.name,
                        short: s.name,
                        market: tickerMarket,
                        kind: 'stock',
                      })
                    }
                    className={`shrink-0 text-[0.66rem] px-2 py-1 rounded-md border ${
                      added ? 'text-muted border-border' : 'text-accent border-accent/50 active:bg-accent/10'
                    }`}
                  >
                    {added ? '추가됨' : '+담기'}
                  </button>
                )}
              </div>
            )
          })}
          <p className="text-[0.58rem] text-muted mt-2">
            {isCrypto
              ? '업비트 KRW 마켓 · 24시간 등락 기준 · 참고용 · 투자 조언 아님'
              : '급등락 상위는 변동성이 매우 큰 종목이에요 — 참고용 · 투자 조언 아님'}
          </p>
        </div>
      )}
    </section>
  )
}
