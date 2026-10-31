import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// TechnicalView는 JSX라 node:test로 렌더할 수 없어 원본으로 회귀를 막는다.
// 주봉 배열을 차트 props 자리에서 바로 만들면 렌더마다 새 배열이 되어 TechnicalCharts가
// 차트를 지우고 다시 만든다 — 당겨서 새로고침 중 터치마다 깜빡이고 확대·이동 위치가 초기화된다.
const view = readFileSync(new URL('../views/TechnicalView.tsx', import.meta.url), 'utf8')

test('weekly candles keep one array across re-renders instead of being rebuilt in the chart props', () => {
  const chartProps = view.match(/<TechnicalCharts\b([\s\S]*?)\/>/)
  assert.ok(chartProps, 'TechnicalCharts element not found')
  const candlesProp = chartProps[1].match(/candles=\{([^}]*)\}/)
  assert.ok(candlesProp, 'candles prop not found')
  assert.doesNotMatch(candlesProp[1], /\(/, 'candles prop must not build a new array on every render')

  const calls = view.match(/toWeekly\(/g) ?? []
  assert.equal(calls.length, 1, 'weekly aggregation should happen in exactly one place')
  assert.match(
    view,
    /useMemo\(\s*\(\)\s*=>[^;]*toWeekly\(prices\.data\)[^;]*\[\s*weekly\s*,\s*prices\.data\s*\]\s*\)/,
    'weekly aggregation must be memoized on the timeframe and the fetched candles',
  )
})
