import { useQuery } from '@tanstack/react-query'
import {
  getValuation,
  getForwardPe,
  getTrend,
  getTarget,
  getPrices,
  getProfile,
  getDealTrend,
  getPeers,
} from '../lib/api'
import { changeColor, fmtChange, fmtNum, fmtEps, fmtCap, fmtPrice } from '../lib/format'
import type { FocusTicker } from '../data/tickers'
import type { TabKey } from '../lib/navigation'
import { Panel, ErrorState, Metric } from '../components/ui'
import Icon from '../components/Icon'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${m}.${d}(${WEEKDAY[new Date(y, m - 1, d).getDay()]})`
}

function PanelSkeleton({ height = 160 }: { height?: number }) {
  return <div className="rounded-xl shimmer" style={{ height }} aria-hidden="true" />
}

function PeersPanel({
  t,
  tickers,
  onAddTicker,
  onOpen,
  title,
}: {
  t: FocusTicker
  tickers: FocusTicker[]
  onAddTicker: (x: FocusTicker) => void
  onOpen: (x: FocusTicker) => void
  title: string
}) {
  const pq = useQuery({
    queryKey: ['peers', t.market, t.ticker],
    queryFn: () => getPeers(t.market, t.ticker),
    enabled: t.market === 'KR' && t.kind === 'stock',
  })
  if (pq.isLoading) return <PanelSkeleton height={220} />
  const peers = pq.data ?? []
  if (!peers.length) return null

  const findAdded = (code: string) => tickers.find((x) => x.ticker === code && x.market === 'KR')

  return (
    <Panel label={title}>
      <div>
        {peers.map((p) => {
          const added = findAdded(p.ticker)
          const target: FocusTicker = added ?? { ticker: p.ticker, name: p.name, short: p.name, market: 'KR', kind: 'stock' }
          return (
            <div key={p.ticker} className="flex items-center gap-2 min-h-[52px] border-b border-border last:border-0">
              <button onClick={() => onOpen(target)} className="list-link min-w-0 flex-1 self-stretch text-left">
                <span className="block text-sm font-medium truncate">
                  {p.name} <span className="text-muted" aria-hidden="true">›</span>
                </span>
                <span className="block text-label text-muted">
                  시총 <span className="font-mono tnum">{fmtCap(p.marketCap, 'KR')}</span>
                </span>
              </button>
              <div className="text-right shrink-0">
                <div className="font-mono text-sm tnum">{fmtPrice(p.price, 'KR')}</div>
                <div className={`font-mono text-label tnum ${p.changePct != null ? changeColor(p.changePct) : 'text-muted'}`}>
                  {p.changePct != null ? fmtChange(p.changePct) : '—'}
                </div>
              </div>
              {added ? (
                <span className="add-state">관심 종목</span>
              ) : (
                <button
                  onClick={() => onAddTicker(target)}
                  aria-label={`${p.name} 관심종목에 담기`}
                  className="add-button"
                >
                  <Icon name="plus" size={14} /> 담기
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** 순매수 주식 수 — 한 열 안에서 크기를 비교할 수 있게 항상 '만 주' 단위로 맞춘다. */
const fmtShares = (v: number | null): string => {
  if (v == null) return '—'
  const man = v / 1e4
  return `${man > 0 ? '+' : man < 0 ? '−' : ''}${Math.abs(man).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
}
const sharesTone = (v: number | null) => (v != null && v > 0 ? 'text-up' : v != null && v < 0 ? 'text-down' : 'text-muted')

