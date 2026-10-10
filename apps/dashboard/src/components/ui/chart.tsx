import { useId, type ReactElement } from 'react'
import {
  Area,
  AreaChart as ReAreaChart,
  Bar,
  BarChart as ReBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type ChartKind = 'bar' | 'line' | 'area' | 'pie'

export type ChartPoint = { x: string; y: number }

export type ChartSeries = { name: string; points: ChartPoint[] }

export type ChartSlice = { name: string; value: number; color?: string }

type ChartProps = {
  kind: ChartKind
  /** Required for bar / line / area. */
  series?: ChartSeries[]
  /** Required for pie. */
  slices?: ChartSlice[]
  /** Plot height in px, or a CSS length (`100%`) when the parent sets the box. */
  height?: number | string
  /** Axes and grid. Sparklines pass false. Ignored for pie. */
  showAxes?: boolean
  /** First series color token. Default accent; AI activity uses ai (violet). */
  tone?: 'accent' | 'ai'
  xLabel?: string
  yLabel?: string
  /** Dashed placeholder when there is nothing to plot. Omitted series render nothing. */
  emptyLabel?: string
  ariaLabel?: string
}

const SERIES_COLORS = {
  accent: [
    'rgb(var(--color-accent))',
    'rgb(var(--color-ai))',
    'rgb(var(--color-text-muted))',
  ],
  ai: [
    'rgb(var(--color-ai))',
    'rgb(var(--color-accent))',
    'rgb(var(--color-text-muted))',
  ],
} as const

const TICK = { fill: 'rgb(var(--color-text-muted))', fontSize: 11 }

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  const trim = (scaled: number) => {
    const fixed = scaled.toFixed(1)
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
  }
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1_000)}k`
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}k`
  return String(Math.round(value))
}

function formatQuantity(value: number | string | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value == null ? '' : String(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function colorAt(tone: 'accent' | 'ai', index: number): string {
  const palette = SERIES_COLORS[tone]
  return palette[index % palette.length]
}

function usableSeries(series: ChartSeries[]): ChartSeries[] {
  return series
    .map((row) => ({
      name: row.name || 'Series',
      points: (row.points ?? []).filter((point) => point.x && Number.isFinite(point.y)),
    }))
    .filter((row) => row.points.length > 0)
}

function rowsOf(series: ChartSeries[]): Record<string, string | number>[] {
  const order: string[] = []
  const byX = new Map<string, Record<string, string | number>>()
  for (const row of series) {
    for (const point of row.points) {
      let record = byX.get(point.x)
      if (!record) {
        record = { x: point.x }
        byX.set(point.x, record)
        order.push(point.x)
      }
      record[row.name] = point.y
    }
  }
  return order.map((key) => byX.get(key)!)
}

function endDot(color: string, lastIndex: number) {
  return (props: { cx?: number; cy?: number; index?: number }) => {
    if (props.index !== lastIndex || props.cx == null || props.cy == null) return <g />
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={3.5}
        fill={color}
        stroke="rgb(var(--color-bg-surface))"
        strokeWidth={2}
      />
    )
  }
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ name?: string; value?: number | string }>
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border/60 bg-bg-surface px-2.5 py-1.5 text-sm">
      {label != null && String(label) !== '' ? <p className="mb-0.5 text-text-heading">{label}</p> : null}
      {payload.map((item) => (
        <p key={String(item.name)} className="tabular-nums text-text-secondary">
          <span className="text-text-muted">{item.name}</span> {formatQuantity(item.value)}
        </p>
      ))}
    </div>
  )
}

/**
 * Shared bar, line, area and pie chart. Colors come from Bokito tokens.
 * Canvas snapshots and the Overview token sparkline both use this.
 */
