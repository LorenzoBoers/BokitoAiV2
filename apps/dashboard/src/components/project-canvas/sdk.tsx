import { useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Chart } from '../ui'
import { Button } from '../ui/button'
import { Callout as UiCallout, type CalloutTone } from '../ui/callout'
import { cn } from '../../lib/utils'

function CanvasNotice({ k }: { k: 'noData' | 'unknown' }) {
  const { t } = useTranslation('nav')
  return (
    <p data-testid="canvas-notice" className="text-2xs text-text-muted">
      {t(`projects.canvas.${k}`)}
    </p>
  )
}

export { CanvasNotice }

function SourceToggle({ source, children }: { source?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!source) return <>{children}</>
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        className="h-auto min-h-0 justify-start whitespace-normal bg-transparent p-0 text-left font-normal text-inherit hover:bg-transparent"
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </Button>
      {open ? (
        <p data-testid="canvas-source" className="text-2xs text-text-muted">
          {source}
        </p>
      ) : null}
    </>
  )
}

export function Stack({ children }: { children?: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>
}

export function Row({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3">{children}</div>
}

export function Grid({ columns = 2, children }: { columns?: number; children?: ReactNode }) {
  const cols = Math.min(4, Math.max(1, columns))
  // At most `cols` columns; a narrow pane wraps to fewer instead of squeezing.
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(max(140px, calc((100% - ${(cols - 1) * 12}px) / ${cols})), 1fr))`,
    gap: '12px',
  }
  return <div style={style}>{children}</div>
}

export function Card({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="panel p-3">
      {title ? <p className="mb-2 text-sm font-medium text-text-heading">{title}</p> : null}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function Heading({ text, level = 2, children }: { text?: string; level?: number; children?: ReactNode }) {
  if (!text && !children) return null
  const cls = level <= 1 ? 'text-lg font-semibold text-text-heading' : 'text-sm font-semibold text-text-heading'
  return <h2 className={cls}>{text || children}</h2>
}

export function Text({ text, children }: { text?: string; children?: ReactNode }) {
  if (!text && !children) return null
  return <p className="text-sm leading-relaxed text-text-primary">{text || children}</p>
}

const CALLOUT_TONE: Record<string, CalloutTone> = {
  info: 'info',
  success: 'success',
  ok: 'success',
  good: 'success',
  warning: 'warning',
  watch: 'warning',
  danger: 'error',
  error: 'error',
  bad: 'error',
}

export function Callout({
  text,
  tone = 'info',
  children,
}: {
  text?: string
  tone?: string
  children?: ReactNode
}) {
  if (!text && !children) return null
  return (
    <UiCallout tone={CALLOUT_TONE[tone] ?? 'info'}>
      <span className="text-sm text-text-primary">{text || children}</span>
    </UiCallout>
  )
}

export function Divider() {
  return <hr className="border-border" />
}

export function List({ items, children }: { items?: string[]; children?: ReactNode }) {
  const rows = items?.filter(Boolean) ?? []
  if (rows.length === 0 && !children) return null
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-text-primary">
      {rows.length
        ? rows.map((item) => <li key={item}>{item}</li>)
        : Array.isArray(children)
          ? children.map((child, idx) => <li key={idx}>{child}</li>)
          : <li>{children}</li>}
    </ul>
  )
}

export function Badge({ text, label }: { text?: string; label?: string }) {
  const value = text || label
  if (!value) return null
  return (
    <span className="inline-flex rounded-md border border-border px-1.5 py-0.5 text-2xs font-medium text-text-secondary">
      {value}
    </span>
  )
}

const STATUS_INK: Record<string, string> = {
  good: 'text-status-success',
  watch: 'text-status-warning',
  bad: 'text-status-error',
}

const STATUS_DOT: Record<string, string> = {
  good: 'bg-status-success',
  watch: 'bg-status-warning',
  bad: 'bg-status-error',
}

function TrendGlyph({ trend }: { trend?: string }) {
  if (trend === 'up') return <ArrowUpRight size={14} aria-hidden />
  if (trend === 'down') return <ArrowDownRight size={14} aria-hidden />
  if (trend === 'flat') return <Minus size={14} aria-hidden />
  return null
}

export function Stat({
  title,
  label,
  value,
  unit,
  hint,
  source,
  delta,
  trend,
  status,
  target,
  spark,
  tile = false,
}: {
  title?: string
  label?: string
  value?: string
  unit?: string
  hint?: string
  source?: string
  delta?: string
  trend?: string
  status?: string
  target?: string
  spark?: number[]
  tile?: boolean
}) {
  const { t } = useTranslation('nav')
  const heading = title || label
  if (!heading || !value) return null
  const note = hint
  const sparkPoints = (spark ?? [])
    .filter((point) => Number.isFinite(point))
    .map((point, index) => ({ x: String(index + 1), y: point }))
  return (
    <div className={cn('min-w-0', tile && 'panel flex flex-col gap-1 p-3')}>
      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        {status && STATUS_DOT[status] ? (
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden />
        ) : null}
        <span className="truncate">{heading}</span>
      </p>
      <SourceToggle source={source}>
        <span className="text-2xl font-semibold tabular-nums text-text-heading">
          {value}
          {unit ? <span className="ml-1 text-sm font-normal text-text-muted">{unit}</span> : null}
        </span>
      </SourceToggle>
      {delta || target || note ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-text-muted">
          {delta ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium tabular-nums',
                (status && STATUS_INK[status]) || 'text-text-secondary',
              )}
            >
              <TrendGlyph trend={trend} />
              {delta}
            </span>
          ) : null}
          {target ? <span>{t('projects.canvas.target', { value: target })}</span> : null}
          {note ? <span className="truncate">{note}</span> : null}
        </p>
      ) : null}
      {sparkPoints.length > 1 ? (
        <Chart kind="area" series={[{ name: heading, points: sparkPoints }]} showAxes={false} height={36} />
      ) : null}
    </div>
  )
}

export function Table({
  title,
  columns,
  rows,
  source,
}: {
  title?: string
  columns: string[]
  rows: string[][]
  source?: string
}) {
  const { t } = useTranslation('nav')
  if (!columns.length || !rows.length) return null
  const heading = title || (source ? t('projects.canvas.source') : '')
  return (
    <section className="space-y-2">
      {heading ? (
        <SourceToggle source={source}>
          <span className="text-sm font-medium text-text-heading">{heading}</span>
        </SourceToggle>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[240px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-text-muted">
              {columns.map((col) => (
                <th key={col} className="px-2 py-1.5 font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-border">
                {columns.map((col, cIdx) => (
                  <td key={`${col}-${cIdx}`} className="px-2 py-1.5 text-text-primary">
                    {row[cIdx] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function BarChart(props: ChartProps) {
  return <ChartFrame {...props} kind="bar" />
}

export function LineChart(props: ChartProps) {
  return <ChartFrame {...props} kind="line" />
}

export function AreaChart(props: ChartProps) {
  return <ChartFrame {...props} kind="area" />
}

export function PieChart({
  title,
  source,
  slices,
}: {
  title?: string
  source?: string
  slices: { name: string; value: number }[]
}) {
  const { t } = useTranslation('nav')
  const usable = slices.filter((slice) => slice.name && Number.isFinite(slice.value) && slice.value > 0)
  if (usable.length === 0) return <CanvasNotice k="noData" />
  const heading = title || (source ? t('projects.canvas.source') : '')
  return (
    <section className="space-y-2">
      {heading ? (
        <SourceToggle source={source}>
          <span className="text-sm font-medium text-text-heading">{heading}</span>
        </SourceToggle>
      ) : null}
      <Chart kind="pie" slices={usable} height={144} ariaLabel={title || 'Chart'} />
    </section>
  )
}

type ChartProps = {
  title?: string
  xLabel?: string
  yLabel?: string
  source?: string
  series: { name: string; points: { x: string; y: number }[] }[]
  stacked?: boolean
}

function ChartFrame({
  title,
  xLabel,
  yLabel,
  source,
  series,
  stacked = false,
  kind,
}: ChartProps & { kind: 'bar' | 'line' | 'area' }) {
  const usable = series
    .map((row) => ({
      name: row.name,
      points: row.points.filter((point) => point.x && Number.isFinite(point.y)),
    }))
    .filter((row) => row.points.length > 0)
  const { t } = useTranslation('nav')
  if (usable.length === 0) return <CanvasNotice k="noData" />
  const label = title || 'Chart'
  const heading = title || (source ? t('projects.canvas.source') : '')
  return (
    <section className="space-y-2">
      {heading ? (
        <SourceToggle source={source}>
          <span className="text-sm font-medium text-text-heading">{heading}</span>
        </SourceToggle>
      ) : null}
      <Chart
        kind={kind}
        series={usable}
        stack={stacked}
        xLabel={xLabel}
        yLabel={yLabel}
        height={168}
        ariaLabel={label}
      />
      {usable.length > 1 ? (
        <p className="text-2xs text-text-muted">{usable.map((row) => row.name).join(' · ')}</p>
      ) : null}
    </section>
  )
}
