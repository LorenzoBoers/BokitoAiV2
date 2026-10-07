import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Stack({ children }: { children?: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>
}

export function Row({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3">{children}</div>
}

export function Grid({ columns = 2, children }: { columns?: number; children?: ReactNode }) {
  const cols = Math.min(4, Math.max(1, columns))
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
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
  const toneClass =
    tone === 'ok'
      ? 'border-status-success/40 bg-status-success/10'
      : tone === 'watch'
        ? 'border-status-warning/40 bg-status-warning/10'
        : 'border-border/60 bg-bg-input/40'
  return (
    <div className={cn('rounded-md border px-3 py-2 text-sm text-text-primary', toneClass)}>
      {text || children}
    </div>
  )
}

export function Divider() {
  return <hr className="border-border/60" />
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
    <span className="inline-flex rounded-md border border-border/60 px-1.5 py-0.5 text-2xs font-medium text-text-secondary">
      {value}
    </span>
  )
}

export function Stat({
  title,
  label,
  value,
  unit,
  hint,
  source,
}: {
  title?: string
  label?: string
  value?: string
  unit?: string
  hint?: string
  source?: string
}) {
  const heading = title || label
  if (!heading || !value) return null
  return (
    <div>
      <p className="text-xs text-text-muted">{heading}</p>
      <p className="text-2xl font-semibold tabular-nums text-text-heading">
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-text-muted">{unit}</span> : null}
      </p>
      {hint || source ? <p className="mt-0.5 text-2xs text-text-muted">{hint || source}</p> : null}
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
  if (!columns.length || !rows.length) return null
  return (
    <section className="space-y-2">
      {title ? <h3 className="text-sm font-medium text-text-heading">{title}</h3> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[240px] text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs text-text-muted">
              {columns.map((col) => (
                <th key={col} className="px-2 py-1.5 font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-border/40">
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
      {source ? <p className="text-2xs text-text-muted">{source}</p> : null}
    </section>
  )
}

export function BarChart(props: ChartProps) {
  return <ChartBars {...props} kind="bar" />
}

export function LineChart(props: ChartProps) {
  return <ChartBars {...props} kind="line" />
}

type ChartProps = {
  title: string
  xLabel: string
  yLabel: string
  source: string
  series: { name: string; points: { x: string; y: number }[] }[]
}

function ChartBars({ title, xLabel, yLabel, source, series, kind }: ChartProps & { kind: 'bar' | 'line' }) {
  const usable = series
    .map((row) => ({
      name: row.name,
      points: row.points.filter((p) => p.x && Number.isFinite(p.y)),
    }))
    .filter((row) => row.points.length > 0)
  if (!title || usable.length === 0) return null
  const ys = usable.flatMap((row) => row.points.map((p) => p.y))
  const max = Math.max(1, ...ys)
  const labels = usable[0]?.points.map((p) => p.x) ?? []
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-text-heading">{title}</h3>
      <div className="flex h-36 items-end gap-2">
        {kind === 'bar' ? (
          labels.map((label, idx) => {
            const value = usable[0]?.points[idx]?.y ?? 0
            return (
              <div key={`${label}-${idx}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className="w-full max-w-[28px] rounded-sm bg-accent"
                  style={{ height: `${Math.max(6, Math.round((value / max) * 112))}px` }}
                  title={`${label}: ${value}`}
                />
                <span className="w-full truncate-fade text-center text-2xs text-text-muted">{label}</span>
              </div>
            )
          })
        ) : (
          <svg viewBox="0 0 100 40" className="h-full w-full" aria-hidden>
            {usable.map((row, sIdx) => {
              const pts = row.points
              const d = pts
                .map((p, i) => {
                  const x = pts.length === 1 ? 50 : (i / (pts.length - 1)) * 100
                  const y = 38 - (p.y / max) * 34
                  return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
                })
                .join(' ')
              return (
                <path
                  key={row.name}
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={sIdx === 0 ? 'text-accent' : 'text-text-muted'}
                />
              )
            })}
          </svg>
        )}
      </div>
      <p className="text-2xs text-text-muted">
        {xLabel}
        {xLabel && yLabel ? ' · ' : ''}
        {yLabel}
        {source ? ` · ${source}` : ''}
      </p>
      {usable.length > 1 ? (
        <p className="text-2xs text-text-muted">{usable.map((row) => row.name).join(' · ')}</p>
      ) : null}
    </section>
  )
}
