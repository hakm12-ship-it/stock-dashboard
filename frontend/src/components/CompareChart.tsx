import { useEffect, useRef } from 'react'
import { createChart, ColorType, type IChartApi } from 'lightweight-charts'

export interface CompareSeries {
  name: string
  color: string
  data: { time: string; value: number }[]
}

export default function CompareChart({ series, light }: { series: CompareSeries[]; light: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const text = light ? '#5C6672' : '#8B94A3'
    const grid = light ? 'rgba(22,27,38,0.07)' : 'rgba(35,40,51,0.4)'
    const bd = light ? '#E0E3E8' : '#232833'
    const chart: IChartApi = createChart(ref.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: text,
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: bd },
      timeScale: { borderColor: bd, timeVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
    })
    series.forEach((s) => {
      if (!s.data.length) return
      const ls = chart.addLineSeries({
        color: s.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'custom', formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` },
      })
      ls.setData(s.data)
    })
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [series, light])

  return <div ref={ref} className="w-full h-[250px]" />
}
