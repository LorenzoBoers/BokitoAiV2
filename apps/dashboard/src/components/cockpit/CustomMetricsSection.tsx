import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  Bot,
  History,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  addMetricPoint,
  createCustomMetric,
  deleteCustomMetric,
  formatMetricValue,
  listCustomMetrics,
  listMetricPoints,
  listMetricSources,
  updateCustomMetric,
  type CustomMetricRow,
  type MetricPointRow,
  type MetricSourceOption,
  type MetricUnit,
} from '../../lib/metrics-api'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

const UNIT_OPTIONS: { id: MetricUnit; label: string }[] = [
  { id: 'number', label: 'Number' },
  { id: 'count', label: 'Count' },
  { id: 'percent', label: 'Percent' },
  { id: 'currency', label: 'Currency (EUR)' },
  { id: 'duration', label: 'Duration (minutes)' },
]

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function MetricCard({
  metric,
  onEdit,
}: {
  metric: CustomMetricRow
  onEdit: (metric: CustomMetricRow) => void
}) {
  const deltaUp = metric.delta !== null && metric.delta > 0
  const deltaDown = metric.delta !== null && metric.delta < 0
  return (
    <button
      type="button"
      onClick={() => onEdit(metric)}
      className="group flex h-full flex-col rounded-xl border border-border/60 bg-bg-surface px-4 py-3.5 text-left shadow-card transition-colors hover:border-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
          {metric.label}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          {metric.source !== 'manual' ? (
            <Sparkles size={12} className="text-accent/70" aria-label="Computed from platform data" />
          ) : metric.latest_source === 'agent' ? (
            <Bot size={12} className="text-accent/70" aria-label="Last value recorded by an agent" />
          ) : null}
          <Pencil size={11} className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-none text-text-heading">
        {formatMetricValue(metric.latest_value, metric.unit)}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted">
        {metric.delta !== null && metric.delta !== 0 ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              deltaUp && 'text-status-success',
              deltaDown && 'text-status-error',
            )}
          >
            {deltaUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {formatMetricValue(Math.abs(metric.delta), metric.unit)}
          </span>
        ) : null}
        {metric.target !== null ? (
          <span className="inline-flex items-center gap-0.5">
            <Target size={10} />
            {formatMetricValue(metric.target, metric.unit)}
          </span>
        ) : null}
        {metric.latest_at ? <span>{timeAgo(metric.latest_at)}</span> : <span>No data yet</span>}
      </p>
    </button>
  )
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; metric: CustomMetricRow }
  | null

/**
 * Tenant-defined KPI cards on the Cockpit. Values come from users (via the
 * dialog) or agents (via the `record_metric` tool); the newest point wins.
 */
