import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  LayoutDashboard,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import ChatMarkdown from '../inbox/ChatMarkdown'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { ProjectCanvasSkeleton } from '../ui/skeleton'
import {
  getProjectCanvas,
  patchProjectCanvas,
  putProjectCanvas,
  type ProjectCanvas,
  type ProjectCanvasWidget,
} from '../../lib/project-canvas-api'
import { formatAppNumber } from '../../lib/app-number'
import { cn } from '../../lib/utils'

type Props = {
  projectId: string
  canEdit: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function statusTone(level: string): string {
  switch (level) {
    case 'ok':
      return 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300'
    case 'watch':
      return 'border-amber-500/30 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200'
    case 'blocked':
      return 'border-status-error/30 bg-status-error/[0.06] text-status-error'
    default:
      return 'border-border/60 bg-bg-input/40 text-text-muted'
  }
}

function StatusIcon({ level }: { level: string }) {
  if (level === 'ok') return <CheckCircle2 size={16} />
  if (level === 'watch' || level === 'blocked') return <AlertTriangle size={16} />
  return <CircleDashed size={16} />
}

function WidgetShell({
  title,
  children,
  className,
  onRemove,
  canEdit,
}: {
  title?: string | null
  children: ReactNode
  className?: string
  onRemove?: () => void
  canEdit?: boolean
}) {
  return (
    <Card className={cn('flex h-full min-h-0 flex-col overflow-hidden border-border/50 shadow-none', className)}>
      {(title || (canEdit && onRemove)) && (
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-3 py-2">
          <CardTitle className="truncate text-sm font-medium text-text-heading">
            {title || ''}
          </CardTitle>
          {canEdit && onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-md p-1 text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-status-error group-hover/widget:opacity-100 focus-visible:opacity-100"
              aria-label="Remove widget"
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-0 text-sm">{children}</CardContent>
    </Card>
  )
}

function MetricWidget({ widget }: { widget: ProjectCanvasWidget }) {
  const cfg = widget.config
  const value = String(cfg.value ?? '—')
  const label = String(cfg.label ?? widget.title ?? '')
  const hint = String(cfg.hint ?? '')
  const trend = String(cfg.trend ?? '')
  return (
    <WidgetShell title={widget.title}>
      <div className="flex h-full flex-col justify-center gap-1 py-2">
        <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-text-heading">{value}</p>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          {trend ? <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{trend}</Badge> : null}
          {hint ? <span className="truncate">{hint}</span> : null}
        </div>
      </div>
    </WidgetShell>
  )
}

function StatusWidget({ widget }: { widget: ProjectCanvasWidget }) {
  const cfg = widget.config
  const level = String(cfg.level ?? 'unknown')
  const label = String(cfg.label ?? widget.title ?? 'Status')
  const detail = String(cfg.detail ?? '')
  return (
    <WidgetShell title={widget.title}>
      <div className={cn('mt-1 flex h-[calc(100%-0.25rem)] flex-col justify-center gap-2 rounded-lg border px-3 py-3', statusTone(level))}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <StatusIcon level={level} />
          {label}
        </div>
        {detail ? <p className="text-[12px] leading-relaxed opacity-90">{detail}</p> : null}
      </div>
    </WidgetShell>
  )
}

function QueueSummaryWidget({ widget, t }: { widget: ProjectCanvasWidget; t: (k: string, o?: object) => string }) {
  const data = asRecord(widget.data)
  const byStatus = asRecord(data.by_status)
  const open = Number(data.open ?? 0)
  const total = Number(data.total ?? 0)
  const entries = Object.entries(byStatus).slice(0, 6)
  return (
    <WidgetShell title={widget.title || t('projects.canvas.widgets.queue')}>
      <div className="flex h-full flex-col gap-3 py-1">
        <div className="flex items-end gap-3">
          <div>
            <p className="text-[11px] text-text-muted">{t('projects.canvas.openItems')}</p>
            <p className="text-2xl font-semibold tabular-nums text-text-heading">{open}</p>
          </div>
          <p className="pb-1 text-[11px] text-text-muted">{t('projects.canvas.ofTotal', { total })}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entries.length === 0 ? (
            <span className="text-[12px] text-text-muted">{t('projects.canvas.queueEmpty')}</span>
          ) : (
            entries.map(([status, count]) => (
              <Badge key={status} variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                {status}: {String(count)}
              </Badge>
            ))
          )}
        </div>
      </div>
    </WidgetShell>
  )
}

function QueueListWidget({
  widget,
  projectId,
  t,
}: {
  widget: ProjectCanvasWidget
  projectId: string
  t: (k: string, o?: object) => string
}) {
  const data = asRecord(widget.data)
  const items = Array.isArray(data.items) ? data.items : []
  return (
    <WidgetShell title={widget.title || t('projects.canvas.widgets.queueList')}>
      {items.length === 0 ? (
        <p className="py-4 text-[12px] text-text-muted">{t('projects.canvas.queueEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {items.map((raw) => {
            const item = asRecord(raw)
            const id = String(item.id ?? '')
            return (
              <li key={id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-text-primary">{String(item.title ?? '')}</p>
                  <p className="text-[11px] text-text-muted">
                    {String(item.kind ?? '')} · {String(item.status ?? '')}
                  </p>
                </div>
                <Link
                  to={`/projects/${projectId}?tab=queue`}
                  className="shrink-0 text-[11px] font-medium text-accent hover:underline"
                >
                  {t('projects.canvas.open')}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

function ResourcesWidget({ widget, t }: { widget: ProjectCanvasWidget; t: (k: string) => string }) {
  const data = asRecord(widget.data)
  const items = Array.isArray(data.items) ? data.items : []
  return (
    <WidgetShell title={widget.title || t('projects.canvas.widgets.resources')}>
      {items.length === 0 ? (
        <p className="py-4 text-[12px] text-text-muted">{t('projects.canvas.resourcesEmpty')}</p>
      ) : (
        <ul className="space-y-2 py-1">
          {items.slice(0, 8).map((raw) => {
            const item = asRecord(raw)
            return (
              <li key={String(item.id)} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-text-primary">{String(item.label || item.resource_type)}</span>
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                  {String(item.resource_type ?? '')}
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetShell>
  )
}

function BudgetWidget({
  widget,
  t,
  locale,
}: {
  widget: ProjectCanvasWidget
  t: (k: string) => string
  locale: string
}) {
  const data = asRecord(widget.data)
  const used = Number(data.token_used_today ?? 0)
  const budget = Number(data.token_budget_daily ?? 0)
  const remaining = Number(data.remaining_today ?? Math.max(0, budget - used))
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0
  return (
    <WidgetShell title={widget.title || t('projects.canvas.widgets.budget')}>
      <div className="flex h-full flex-col justify-center gap-2 py-1">
        <div className="flex items-center gap-2 text-text-muted">
          <Wallet size={14} />
          <span className="text-[11px]">{t('projects.canvas.tokensToday')}</span>
        </div>
        <p className="text-xl font-semibold tabular-nums text-text-heading">
          {formatAppNumber(used, locale)}
          <span className="text-sm font-normal text-text-muted">
            {' / '}
            {formatAppNumber(budget, locale)}
          </span>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-input">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-text-muted">
          {t('projects.canvas.remaining')}: {formatAppNumber(remaining, locale)}
        </p>
      </div>
    </WidgetShell>
  )
}

function LinksWidget({ widget }: { widget: ProjectCanvasWidget }) {
  const items = Array.isArray(widget.config.items) ? widget.config.items : []
  return (
    <WidgetShell title={widget.title}>
      <ul className="space-y-1.5 py-1">
        {items.map((raw, idx) => {
          const item = asRecord(raw)
          const href = String(item.url || item.href || '')
          const label = String(item.label || href || `Link ${idx + 1}`)
          if (!href) return null
          return (
            <li key={`${href}-${idx}`}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
              >
                <span className="truncate">{label}</span>
                <ExternalLink size={11} className="shrink-0 opacity-70" />
              </a>
            </li>
          )
        })}
      </ul>
    </WidgetShell>
  )
}

function TableWidget({ widget }: { widget: ProjectCanvasWidget }) {
  const columns = Array.isArray(widget.config.columns)
    ? widget.config.columns.map(String)
    : []
  const rows = Array.isArray(widget.config.rows) ? widget.config.rows : []
  return (
    <WidgetShell title={widget.title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[240px] text-left text-[12px]">
          {columns.length > 0 ? (
            <thead>
              <tr className="border-b border-border/50 text-text-muted">
                {columns.map((col) => (
                  <th key={col} className="px-1.5 py-1 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((raw, idx) => {
              const cells = Array.isArray(raw) ? raw : Object.values(asRecord(raw))
              return (
                <tr key={idx} className="border-b border-border/30 last:border-0">
                  {cells.map((cell, cidx) => (
                    <td key={cidx} className="px-1.5 py-1.5 text-text-primary">
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  )
}

function ChartWidget({ widget }: { widget: ProjectCanvasWidget }) {
  const series = Array.isArray(widget.config.series) ? widget.config.series : []
  const values = series
    .map((raw) => {
      const item = asRecord(raw)
      return {
        label: String(item.label ?? item.name ?? ''),
        value: Number(item.value ?? 0),
      }
    })
    .filter((s) => Number.isFinite(s.value))
  const max = Math.max(1, ...values.map((v) => v.value))
  return (
    <WidgetShell title={widget.title}>
      <div className="flex h-full items-end gap-1.5 py-2">
        {values.length === 0 ? (
          <p className="text-[12px] text-text-muted">—</p>
        ) : (
          values.map((item, idx) => (
            <div key={`${item.label}-${idx}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                className="w-full max-w-[36px] rounded-t-sm bg-accent/80"
                style={{ height: `${Math.max(8, Math.round((item.value / max) * 88))}px` }}
                title={`${item.label}: ${item.value}`}
              />
              <span className="w-full truncate text-center text-[10px] text-text-muted">{item.label}</span>
            </div>
          ))
        )}
      </div>
    </WidgetShell>
  )
}

function IframeWidget({ widget, t }: { widget: ProjectCanvasWidget; t: (k: string) => string }) {
  const url = String(widget.config.url ?? '')
  return (
    <WidgetShell title={widget.title}>
      {!url ? (
        <p className="py-4 text-[12px] text-text-muted">{t('projects.canvas.iframeEmpty')}</p>
      ) : (
        <iframe
          title={widget.title || 'Embed'}
          src={url}
          className="h-full min-h-[140px] w-full rounded-md border border-border/40 bg-bg-surface"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="no-referrer"
        />
      )}
    </WidgetShell>
  )
}

function MarkdownWidget({ widget }: { widget: ProjectCanvasWidget }) {
  const markdown = String(widget.config.markdown ?? '')
  return (
    <WidgetShell title={widget.title}>
      <div className="prose-sm max-w-none py-1 text-[13px] leading-relaxed text-text-primary">
        <ChatMarkdown content={markdown || '_Empty_'} />
      </div>
    </WidgetShell>
  )
}

function WithRemove({
  canEdit,
  onRemove,
  children,
}: {
  canEdit: boolean
  onRemove?: () => void
  children: ReactNode
}) {
  return (
    <div className="group/widget relative h-full">
      {canEdit && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-2 top-2 z-10 rounded-md border border-border/50 bg-bg-surface/90 p-1 text-text-muted opacity-0 shadow-sm transition-opacity hover:text-status-error group-hover/widget:opacity-100 focus-visible:opacity-100"
          aria-label="Remove widget"
        >
          <Trash2 size={12} />
        </button>
      ) : null}
      {children}
    </div>
  )
}

function renderWidget(
  widget: ProjectCanvasWidget,
  ctx: {
    projectId: string
    canEdit: boolean
    onRemove: (id: string) => void
    t: (k: string, o?: object) => string
    locale: string
  },
) {
  const remove = ctx.canEdit ? () => ctx.onRemove(widget.id) : undefined
  const type = widget.type
  if (type === 'spacer') {
    return <div className="h-full" aria-hidden />
  }
  const body =
    type === 'markdown' ? (
      <MarkdownWidget widget={widget} />
    ) : type === 'metric' ? (
      <MetricWidget widget={widget} />
    ) : type === 'status' ? (
      <StatusWidget widget={widget} />
    ) : type === 'queue_summary' ? (
      <QueueSummaryWidget widget={widget} t={ctx.t} />
    ) : type === 'queue_list' ? (
      <QueueListWidget widget={widget} projectId={ctx.projectId} t={ctx.t} />
    ) : type === 'resources' ? (
      <ResourcesWidget widget={widget} t={ctx.t} />
    ) : type === 'budget' ? (
      <BudgetWidget widget={widget} t={ctx.t} locale={ctx.locale} />
    ) : type === 'links' ? (
      <LinksWidget widget={widget} />
    ) : type === 'table' ? (
      <TableWidget widget={widget} />
    ) : type === 'chart' ? (
      <ChartWidget widget={widget} />
    ) : type === 'iframe' ? (
      <IframeWidget widget={widget} t={ctx.t} />
    ) : (
      <WidgetShell title={widget.title || type}>
        <p className="py-3 text-[12px] text-text-muted">
          {ctx.t('projects.canvas.unknownWidget', { type })}
        </p>
      </WidgetShell>
    )
  return (
    <WithRemove canEdit={ctx.canEdit} onRemove={remove}>
      {body}
    </WithRemove>
  )
}

export function ProjectCanvasBoard({ projectId, canEdit }: Props) {
  const { t, i18n } = useTranslation('nav')
  const [canvas, setCanvas] = useState<ProjectCanvas | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [metricLabel, setMetricLabel] = useState('')
  const [metricValue, setMetricValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const row = await getProjectCanvas(projectId, 'main', true)
      setCanvas(row)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.canvas.loadError')))
      setCanvas(null)
    } finally {
      setLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  const gridStyle = useMemo(() => {
    const columns = canvas?.layout.columns ?? 12
    const rowHeight = canvas?.layout.row_height ?? 56
    const gap = canvas?.layout.gap ?? 12
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gridAutoRows: `${rowHeight}px`,
      gap: `${gap}px`,
    } as const
  }, [canvas?.layout])

  const onRemove = async (widgetId: string) => {
    if (!canvas || !canEdit) return
    setBusy(true)
    try {
      const next = await patchProjectCanvas(projectId, canvas.slug, {
        remove_ids: [widgetId],
        expected_revision: canvas.revision,
        notes: `Removed widget ${widgetId}`,
      })
      setCanvas(next)
      toast.success(t('projects.canvas.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.canvas.saveError')))
      void load()
    } finally {
      setBusy(false)
    }
  }

  const onReset = async () => {
    if (!canvas || !canEdit) return
    if (!window.confirm(t('projects.canvas.resetConfirm'))) return
    setBusy(true)
    try {
      const next = await putProjectCanvas(projectId, canvas.slug, {
        reset_to_default: true,
        expected_revision: canvas.revision,
      })
      setCanvas(next)
      toast.success(t('projects.canvas.resetDone'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.canvas.saveError')))
      void load()
    } finally {
      setBusy(false)
    }
  }

  const onAddMetric = async () => {
    if (!canvas || !canEdit) return
    const label = metricLabel.trim()
    const value = metricValue.trim()
    if (!label || !value) return
    setBusy(true)
    try {
      const maxY = canvas.widgets.reduce((acc, w) => Math.max(acc, w.y + w.h), 0)
      const next = await patchProjectCanvas(projectId, canvas.slug, {
        expected_revision: canvas.revision,
        notes: `Added metric ${label}`,
        upsert: [
          {
            id: `metric-${Date.now().toString(36)}`,
            type: 'metric',
            title: label,
            x: 0,
            y: maxY,
            w: 4,
            h: 2,
            config: { label, value },
          },
        ],
      })
      setCanvas(next)
      setMetricLabel('')
      setMetricValue('')
      setAdding(false)
      toast.success(t('projects.canvas.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.canvas.saveError')))
      void load()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !canvas) {
    return <ProjectCanvasSkeleton />
  }

  if (error && !canvas) {
    return <ApiErrorBanner error={error} onRetry={() => void load()} />
  }

  if (!canvas) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/50 bg-gradient-to-br from-bg-surface via-bg-surface to-accent/[0.04] px-3 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-text-heading">
            <LayoutDashboard size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{canvas.title || t('projects.detail.tabCanvas')}</h2>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              r{canvas.revision}
            </Badge>
          </div>
          <p className="max-w-2xl text-[12px] text-text-muted">{t('projects.canvas.subtitle')}</p>
          {canvas.notes ? (
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Sparkles size={11} className="text-ai" />
              {canvas.notes}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={13} className={cn('mr-1', busy && 'animate-spin')} />
            {t('projects.page.refresh')}
          </Button>
          {canEdit ? (
            <>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setAdding((v) => !v)}>
                <Plus size={13} className="mr-1" />
                {t('projects.canvas.addMetric')}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onReset()}>
                <RotateCcw size={13} className="mr-1" />
                {t('projects.canvas.reset')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {adding && canEdit ? (
        <Card className="border-border/50 shadow-none">
          <CardContent className="grid gap-3 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs text-text-muted">{t('projects.canvas.metricLabel')}</Label>
              <Input value={metricLabel} onChange={(e) => setMetricLabel(e.target.value)} placeholder="Open bugs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-text-muted">{t('projects.canvas.metricValue')}</Label>
              <Input value={metricValue} onChange={(e) => setMetricValue(e.target.value)} placeholder="12" />
            </div>
            <Button type="button" size="sm" disabled={busy || !metricLabel.trim() || !metricValue.trim()} onClick={() => void onAddMetric()}>
              <BarChart3 size={13} className="mr-1" />
              {t('projects.canvas.add')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <Activity size={12} />
        {t('projects.canvas.aiHint')}
      </div>

      <div style={gridStyle} className="min-h-[200px]">
        {canvas.widgets.map((widget) => (
          <div
            key={widget.id}
            style={{
              gridColumn: `${widget.x + 1} / span ${widget.w}`,
              gridRow: `${widget.y + 1} / span ${widget.h}`,
            }}
            className="min-h-0 min-w-0"
          >
            {renderWidget(widget, {
              projectId,
              canEdit,
              onRemove,
              t: t as (k: string, o?: object) => string,
              locale: i18n.language,
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
