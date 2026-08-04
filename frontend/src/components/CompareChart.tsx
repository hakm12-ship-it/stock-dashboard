import { useEffect, useRef } from 'react'
import { createChart, type IChartApi } from 'lightweight-charts'
import { chartBase } from '../lib/chartTheme'

export interface CompareSeries {
  name: string
  color: string
  data: { time: string; value: number }[]
}

export default function CompareChart({ series, light }: { series: CompareSeries[]; light: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart: IChartApi = createChart(ref.current, chartBase(light))
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
