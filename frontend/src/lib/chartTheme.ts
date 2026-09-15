import { ColorType, TickMarkType, type Time } from 'lightweight-charts'
import type { Market } from '../data/tickers'

/** 차트 공통 색 — 상승=빨강 / 하락=파랑 (KR 관례) */
export const CHART_UP = '#F25D6B'
export const CHART_DOWN = '#4D94F8'
export const CHART_ACCENT = '#B0B8C1'

/** 테마별 보조 선 색. 흰 배경에서는 어두운 테마용 금색·회색이 거의 보이지 않아 따로 둔다. */
export function chartColors(light: boolean) {
  return light
    ? {
        up: '#F04452',
        down: '#3182F6',
        accent: '#4E5968',
        ma20: '#F59E0B',
        ma60: '#8B95A1',
        band: 'rgba(107,118,132,0.55)',
        volUp: 'rgba(240,68,82,0.22)',
        volDown: 'rgba(49,130,246,0.22)',
        histUp: 'rgba(240,68,82,0.45)',
        histDown: 'rgba(49,130,246,0.45)',
        neutral: '#191F28',
        border: '#E5E8EB',
      }
    : {
        up: CHART_UP,
        down: CHART_DOWN,
        accent: CHART_ACCENT,
        ma20: '#F5A524',
        ma60: '#8A8A94',
        band: 'rgba(158,158,164,0.5)',
        volUp: 'rgba(242,93,107,0.3)',
        volDown: 'rgba(77,148,248,0.3)',
        histUp: 'rgba(242,93,107,0.5)',
        histDown: 'rgba(77,148,248,0.5)',
        neutral: '#E4E4E5',
        border: '#2C2C35',
      }
}

/** 한국 종목은 원 단위 정수와 천 단위 쉼표, 지수는 소수 둘째 자리, 미국은 달러 소수 둘째 자리. */
export function priceFormatFor(market: Market, kind: string) {
  if (market === 'KR' && kind !== 'index') {
    return { type: 'custom' as const, minMove: 1, formatter: (p: number) => Math.round(p).toLocaleString('ko-KR') }
  }
  return {
    type: 'custom' as const,
    minMove: 0.01,
    formatter: (p: number) => p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** lightweight-charts의 Time(문자열·BusinessDay·UTC 초)을 날짜로 바꾼다. 문자열 날짜는 시간대 변환 없이 읽는다. */
export function timeToDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') {
    const [y, m, d] = time.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(time.year, time.month - 1, time.day)
}

export function fmtChartDate(time: Time, withTime = false): string {
  const d = timeToDate(time)
  const day = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${WEEKDAY[d.getDay()]})`
  if (!withTime) return day
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * lightweight-charts 공통 옵션.
 *
 * 네 개 차트가 같은 옵션 덩어리를 각자 복사해 갖고 있었다. 테마 색을 하나
 * 바꾸려면 네 곳을 고쳐야 했고, 한 곳을 빠뜨리면 다크/라이트 전환에서
 * 그 차트만 어긋난다.
 *
 * timeVisible: 일봉 차트는 날짜만 보여주면 되지만, 분봉(야간 perp)은
 * 시각까지 필요해서 인자로 받는다.
 *
 * 스크롤: 휠·세로 스와이프는 페이지 스크롤에 양보한다. 차트 위에서 페이지가 멈추면
 * 휴대폰에서는 화면을 빠져나갈 수 없다. 좌우 끌기와 두 손가락 확대는 그대로 둔다.
 */
export function chartBase(light: boolean, timeVisible = false, attribution = true) {
  const c = chartColors(light)
  const text = light ? '#6B7684' : '#9E9EA4'
  const grid = light ? 'rgba(25,31,40,0.05)' : 'rgba(255,255,255,0.04)'
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: text,
      fontFamily: '"Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif',
      fontSize: 11,
      attributionLogo: attribution,
    },
    grid: {
      vertLines: { color: grid },
      horzLines: { color: grid },
    },
    localization: {
      locale: 'ko-KR',
      timeFormatter: (time: Time) => fmtChartDate(time, timeVisible),
    },
    rightPriceScale: { borderColor: c.border, minimumWidth: 72 },
    timeScale: {
      borderColor: c.border,
      timeVisible,
      secondsVisible: false,
      lockVisibleTimeRangeOnResize: true,
      tickMarkFormatter: (time: Time, type: TickMarkType) => {
        const d = timeToDate(time)
        if (type === TickMarkType.Year) return `${d.getFullYear()}년`
        if (type === TickMarkType.Month) return `${d.getMonth() + 1}월`
        if (type === TickMarkType.DayOfMonth) return `${d.getMonth() + 1}/${d.getDate()}`
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      },
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: true },
    crosshair: { mode: 1 as const },
    autoSize: true,
  }
}