export function Chart({
  kind,
  series = [],
  slices = [],
  height = 144,
  showAxes = true,
  tone = 'accent',
  xLabel,
  yLabel,
  emptyLabel,
  ariaLabel,
}: ChartProps) {
  const gradPrefix = `chart-fill-${useId().replace(/:/g, '')}`

  if (kind === 'pie') {
    const pieData = slices.filter((slice) => slice.name && Number.isFinite(slice.value) && slice.value > 0)
    if (pieData.length === 0) {
      if (!emptyLabel) return null
      return (
        <div
          className="flex items-center justify-center rounded-md border border-dashed border-border/50 px-3 text-center text-xs text-text-muted"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      )
    }
    return (
      <div className="min-w-0" role="img" aria-label={ariaLabel}>
        <div className="w-full" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <RePieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="88%"
                paddingAngle={2}
                stroke="rgb(var(--color-bg-surface))"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {pieData.map((slice, index) => (
                  <Cell key={slice.name} fill={slice.color || colorAt(tone, index)} />
                ))}
              </Pie>
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={
                      props.payload as
                        | ReadonlyArray<{ name?: string; value?: number | string }>
                        | undefined
                    }
                  />
                )}
                wrapperStyle={{ outline: 'none' }}
              />
            </RePieChart>
          </ResponsiveContainer>
        </div>
      </div>
    )
  }

  const usable = usableSeries(series)
  if (usable.length === 0) {
    if (!emptyLabel) return null
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border/50 px-3 text-center text-xs text-text-muted"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    )
  }

  const data = rowsOf(usable)
  const categories = data.map((row) => String(row.x))
  const axisCaption = [xLabel, yLabel].filter(Boolean).join(' · ')
  const spark = !showAxes
  const lastIndex = data.length - 1

  const marks = usable.map((row, index) => {
    const color = colorAt(tone, index)
    if (kind === 'bar') {
      return <Bar key={row.name} dataKey={row.name} fill={color} radius={2} isAnimationActive={false} />
    }
    if (kind === 'area') {
      return (
        <Area
          key={row.name}
          type="monotone"
          dataKey={row.name}
          stroke={color}
          fill={`url(#${gradPrefix}-${index})`}
          fillOpacity={1}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          dot={spark ? endDot(color, lastIndex) : false}
          activeDot={{ r: 4, strokeWidth: 0, fill: color }}
          isAnimationActive={false}
        />
      )
    }
    return (
      <Line
        key={row.name}
        type="monotone"
        dataKey={row.name}
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        dot={spark ? endDot(color, lastIndex) : false}
        activeDot={{ r: 4, strokeWidth: 0, fill: color }}
        isAnimationActive={false}
      />
    )
  })

  const Plot = kind === 'bar' ? ReBarChart : kind === 'area' ? ReAreaChart : ReLineChart

  const plot = (
    <Plot
      data={data}
      margin={{
        top: spark ? 14 : 8,
        right: spark ? 14 : 8,
        left: spark ? 4 : 0,
        bottom: spark ? 2 : 0,
      }}
    >
      {kind === 'area' ? (
        <defs>
          {usable.map((_, index) => (
            <linearGradient key={index} id={`${gradPrefix}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorAt(tone, index)} stopOpacity={0.42} />
              <stop offset="70%" stopColor={colorAt(tone, index)} stopOpacity={0.08} />
              <stop offset="100%" stopColor={colorAt(tone, index)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
      ) : null}
      {showAxes ? (
        <CartesianGrid vertical={false} stroke="rgb(var(--color-border))" strokeOpacity={0.7} />
      ) : null}
      <XAxis
        dataKey="x"
        hide={!showAxes}
        axisLine={false}
        tickLine={false}
        tick={kind === 'bar' ? false : TICK}
        interval="preserveStartEnd"
      />
      <YAxis
        hide={!showAxes}
        axisLine={false}
        tickLine={false}
        tick={TICK}
        tickFormatter={(value) => compactNumber(Number(value))}
        width={showAxes ? 44 : 0}
        domain={[0, 'dataMax']}
        allowDataOverflow={false}
        padding={spark ? { top: 6, bottom: 0 } : { top: 8, bottom: 0 }}
      />
      <Tooltip
        content={(props) => (
          <ChartTooltip
            active={props.active}
            label={props.label}
            payload={props.payload as ReadonlyArray<{ name?: string; value?: number | string }> | undefined}
          />
        )}
        cursor={showAxes ? { stroke: 'rgb(var(--color-border))' } : false}
        wrapperStyle={{ outline: 'none' }}
      />
      {marks}
    </Plot>
  ) as ReactElement

  return (
    <div className="min-w-0" role="img" aria-label={ariaLabel}>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {plot}
        </ResponsiveContainer>
      </div>
      {kind === 'bar' && showAxes ? (
        <div className="mt-1 flex gap-1">
          {categories.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="min-w-0 flex-1 truncate-fade text-center text-2xs text-text-muted"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {axisCaption ? <p className="mt-1 text-2xs text-text-muted">{axisCaption}</p> : null}
    </div>
  )
}

export default Chart