function DealTrendPanel({ t }: { t: FocusTicker }) {
  const dq = useQuery({
    queryKey: ['deal', t.market, t.ticker],
    queryFn: () => getDealTrend(t.market, t.ticker),
    enabled: t.market === 'KR' && t.kind !== 'index',
  })
  if (dq.isLoading) return <PanelSkeleton height={220} />
  if (dq.isError) return <ErrorState label="매매동향을 불러오지 못했어요" onRetry={() => dq.refetch()} />
  const rows = (dq.data ?? []).slice(0, 5)
  if (!rows.length) return null
  const holdRatio = rows[0]?.foreignHoldRatio
  const sum = (pick: (r: (typeof rows)[number]) => number | null) =>
    rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0)
  const totals = [sum((r) => r.foreign), sum((r) => r.organ), sum((r) => r.individual)]

  return (
    <Panel label="투자자별 매매동향" help="flow">
      <table className="flow-table">
        <caption className="sr-only">최근 5거래일 투자자별 순매수, 단위 만 주</caption>
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col">외국인</th>
            <th scope="col">기관</th>
            <th scope="col">개인</th>
          </tr>
        </thead>
        <tbody>
          <tr className="flow-total">
            <th scope="row">5일 합계</th>
            {totals.map((v, i) => (
              <td key={i} className={sharesTone(v)}>
                {fmtShares(v)}
              </td>
            ))}
          </tr>
          {rows.map((r) => (
            <tr key={r.date}>
              <th scope="row">{dayLabel(r.date)}</th>
              {[r.foreign, r.organ, r.individual].map((v, i) => (
                <td key={i} className={sharesTone(v)}>
                  {fmtShares(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-label text-muted mt-2">
        순매수 · 단위 만 주 · {dayLabel(rows[0].date)} 기준
        {holdRatio != null && ` · 외국인 보유율 ${holdRatio}%`}
      </p>
    </Panel>
  )
}

type SeriesValues = (number | null)[]

/**
 * 연간 실적. 매출과 이익은 크기가 수십 배 차이 나서 한 축에 그리면 이익이 보이지 않는다.
 * 두 줄로 나누고, 이익은 0선 기준 위(흑자)·아래(적자)로 그린다.
 */
function AnnualResults({
  years,
  revenue,
  operating,
  net,
  market,
}: {
  years: number[]
  revenue: SeriesValues
  operating: SeriesValues
  net: SeriesValues
  market: FocusTicker['market']
}) {
  const revMax = Math.max(1, ...revenue.map((v) => Math.abs(v ?? 0)))
  const profitMax = Math.max(1, ...[...operating, ...net].map((v) => Math.abs(v ?? 0)))
  const hasLoss = [...operating, ...net].some((v) => v != null && v < 0)
  const bar = (v: number | null, max: number, tone: string, half: boolean) => {
    if (v == null) return <div className="flex-1" />
    const h = Math.max(2, (Math.abs(v) / max) * 100)
    return (
      <div className={`flex-1 flex ${half ? (v >= 0 ? 'items-end' : 'items-start') : 'items-end'} h-full`}>
        <div className={`w-full ${v >= 0 ? 'rounded-t-sm' : 'rounded-b-sm'} ${tone}`} style={{ height: `${h}%` }} />
      </div>
    )
  }
  const positive = (v: number | null) => (v != null && v >= 0 ? v : null)
  const negative = (v: number | null) => (v != null && v < 0 ? v : null)
  const short = (v: number | null) => (v == null ? '—' : `${v < 0 ? '−' : ''}${fmtCap(Math.abs(v), market)}`)

  return (
    <div className="annual">
      <div className="annual-row-label">매출</div>
      <div className="annual-grid">
        {years.map((yr, i) => (
          <div key={yr} className="annual-col" aria-label={`${yr}년 매출 ${short(revenue[i])}`}>
            <span className="annual-value">{short(revenue[i])}</span>
            <div className="annual-bars h-16">{bar(revenue[i], revMax, 'bg-muted/35', false)}</div>
          </div>
        ))}
      </div>

      <div className="annual-row-label mt-3">
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-text/80 mr-1" aria-hidden="true" />
          영업이익
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-muted/60 mr-1" aria-hidden="true" />
          순이익
        </span>
      </div>
      <div className="annual-grid">
        {years.map((yr, i) => {
          const op = operating[i]
          const margin = op != null && revenue[i] ? (op / (revenue[i] as number)) * 100 : null
          return (
            <div
              key={yr}
              className="annual-col"
              aria-label={`${yr}년 영업이익 ${short(op)}, 순이익 ${short(net[i])}${margin != null ? `, 영업이익률 ${margin.toFixed(1)}%` : ''}`}
            >
              <span className={`annual-value ${op != null && op < 0 ? 'text-down' : ''}`}>
                {short(op)}
                {op != null && op < 0 && <span className="ml-0.5">적자</span>}
              </span>
              <div className={`annual-bars ${hasLoss ? 'h-10' : 'h-16'}`}>
                {bar(positive(op), profitMax, 'bg-text/80', false)}
                {bar(positive(net[i]), profitMax, 'bg-muted/60', false)}
              </div>
              {hasLoss && (
                <div className="annual-bars h-10 border-t border-border">
                  {bar(negative(op), profitMax, 'bg-down/70', true)}
                  {bar(negative(net[i]), profitMax, 'bg-down/40', true)}
                </div>
              )}
              <span className="annual-year">{yr}</span>
              <span className="annual-margin">{margin != null ? `이익률 ${margin.toFixed(1)}%` : ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function FundamentalView({
  t,
  tickers,
  onAddTicker,
  onOpen,
  onNavigate,
}: {
  t: FocusTicker
  tickers: FocusTicker[]
  onAddTicker: (x: FocusTicker) => void
  onOpen: (x: FocusTicker) => void
  onNavigate: (tab: TabKey) => void
}) {
  const isStock = t.kind === 'stock'
  const profile = useQuery({
    queryKey: ['profile', t.market, t.ticker],
    queryFn: () => getProfile(t.market, t.ticker),
    enabled: t.market === 'KR',
  })
  const val = useQuery({
    queryKey: ['val', t.market, t.ticker],
    queryFn: () => getValuation(t.market, t.ticker),
    enabled: isStock,
  })
  const fpe = useQuery({
    queryKey: ['fpe', t.market, t.ticker],
    queryFn: () => getForwardPe(t.market, t.ticker),
    enabled: isStock,
  })
  const trend = useQuery({
    queryKey: ['trend', t.market, t.ticker],
    queryFn: () => getTrend(t.market, t.ticker),
    enabled: isStock,
  })
  const target = useQuery({
    queryKey: ['target', t.market, t.ticker],
    queryFn: () => getTarget(t.market, t.ticker),
    enabled: isStock,
  })
  const priceQ = useQuery({
    queryKey: ['prices', t.ticker, '1m'],
    queryFn: () => getPrices(t.ticker, '1m'),
    enabled: isStock,
  })

  if (!isStock) {
    const isIndex = t.kind === 'index'
    const desc = profile.data?.description
    return (
      <div className="space-y-3">
        <Panel label={isIndex ? '지수에는 기업 가치 지표가 없어요' : 'ETF에는 기업 가치 지표가 없어요'}>
          <p className="text-sm text-muted leading-relaxed">
            PER·PBR 같은 지표는 개별 기업에만 계산돼요. {isIndex ? '지수' : '상품'}의 흐름과 예상 변동 범위는 차트와
            종합 분석에서 확인하세요.
          </p>
          {t.lev && (
            <p className="text-sm font-medium leading-relaxed mt-2">
              {t.lev} 레버리지 상품이라 하루 변동이 기초자산보다 훨씬 커요. 종합 분석의 레버리지 감쇠 패널도 함께
              보세요.
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="button button-quiet" onClick={() => onNavigate('tech')}>
              차트 보기
            </button>
            <button className="button button-quiet" onClick={() => onNavigate('signal')}>
              종합 분석 보기
            </button>
          </div>
        </Panel>
        {!isIndex && desc && (
          <Panel label="상품 개요">
            <p className="text-sm text-muted leading-relaxed">{desc}</p>
          </Panel>
        )}
        {!isIndex && <DealTrendPanel t={t} />}
      </div>
    )
  }

  const v = val.data
  const hasVal = !!v && [v.PER, v.PBR, v.EPS, v.ROE, v.배당수익률, v.시가총액].some((x) => x != null)
  const fwd = fpe.data?.forward[0]
  const cur = fpe.data?.trailing
  const yearsData =
    trend.data && 'years' in trend.data ? (trend.data as { years: number[] } & Record<string, SeriesValues>) : null

  return (
    <div className="fund-grid">
      <div className="fund-wide">
        {val.isLoading ? (
          <div className="kpi-grid" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[84px] rounded-xl shimmer" />
            ))}
          </div>
        ) : val.isError ? (
          <Panel>
            <ErrorState label="재무 지표를 불러오지 못했어요" onRetry={() => val.refetch()} />
          </Panel>
        ) : hasVal && v ? (
          <div className="kpi-grid">
            <Metric
              label="PER"
              help="per"
              value={v.PER != null ? `${fmtNum(v.PER, 1)}배` : '—'}
              sub={fwd ? `예상 ${fmtNum(fwd.per, 1)}배` : undefined}
            />
            <Metric label="PBR" help="pbr" value={v.PBR != null ? `${fmtNum(v.PBR, 2)}배` : '—'} />
            <Metric
              label="EPS"
              help="eps"
              value={fmtEps(v.EPS, t.market)}
              sub={fwd ? `예상 ${fmtEps(fwd.eps, t.market)}` : undefined}
            />
            <Metric label="ROE" help="roe" value={v.ROE != null ? `${(v.ROE * 100).toFixed(1)}%` : '—'} />
            {/* 주당배당금은 배당수익률과 같이 읽는 값이라 아래에 붙인다. */}
            <Metric
              label="배당수익률"
              value={v.배당수익률 != null ? `${v.배당수익률.toFixed(2)}%` : '—'}
              sub={v.주당배당금 != null ? `주당 ${fmtPrice(v.주당배당금, t.market)}` : undefined}
            />
            <Metric label="시가총액" value={fmtCap(v.시가총액, t.market)} />
          </div>
        ) : (
          <Panel label="가치 지표 없음">
            <p className="text-sm text-muted leading-relaxed">
              ETF·ETN·리츠나 새로 상장한 종목은 PER·PBR 같은 지표가 제공되지 않아요.
            </p>
          </Panel>
        )}
      </div>

      {/* 애널리스트 목표주가 */}
      {(() => {
        if (target.isLoading) return <PanelSkeleton height={150} />
        const tp = target.data?.target
        const price = priceQ.data?.at(-1)?.close
        if (!tp || !price) return null
        const upside = (tp / price - 1) * 100
        const rec = target.data?.recomm ?? null
        const recLabel = rec == null ? '—' : rec >= 3.5 ? '매수' : rec >= 2.5 ? '중립' : '매도'
        return (
          <Panel label="애널리스트 목표주가" help="target">
            <dl className="stat-pair">
              <div>
                <dt className="metric-label">목표주가 평균</dt>
                <dd className="font-mono text-lg font-semibold tnum">{fmtPrice(tp, t.market)}</dd>
                <dd className={`text-xs ${upside >= 0 ? 'text-up' : 'text-down'}`}>
                  현재가보다 <span className="font-mono tnum">{`${upside >= 0 ? '+' : '−'}${Math.abs(upside).toFixed(1)}%`}</span>
                </dd>
              </div>
              <div>
                <dt className="metric-label">투자의견 평균</dt>
                <dd className="text-lg font-semibold">{recLabel}</dd>
                {rec != null && (
                  <dd className="text-xs text-muted">
                    <span className="font-mono tnum">{rec.toFixed(2)}</span> / 5점 (5 = 적극 매수)
                  </dd>
                )}
              </div>
            </dl>
            <p className="text-label text-muted mt-2">증권사 컨센서스 · 현재가 {fmtPrice(price, t.market)} 기준</p>
          </Panel>
        )
      })()}

      {/* 미래 PER */}
      {fpe.isLoading ? (
        <PanelSkeleton height={150} />
      ) : (
        fpe.data &&
        fpe.data.forward.length > 0 && (
          <Panel label="미래 PER" help="fwdper">
            <dl className="stat-pair">
              {fpe.data.forward.map((f) => {
                const diff = cur ? (f.per / cur - 1) * 100 : null
                return (
                  <div key={f.period}>
                    <dt className="metric-label">{f.period === '추정' ? '컨센서스 추정' : f.period}</dt>
                    <dd className="font-mono text-lg font-semibold tnum">{fmtNum(f.per, 1)}배</dd>
                    {diff != null && (
                      <dd className="text-xs text-muted">
                        현재 대비 <span className="font-mono tnum">{`${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(0)}%`}</span>
                        {' · '}
                        {diff < 0 ? '이익 증가 예상' : '이익 감소 예상'}
                      </dd>
                    )}
                    <dd className="text-xs text-muted">
                      예상 EPS <span className="font-mono tnum">{fmtEps(f.eps, t.market)}</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
            <p className="text-label text-muted mt-2">
              현재가 ÷ 애널리스트 예상 EPS{cur != null && ` · 현재 PER ${fmtNum(cur, 1)}배`} · 전망에 따라 바뀌어요
            </p>
          </Panel>
        )
      )}

      {/* 투자자별 매매동향 (국내) */}
      <DealTrendPanel t={t} />

      {/* 동종업종 비교 (국내) */}
      <PeersPanel
        t={t}
        tickers={tickers}
        onAddTicker={onAddTicker}
        onOpen={onOpen}
        title={hasVal ? '동종업종 비교' : '비슷한 상품'}
      />

      {/* 연간 실적 */}
      {trend.isLoading ? (
        <PanelSkeleton height={240} />
      ) : yearsData && yearsData.years?.length ? (
        <Panel label="연간 실적 추이">
          <AnnualResults
            years={yearsData.years}
            revenue={yearsData['매출'] ?? []}
            operating={yearsData['영업이익'] ?? []}
            net={yearsData['순이익'] ?? []}
            market={t.market}
          />
        </Panel>
      ) : null}

      {/* 증권사 리포트 (국내) */}
      {profile.data && profile.data.researches.length > 0 && (
        <Panel label="최근 증권사 리포트">
          <ul className="space-y-2.5">
            {profile.data.researches.map((r, i) => (
              <li key={i} className="border-b border-border last:border-0 pb-2.5 last:pb-0">
                <p className="text-sm leading-snug">{r.title}</p>
                <p className="text-label text-muted mt-0.5">
                  {r.brokerage} · <span className="font-mono tnum">{r.date.replaceAll('-', '.')}</span>
                </p>
              </li>
            ))}
          </ul>
          <a
            href={`https://m.stock.naver.com/domestic/stock/${t.ticker}/research`}
            target="_blank"
            rel="noreferrer"
            className="text-action w-full justify-center gap-1 mt-1"
          >
            네이버 증권에서 리포트 원문 보기
            <Icon name="external" size={14} />
            <span className="sr-only">(새 탭에서 열림)</span>
          </a>
        </Panel>
      )}

      {t.market === 'US' && (
        <p className="fund-wide text-label text-muted">
          목표주가·투자자별 매매동향·동종업종·증권사 리포트는 국내 종목만 제공돼요.
        </p>
      )}
    </div>
  )
}
