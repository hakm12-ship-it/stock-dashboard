import { useState } from 'react'

// 초보자용 용어 설명 사전
export const HELP: Record<string, { title: string; text: string }> = {
  verdict: {
    title: '종합 신호',
    text: '여러 기술적 지표를 정해진 규칙으로 합쳐 지금 분위기를 매수 우위·중립·매도 우위로 요약한 참고 신호예요.\n미래를 맞히는 예측이 아니라, 과거·현재 지표의 요약이에요.',
  },
  forecast: {
    title: '예상 변동 범위',
    text: '최근 등락폭(변동성)을 기준으로, 앞으로 며칠간 이 정도 범위 안에서 움직일 가능성이 높다는 걸 통계로 표시한 거예요.\n오를지 내릴지 방향을 말하는 건 아니고, 실제로는 범위를 벗어날 수도 있어요.',
  },
  sr: {
    title: '지지선 · 저항선',
    text: '지지선 = 과거에 가격이 잘 안 내려가고 튀어오르던 가격대 (매수 관심 구간).\n저항선 = 잘 못 넘던 가격대 (매도 관심 구간).\n과거 흐름 기준일 뿐, 반드시 지켜지는 건 아니에요.',
  },
  rsi: {
    title: 'RSI (상대강도지수)',
    text: '0~100 사이 값이에요. 70 이상이면 "많이 올라 과열(과매수)", 30 이하면 "많이 내려 눌림(과매도)"으로 봐요.\n과매수라고 꼭 떨어지는 건 아니에요.',
  },
  macd: {
    title: 'MACD',
    text: '단기·장기 이동평균의 차이로 상승/하락 힘(모멘텀)을 보는 지표예요.\n0선 위로 올라오면 상승 힘이 붙는 신호, 아래로 내려가면 하락 힘으로 봐요.',
  },
  ma: {
    title: '이동평균선 (MA)',
    text: '최근 N일 평균 가격을 이은 선이에요. 주가가 그 위에 있으면 그 기간 흐름이 좋다고 봐요.\n20일선(단기)·60일선(중기)을 자주 써요.',
  },
  bollinger: {
    title: '볼린저 밴드',
    text: '평균선 위아래로 변동성만큼 띠를 그린 거예요. 띠가 넓으면 변동이 크다는 뜻.\n가격이 띠 위쪽 끝에 닿으면 과열, 아래쪽 끝이면 눌림 신호로 봐요.',
  },
  per: {
    title: 'PER (주가수익비율)',
    text: '주가 ÷ 주당순이익. 이익 대비 주가가 비싼지 싼지를 봐요.\n낮을수록 싸다고 보지만, 업종·성장성에 따라 기준이 달라요.',
  },
  pbr: {
    title: 'PBR (주가순자산비율)',
    text: '주가 ÷ 주당순자산. 1 미만이면 회사 장부가치보다 싸게 거래된다는 뜻이에요.',
  },
  roe: {
    title: 'ROE (자기자본이익률)',
    text: '자기자본으로 얼마나 이익을 냈는지(수익성)를 나타내요. 높을수록 돈을 잘 버는 회사예요.',
  },
  fwdper: {
    title: '미래 PER',
    text: '지금 주가 ÷ 애널리스트가 예상하는 미래 이익(예상 EPS).\n현재 PER보다 낮으면 "앞으로 이익이 늘어 저평가될 거란 기대"가 반영된 거예요. 컨센서스라 바뀔 수 있어요.',
  },
  eps: {
    title: 'EPS (주당순이익)',
    text: '1주가 벌어들인 이익이에요. 주가 ÷ EPS = PER.',
  },
  target: {
    title: '애널리스트 목표주가',
    text: '여러 증권사 애널리스트가 제시한 목표주가의 평균이에요. 현재가 대비 상승여력(%)을 보여줘요.\n투자의견은 높을수록 매수 쪽(대략 4~5 매수 · 3 중립). 전망이라 자주 바뀌고 맞는다는 보장은 없어요.',
  },
}

export default function HelpTip({ term }: { term: keyof typeof HELP | string }) {
  const [open, setOpen] = useState(false)
  const info = HELP[term]
  if (!info) return null
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-border text-muted text-[0.6rem] leading-none align-middle ml-1"
        aria-label={`${info.title} 설명`}
      >
        ?
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-5 fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-4 w-full max-w-app card-shadow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold">{info.title}</span>
              <button onClick={() => setOpen(false)} className="text-muted text-xl leading-none px-1">
                ×
              </button>
            </div>
            <p className="text-sm text-muted leading-relaxed whitespace-pre-line">{info.text}</p>
            <p className="text-[0.6rem] text-muted/70 mt-3">참고용 설명 · 투자 조언이 아니에요</p>
          </div>
        </div>
      )}
    </>
  )
}
