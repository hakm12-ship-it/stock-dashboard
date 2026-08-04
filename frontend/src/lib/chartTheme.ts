import { ColorType } from 'lightweight-charts'

/** 차트 공통 색 — 상승=빨강 / 하락=파랑 (KR 관례) */
export const CHART_UP = '#F23645'
export const CHART_DOWN = '#2E86FF'
export const CHART_ACCENT = '#E0A63C'

/**
 * lightweight-charts 공통 옵션.
 *
 * 네 개 차트가 같은 옵션 덩어리를 각자 복사해 갖고 있었다. 테마 색을 하나
 * 바꾸려면 네 곳을 고쳐야 했고, 한 곳을 빠뜨리면 다크/라이트 전환에서
 * 그 차트만 어긋난다.
 *
 * timeVisible: 일봉 차트는 날짜만 보여주면 되지만, 분봉(야간 perp)은
 * 시각까지 필요해서 인자로 받는다.
 */
export function chartBase(light: boolean, timeVisible = false) {
  const text = light ? '#5C6672' : '#8B94A3'
  const grid = light ? 'rgba(22,27,38,0.07)' : 'rgba(35,40,51,0.4)'
  const border = light ? '#E0E3E8' : '#232833'
  return {
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: text,
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 10,
    },
    grid: {
      vertLines: { color: grid },
      horzLines: { color: grid },
    },
    rightPriceScale: { borderColor: border },
    timeScale: { borderColor: border, timeVisible, secondsVisible: false },
    crosshair: { mode: 1 as const },
    autoSize: true,
  }
}