export default function CustomMetricsSection() {
  const [metrics, setMetrics] = useState<CustomMetricRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, setBusy] = useState(false)

  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState<MetricUnit>('number')
  const [target, setTarget] = useState('')
  const [newValue, setNewValue] = useState('')
  const [valueNote, setValueNote] = useState('')
  const [source, setSource] = useState('manual')
  const [sourceOptions, setSourceOptions] = useState<MetricSourceOption[]>([])
  const [history, setHistory] = useState<MetricPointRow[] | null>(null)

  const load = useCallback(() => {
    listCustomMetrics()
      .then(setMetrics)
      .catch(() => setMetrics([]))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
    listMetricSources()
      .then(setSourceOptions)
      .catch(() => setSourceOptions([]))
  }, [load])

  const openCreate = () => {
    setLabel('')
    setUnit('number')
    setTarget('')
    setNewValue('')
    setValueNote('')
    setSource('manual')
    setHistory(null)
    setDialog({ mode: 'create' })
  }

  const openEdit = (metric: CustomMetricRow) => {
    setLabel(metric.label)
    setUnit(metric.unit)
    setTarget(metric.target !== null ? String(metric.target) : '')
    setNewValue('')
    setValueNote('')
    setSource(metric.source || 'manual')
    setHistory(null)
    setDialog({ mode: 'edit', metric })
    listMetricPoints(metric.id)
      .then((points) => setHistory(points.slice(0, 8)))
      .catch(() => setHistory([]))
  }

  const parsedTarget = useMemo(() => {
    const trimmed = target.trim().replace(',', '.')
    if (!trimmed) return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
  }, [target])

  const parsedValue = useMemo(() => {
    const trimmed = newValue.trim().replace(',', '.')
    if (!trimmed) return null
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : null
  }, [newValue])

  async function submit() {
    if (!dialog || busy) return
    if (!label.trim()) {
      toast.error('Give the metric a name.')
      return
    }
    const isPlatform = source !== 'manual'
    setBusy(true)
    try {
      if (dialog.mode === 'create') {
        const created = await createCustomMetric({
          label: label.trim(),
          unit,
          target: parsedTarget,
          source,
        })
        if (!isPlatform && parsedValue !== null) {
          await addMetricPoint(created.id, { value: parsedValue, note: valueNote.trim() })
        }
        toast.success('Metric added.')
      } else {
        await updateCustomMetric(dialog.metric.id, {
          label: label.trim(),
          unit,
          target: parsedTarget,
          source,
        })
        if (!isPlatform && parsedValue !== null) {
          await addMetricPoint(dialog.metric.id, { value: parsedValue, note: valueNote.trim() })
        }
        toast.success('Metric updated.')
      }
      setDialog(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save metric.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!dialog || dialog.mode !== 'edit' || busy) return
    setBusy(true)
    try {
      await deleteCustomMetric(dialog.metric.id)
      toast.success('Metric removed.')
      setDialog(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove metric.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-text-muted" />
          <h2 className="text-[13px] font-semibold text-text-heading">Your metrics</h2>
          <span className="text-[11px] text-text-muted">
            Filled by you or your agents
          </span>
        </div>
        <Button type="button" size="sm" variant="ghost" className="text-text-secondary" onClick={openCreate}>
          <Plus size={13} className="mr-1" />
          Add metric
        </Button>
      </div>
      {metrics.length === 0 ? (
        <button
          type="button"
          onClick={openCreate}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-5 text-[12px] text-text-muted transition-colors hover:border-accent/40 hover:text-text-secondary"
        >
          <Plus size={13} />
          Track a business KPI (revenue, open tickets, response time, ...) — agents can update it with record_metric
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          {metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} onEdit={openEdit} />
          ))}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? 'Edit metric' : 'New metric'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="metric-label">Name</Label>
              <Input
                id="metric-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Monthly recurring revenue"
              />
            </div>
            {sourceOptions.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="metric-source">Data source</Label>
                <select
                  id="metric-source"
                  value={source}
                  onChange={(e) => {
                    const next = e.target.value
                    setSource(next)
                    const option = sourceOptions.find((s) => s.id === next)
                    if (option) setUnit(option.unit)
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-bg-surface px-2.5 text-sm text-text-primary outline-none focus:border-accent/60"
                >
                  <option value="manual">Manual / agent fill</option>
                  {sourceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} (platform)
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="metric-unit">Unit</Label>
                <select
                  id="metric-unit"
                  value={unit}
                  disabled={source !== 'manual'}
                  onChange={(e) => setUnit(e.target.value as MetricUnit)}
                  className="h-9 w-full rounded-lg border border-border bg-bg-surface px-2.5 text-sm text-text-primary outline-none focus:border-accent/60 disabled:opacity-60"
                >
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="metric-target">Target (optional)</Label>
                <Input
                  id="metric-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. 10000"
                  inputMode="decimal"
                />
              </div>
            </div>
            {source === 'manual' ? (
              <div className="rounded-lg border border-border/60 bg-bg-elevated/50 p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  {dialog?.mode === 'edit' ? 'Record a new value' : 'Starting value (optional)'}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="Value"
                    inputMode="decimal"
                  />
                  <Input
                    value={valueNote}
                    onChange={(e) => setValueNote(e.target.value)}
                    placeholder="Note (optional)"
                  />
                </div>
                {dialog?.mode === 'edit' && dialog.metric.latest_value !== null ? (
                  <p className="mt-2 text-[11px] text-text-muted">
                    Current: {formatMetricValue(dialog.metric.latest_value, dialog.metric.unit)}
                    {dialog.metric.latest_at ? ` (${timeAgo(dialog.metric.latest_at)})` : ''}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg border border-border/60 bg-bg-elevated/50 p-3 text-[11px] text-text-muted">
                This value is computed from platform data and snapshotted daily, so
                history builds automatically. Manual and agent fills are disabled.
              </p>
            )}
            {dialog?.mode === 'edit' && history !== null && history.length > 0 ? (
              <div className="rounded-lg border border-border/60 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  <History size={11} />
                  Recent values
                </p>
                <ul className="mt-2 space-y-1">
                  {history.map((point) => (
                    <li key={point.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-medium text-text-primary">
                        {formatMetricValue(point.value, unit)}
                      </span>
                      <span className="truncate text-text-muted">{point.note}</span>
                      <span className="shrink-0 text-[11px] text-text-muted">
                        {timeAgo(point.recorded_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {source === 'manual' ? (
              <p className="text-[11px] text-text-muted">
                Agents can update this metric automatically with the record_metric tool
                {dialog?.mode === 'edit' ? ` using key "${dialog.metric.key}"` : ''}.
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            {dialog?.mode === 'edit' ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                className="text-status-error hover:text-status-error"
                onClick={() => void remove()}
              >
                <Trash2 size={13} className="mr-1" />
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
