import { ErrorState } from './ui'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMarketTop } from '../lib/api'
import type { FocusTicker } from '../data/tickers'
import { changeColor, fmtChange, fmtPrice } from '../lib/format'
import Icon from './Icon'

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
  onOpen: (ticker: FocusTicker) => void
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
  const isAdded = (ticker: string) => existing.some((x) => x.ticker === ticker && x.market === tickerMarket)

  return (
    <section className="bg-surface border border-border rounded-xl p-4 card-shadow">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <span className="panel-title">
          등락률 상위
        </span>
        <div className="segmented" role="group" aria-label="시장">
          {MKTS.map((m) => (
            <button key={m} onClick={() => setMkt(m)} aria-pressed={mkt === m}>
              {m === 'NASDAQ' ? '나스닥' : m === 'KOSPI' ? '코스피' : m === 'KOSDAQ' ? '코스닥' : '코인'}
            </button>
          ))}
        </div>
      </div>

      <div className="segmented segmented--block mb-3" role="group" aria-label="방향">
        {(
          [
            ['up', '급등'],
            ['down', '급락'],
          ] as [Dir, string][]
        ).map(([d, label]) => (
          <button key={d} onClick={() => setDir(d)} aria-pressed={d === dir} className={d === 'up' ? 'is-up' : 'is-down'}>
            {label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="h-32 rounded-lg shimmer" />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <div className="text-muted text-xs text-center py-4">데이터가 없어요</div>
      ) : (
        <div>
          {q.data.map((s, i) => {
            const added = !isCrypto && isAdded(s.ticker)
            return (
              <div
                key={s.ticker}
                className="flex items-center gap-2 min-h-[44px] border-b border-border last:border-0"
              >
                <span className="font-mono text-label text-muted w-4 shrink-0">{i + 1}</span>
                <button
                  disabled={isCrypto}
                  onClick={() =>
                    onOpen({
                      ticker: s.ticker,
                      name: s.name,
                      short: s.name,
                      market: tickerMarket,
                      kind: 'stock',
                    })
                  }
                  className="min-w-0 flex-1 self-stretch text-left"
                >
                  <div className="text-sm font-medium truncate">
                    {s.name} {!isCrypto && <span className="text-muted" aria-hidden="true">›</span>}
                  </div>
                  <div className="font-mono text-label text-muted">{s.ticker}</div>
                </button>
                <div className="text-right shrink-0">
                  <div className="font-mono text-sm tnum">
                    {s.price == null
                      ? '—'
                      : isCrypto
                        ? fmtCoin(s.price)
                        : fmtPrice(s.price, mktKr ? 'KR' : 'US')}
                  </div>
                  <div
                    className={`font-mono text-label ${s.changePct != null ? changeColor(s.changePct) : 'text-muted'}`}
                  >
                    {s.changePct != null ? fmtChange(s.changePct) : '—'}
                  </div>
                </div>
                {!isCrypto && added && <span className="add-state">관심 종목</span>}
                {!isCrypto && !added && (
                  <button
                    aria-label={`${s.name} 관심종목에 담기`}
                    onClick={() =>
                      onAdd({
                        ticker: s.ticker,
                        name: s.name,
                        short: s.name,
                        market: tickerMarket,
                        kind: 'stock',
                      })
                    }
                    className="add-button"
                  >
                    <Icon name="plus" size={14} /> 담기
                  </button>
                )}
              </div>
            )
          })}
          <p className="text-label text-muted mt-2">
            {isCrypto
              ? '업비트 KRW 마켓 · 24시간 등락 기준 · 참고용 · 투자 조언 아님'
              : '급등락 상위는 변동성이 매우 큰 종목이에요 · 이름을 누르면 분석을 열어요'}
          </p>
        </div>
      )}
    </section>
  )
}
