import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import TriggerDialog, { type TargetOption } from '../components/agenda/TriggerDialog'
import AutomationsPanel from '../components/agenda/AutomationsPanel'
import { useAuth } from '../context/AuthContext'
import { listAgents } from '../lib/agents-api'
import {
  listAgendaOccurrences,
  listTriggers,
  listWorkstreams,
  type AgendaItem,
  type Trigger,
} from '../lib/orchestration-api'
import { cn } from '../lib/utils'

type ViewTab = 'week' | 'list' | 'automations'

const KIND_LABELS: Record<string, string> = {
  once: 'Task',
  event: 'Event',
  cron: 'Cron',
  interval: 'Interval',
  heartbeat: 'Heartbeat',
  webhook: 'Webhook',
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** Monday-based start of week. */
function startOfWeek(d: Date): Date {
  const out = startOfDay(d)
  const day = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - day)
  return out
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseAt(iso: string): Date {
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function statusStyle(status: string): string {
  const s = status.toLowerCase()
  if (s === 'planned') return 'border-border/70 bg-bg-elevated text-text'
  if (s === 'running' || s === 'active') return 'border-accent/40 bg-accent/10 text-accent'
  if (s === 'failed' || s === 'error') return 'border-status-error/40 bg-status-error/10 text-status-error'
  return 'border-status-success/40 bg-status-success/10 text-status-success'
}

function AgendaChip({
  item,
  onClick,
  showDate,
}: {
  item: AgendaItem
  onClick?: () => void
  showDate?: boolean
}) {
  const at = parseAt(item.at)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
        statusStyle(item.status),
        onClick ? 'hover:border-accent/60' : 'cursor-default',
        !item.enabled && item.status === 'planned' ? 'opacity-50' : '',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">
          {showDate ? `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ` : ''}
          {formatTime(at)}
        </span>
        <span className="rounded border border-current/30 px-1 py-px text-[9px] uppercase tracking-wide opacity-80">
          {KIND_LABELS[item.kind] ?? item.kind}
        </span>
      </div>
      <p className="mt-0.5 truncate font-medium">{item.name}</p>
      {item.agent_name ? <p className="truncate opacity-75">{item.agent_name}</p> : null}
      {item.status !== 'planned' ? (
        <p className="mt-0.5 text-[10px] uppercase tracking-wide opacity-75">{item.status}</p>
      ) : null}
    </button>
  )
}

export default function AgendaPage() {
  const { token } = useAuth()
  const [searchParams] = useSearchParams()
  const [view, setView] = useState<ViewTab>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [agentFilter, setAgentFilter] = useState(() => searchParams.get('agent') ?? 'all')
  const [kindFilter, setKindFilter] = useState('all')
  const [items, setItems] = useState<AgendaItem[]>([])
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [agents, setAgents] = useState<TargetOption[]>([])
  const [workstreams, setWorkstreams] = useState<TargetOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null)
  const [initialRunAt, setInitialRunAt] = useState<Date | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])

  const window = useMemo(() => {
    if (view === 'week') return { from: weekStart, to: addDays(weekStart, 7) }
    return { from: addDays(startOfDay(new Date()), -1), to: addDays(startOfDay(new Date()), 21) }
  }, [view, weekStart])

  const load = useCallback(async () => {
    if (!token) return
    if (view === 'automations') {
      // AutomationsPanel loads itself; still bump reloadKey so Refresh works.
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [occurrences, triggerRows] = await Promise.all([
        listAgendaOccurrences({
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          agentId: agentFilter !== 'all' ? agentFilter : undefined,
        }),
        listTriggers(),
      ])
      setItems(occurrences)
      setTriggers(triggerRows)
    } catch (err) {
      setError(formatApiErrorMessage(err, 'Could not load the agenda.'))
    } finally {
      setLoading(false)
    }
  }, [token, view, window, agentFilter])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!token) return
    void (async () => {
      try {
        const [agentRows, wsRes] = await Promise.all([
          listAgents().catch(() => []),
          listWorkstreams().catch(() => []),
        ])
        setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })))
        setWorkstreams((Array.isArray(wsRes) ? wsRes : []).map((w) => ({ id: w.id, name: w.name })))
      } catch {
        // target pickers stay empty; dialog still works without a target
      }
    })()
  }, [token])

  const filtered = useMemo(() => {
    let out = items
    if (kindFilter !== 'all') out = out.filter((i) => i.kind === kindFilter)
    return [...out].sort((a, b) => parseAt(a.at).getTime() - parseAt(b.at).getTime())
  }, [items, kindFilter])

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const item of filtered) {
      const key = dayKey(parseAt(item.at))
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return map
  }, [filtered])

  const openCreate = (at?: Date) => {
    setEditingTrigger(null)
    setInitialRunAt(at ?? null)
    setDialogOpen(true)
  }

  const openEdit = (item: AgendaItem) => {
    if (!item.trigger_id) return
    const trigger = triggers.find((t) => t.id === item.trigger_id)
    if (!trigger) {
      setError('Could not load that schedule for editing. Refresh and try again.')
      return
    }
    setEditingTrigger(trigger)
    setInitialRunAt(null)
    setDialogOpen(true)
  }

  const onSaved = () => setReloadKey((k) => k + 1)

  const todayKey = dayKey(new Date())
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`

  return (
    <PageContent width="xl" className="space-y-4">
      <ContentHeader
        title="Agenda"
        subtitle="Scheduled agent wakes, one-off tasks, and events."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (view === 'automations') setReloadKey((k) => k + 1)
                else void load()
              }}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            </Button>
            <Button type="button" size="sm" onClick={() => openCreate()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              New
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as ViewTab)}>
          <TabsList>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="automations">Automations</TabsTrigger>
          </TabsList>
        </Tabs>

        {view !== 'automations' ? (
          <div className="flex flex-wrap items-center gap-2">
            {view === 'week' ? (
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w - 1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-w-[9rem]"
                  onClick={() => setWeekOffset(0)}
                >
                  {weekOffset === 0 ? 'This week' : weekLabel}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setWeekOffset((w) => w + 1)}>
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ) : null}
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {view === 'automations' ? (
        <AutomationsPanel
          reloadKey={reloadKey}
          onEditTrigger={(trigger) => {
            setEditingTrigger(trigger)
            setInitialRunAt(null)
            setDialogOpen(true)
          }}
        />
      ) : error ? (
        <ApiErrorBanner message={error} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingBlock label="Loading agenda..." />
      ) : view === 'week' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {weekDays.map((day) => {
            const key = dayKey(day)
            const dayItems = byDay.get(key) ?? []
            const isToday = key === todayKey
            return (
              <div
                key={key}
                className={cn(
                  'flex min-h-[10rem] flex-col gap-1.5 rounded-xl border p-2',
                  isToday ? 'border-accent/50 bg-accent/[0.04]' : 'border-border/70 bg-bg-surface',
                )}
              >
                <button
                  type="button"
                  className="flex items-baseline justify-between rounded px-1 text-left hover:text-accent"
                  onClick={() => openCreate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0))}
                  title="Schedule something on this day"
                >
                  <span className={cn('text-xs font-medium', isToday ? 'text-accent' : 'text-text-muted')}>
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span className={cn('text-sm font-semibold', isToday ? 'text-accent' : 'text-text-heading')}>
                    {day.getDate()}
                  </span>
                </button>
                {dayItems.length === 0 ? (
                  <p className="px-1 text-[11px] text-text-muted/60">—</p>
                ) : (
                  dayItems.map((item) => (
                    <AgendaChip
                      key={item.id}
                      item={item}
                      onClick={item.trigger_id ? () => openEdit(item) : undefined}
                    />
                  ))
                )}
              </div>
            )
          })}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 p-10 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-text-muted/50" aria-hidden />
          <p className="mt-3 text-sm font-medium text-text-heading">Nothing scheduled</p>
          <p className="mt-1 text-sm text-text-muted">
            Schedule an agent wake, a one-off task, or an event with New.
          </p>
          <Button type="button" size="sm" className="mt-4" onClick={() => openCreate()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            New
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {[...byDay.entries()].map(([key, dayItems]) => {
            const day = parseAt(`${key}T12:00:00`)
            const isToday = key === todayKey
            return (
              <section key={key}>
                <h2 className={cn('mb-2 text-sm font-semibold', isToday ? 'text-accent' : 'text-text-heading')}>
                  {isToday
                    ? 'Today'
                    : day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                </h2>
                <div className="space-y-1.5">
                  {dayItems.map((item) => {
                    const at = parseAt(item.at)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!item.trigger_id}
                        onClick={item.trigger_id ? () => openEdit(item) : undefined}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border border-border/70 bg-bg-surface px-3 py-2 text-left text-sm transition-colors',
                          item.trigger_id ? 'hover:border-accent/60' : 'cursor-default',
                          !item.enabled && item.status === 'planned' ? 'opacity-50' : '',
                        )}
                      >
                        <span className="w-12 shrink-0 font-medium tabular-nums text-text-heading">
                          {formatTime(at)}
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {KIND_LABELS[item.kind] ?? item.kind}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate font-medium text-text-heading">{item.name}</span>
                        {item.agent_name ? (
                          <span className="hidden shrink-0 text-xs text-text-muted sm:inline">{item.agent_name}</span>
                        ) : null}
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                            statusStyle(item.status),
                          )}
                        >
                          {item.status}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <TriggerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trigger={editingTrigger}
        agents={agents}
        workstreams={workstreams}
        initialRunAt={initialRunAt}
        onSaved={onSaved}
      />
    </PageContent>
  )
}
