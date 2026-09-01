import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import TriggerDialog, { type TargetOption } from '../components/agenda/TriggerDialog'
import AutomationsPanel from '../components/agenda/AutomationsPanel'
import { CalendarConnectBar } from '../components/agenda/CalendarConnectBar'
import CalendarEventDialog, {
  type CalendarEventEditSeed,
} from '../components/agenda/CalendarEventDialog'
import CalendarEventDetailDialog from '../components/agenda/CalendarEventDetailDialog'
import { useAuth } from '../context/AuthContext'
import { listAgents } from '../lib/agents-api'
import {
  listCalendarConnections,
  type CalendarConnection,
} from '../lib/calendars-api'
import {
  listAgendaOccurrences,
  listTriggers,
  listWorkstreams,
  type AgendaItem,
  type Trigger,
} from '../lib/orchestration-api'
import { formatAppDate, formatAppTime } from '../lib/app-locale'
import { clampWeekOffset, parseWeekOffset, weekOffsetParam } from '../lib/agenda-week'
import { Input } from '../components/ui/input'
import { agentRunsPath, inboxPath } from '../lib/messages-paths'
import { resolveAgendaAgentId, resolveAgendaAgentName } from '../lib/agenda-label'
import { pickClosestThreadBySubject } from '../lib/agenda-thread'
import { translateDecisionText } from '../lib/activity-labels'
import { agendaStatusLabel } from '../lib/status-labels'
import { cn } from '../lib/utils'
import { listThreads } from '../lib/inbox-api'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'

type ViewTab = 'week' | 'list' | 'automations'

function parseAgendaView(raw: string | null): ViewTab {
  if (raw === 'list' || raw === 'automations' || raw === 'week') return raw
  return 'week'
}

const KIND_LABELS: Record<string, string> = {
  once: 'Task',
  event: 'Event',
  cron: 'Recurring',
  interval: 'Repeating',
  heartbeat: 'Check-in',
  webhook: 'Incoming',
  calendar: 'Calendar',
}

type SourceFilter = 'all' | 'wakes' | 'calendar'

function parseSourceFilter(raw: string | null): SourceFilter {
  if (raw === 'wakes' || raw === 'calendar') return raw
  return 'all'
}

function isCalendarItem(item: AgendaItem): boolean {
  return item.kind === 'calendar' || item.source === 'calendar'
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

function formatTime(d: Date, language?: string | null): string {
  return formatAppTime(d, language)
}

function statusStyle(status: string, kind?: string): string {
  if (kind === 'calendar' || status === 'calendar') {
    return 'border-sky-500/35 bg-sky-500/8 text-text-heading'
  }
  const s = status.toLowerCase()
  if (s === 'planned') return 'border-border/60 bg-bg-elevated text-text'
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
  const { t, i18n } = useTranslation('nav')
  const at = parseAt(item.at)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
        statusStyle(item.status, item.kind),
        onClick ? 'hover:border-accent/60' : 'cursor-default',
        !item.enabled && item.status === 'planned' ? 'opacity-50' : '',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">
          {showDate ? `${formatAppDate(at, i18n.language, { day: 'numeric', month: 'short' })} ` : ''}
          {formatTime(at, i18n.language)}
        </span>
        <span className="rounded border border-current/30 px-1 py-px text-[9px] uppercase tracking-wide opacity-80">
          {t(`agendaPage.kinds.${item.kind}`, { defaultValue: KIND_LABELS[item.kind] ?? item.kind })}
        </span>
      </div>
      <p className="mt-0.5 truncate font-medium">{translateDecisionText(item.name, t) || item.name}</p>
      {item.agent_name ? <p className="truncate opacity-75">{item.agent_name}</p> : null}
      {isCalendarItem(item) && item.provider_label ? (
        <p className="truncate opacity-75">{item.provider_label}</p>
      ) : null}
      {item.status !== 'planned' && item.status !== 'calendar' ? (
        <p className="mt-0.5 text-[10px] uppercase tracking-wide opacity-75">{agendaStatusLabel(item.status, t)}</p>
      ) : null}
    </button>
  )
}

export default function AgendaPage() {
  const { t, i18n } = useTranslation('nav')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<ViewTab>(() => parseAgendaView(searchParams.get('view')))
  const [weekOffset, setWeekOffset] = useState(() => parseWeekOffset(searchParams.get('week')))
  const [agentFilter, setAgentFilter] = useState(() => searchParams.get('agent') ?? 'all')
  const [kindFilter, setKindFilter] = useState(() => searchParams.get('kind') ?? 'all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() =>
    parseSourceFilter(searchParams.get('source')),
  )
  const [listQuery, setListQuery] = useState('')
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [items, setItems] = useState<AgendaItem[]>([])
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [agents, setAgents] = useState<TargetOption[]>([])
  const [workstreams, setWorkstreams] = useState<TargetOption[]>([])
  const [calendarConnections, setCalendarConnections] = useState<CalendarConnection[]>([])
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false)
  const [calendarEditEvent, setCalendarEditEvent] = useState<CalendarEventEditSeed | null>(null)
  const [calendarDetailItem, setCalendarDetailItem] = useState<AgendaItem | null>(null)
  const [editingTrigger, setEditingTrigger] = useState<Trigger | null>(null)
  const [initialRunAt, setInitialRunAt] = useState<Date | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const handleViewChange = useCallback(
    (next: ViewTab) => {
      setView(next)
      const params = new URLSearchParams(searchParams)
      if (next === 'week') params.delete('view')
      else params.set('view', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    const fromUrl = parseAgendaView(searchParams.get('view'))
    setView((current) => (current === fromUrl ? current : fromUrl))
    const agentFromUrl = searchParams.get('agent') ?? 'all'
    setAgentFilter((current) => (current === agentFromUrl ? current : agentFromUrl))
    const kindFromUrl = searchParams.get('kind') ?? 'all'
    setKindFilter((current) => (current === kindFromUrl ? current : kindFromUrl))
    const sourceFromUrl = parseSourceFilter(searchParams.get('source'))
    setSourceFilter((current) => (current === sourceFromUrl ? current : sourceFromUrl))
    const weekFromUrl = parseWeekOffset(searchParams.get('week'))
    setWeekOffset((current) => (current === weekFromUrl ? current : weekFromUrl))
  }, [searchParams])

  const applyWeekOffset = useCallback(
    (next: number) => {
      const value = clampWeekOffset(next)
      setWeekOffset(value)
      const params = new URLSearchParams(searchParams)
      const encoded = weekOffsetParam(value)
      if (encoded) params.set('week', encoded)
      else params.delete('week')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const handleAgentFilterChange = (next: string) => {
    setAgentFilter(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('agent')
    else params.set('agent', next)
    setSearchParams(params, { replace: true })
  }

  const handleKindFilterChange = (next: string) => {
    setKindFilter(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('kind')
    else params.set('kind', next)
    setSearchParams(params, { replace: true })
  }

  const handleSourceFilterChange = (next: SourceFilter) => {
    setSourceFilter(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('source')
    else params.set('source', next)
    setSearchParams(params, { replace: true })
  }

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])

  const dateWindow = useMemo(() => {
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
          from: dateWindow.from.toISOString(),
          to: dateWindow.to.toISOString(),
          agentId: agentFilter !== 'all' ? agentFilter : undefined,
        }),
        listTriggers(),
      ])
      setItems(occurrences)
      setTriggers(triggerRows)
      setRefreshedAt(new Date())
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [token, view, dateWindow, agentFilter, t])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    if (view !== 'week') return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        applyWeekOffset(weekOffset - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        applyWeekOffset(weekOffset + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, weekOffset, applyWeekOffset])

  useEffect(() => {
    if (!token) return
    void (async () => {
      setCalendarLoading(true)
      try {
        const rows = await listCalendarConnections()
        setCalendarConnections(rows)
      } catch {
        setCalendarConnections([])
      } finally {
        setCalendarLoading(false)
      }
    })()
  }, [token, reloadKey])

  useEffect(() => {
    if (!token) return
    void (async () => {
      try {
        const [agentRows, wsRes] = await Promise.all([
          listAgents().catch(() => []),
          listWorkstreams().catch(() => []),
        ])
        setAgents(agentRows.map((a) => ({ id: a.id, name: a.name, role_slug: a.role_slug ?? null })))
        setWorkstreams((Array.isArray(wsRes) ? wsRes : []).map((w) => ({ id: w.id, name: w.name })))
      } catch {
        // target pickers stay empty; dialog still works without a target
      }
    })()
  }, [token])

  const filtered = useMemo(() => {
    let out = items
    if (sourceFilter === 'wakes') out = out.filter((i) => !isCalendarItem(i))
    if (sourceFilter === 'calendar') out = out.filter((i) => isCalendarItem(i))
    if (kindFilter !== 'all') out = out.filter((i) => i.kind === kindFilter)
    const q = listQuery.trim().toLowerCase()
    if (q) {
      out = out.filter((i) => {
        const hay = `${i.name} ${i.agent_name ?? ''} ${i.provider_label ?? ''} ${i.kind} ${i.status}`.toLowerCase()
        return hay.includes(q)
      })
    }
    return [...out].sort((a, b) => parseAt(a.at).getTime() - parseAt(b.at).getTime())
  }, [items, kindFilter, sourceFilter, listQuery])

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

  useEffect(() => {
    const triggerId = searchParams.get('trigger')
    if (!triggerId || triggers.length === 0) return
    const trigger = triggers.find((t) => t.id === triggerId)
    if (!trigger) return
    setEditingTrigger(trigger)
    setInitialRunAt(null)
    setDialogOpen(true)
  }, [searchParams, triggers])

  const openItem = (item: AgendaItem) => {
    if (isCalendarItem(item)) {
      setCalendarDetailItem(item)
      return
    }
    void (async () => {
      if (token && item.name.trim()) {
        try {
          const found = await listThreads(token, {
            search: item.name,
            perPage: 8,
          })
          const match = pickClosestThreadBySubject(found.items, item.name, item.at)
          if (match) {
            if (match.folder === 'internal' || match.channel === 'internal') {
              const queue = item.status === 'completed' ? 'results' : 'all'
              navigate(agentRunsPath(queue, String(match.id)))
            } else {
              navigate(inboxPath(match.status === 'pending' ? 'snoozed' : 'open', String(match.id)))
            }
            return
          }
        } catch {
          // Fall through to the technical run log when search is unavailable.
        }
      }
      if (item.run_id && item.agent_id) {
        navigate(agentWorkforceRunUrl(item.agent_id, item.run_id))
        return
      }
      if (item.trigger_id) openEdit(item)
    })()
  }

  const openEdit = (item: AgendaItem) => {
    if (!item.trigger_id) return
    const trigger = triggers.find((t) => t.id === item.trigger_id)
    if (!trigger) {
      setError(t('agendaPage.editLoadError'))
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

  const weekLabel = `${formatAppDate(weekStart, i18n.language, { day: 'numeric', month: 'short' })} – ${formatAppDate(addDays(weekStart, 6), i18n.language, { day: 'numeric', month: 'short' })}`

  return (
    <PageContent width="xl" className="space-y-4">
      <PageGuideBanner page="agenda" />
      <ContentHeader
        title={t('tabs.agenda.title')}
        subtitle={t('tabs.agenda.subtitle')}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {refreshedAt ? (
              <span className="text-[11px] text-text-muted">
                {t('agendaPage.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={t('agendaPage.refresh')}
              onClick={() => {
                if (view === 'automations') setReloadKey((k) => k + 1)
                else {
                  setReloadKey((k) => k + 1)
                  void load()
                }
              }}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
            </Button>
            {calendarConnections.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setCalendarEditEvent(null)
                  setCalendarDialogOpen(true)
                }}
              >
                <CalendarDays className="mr-1.5 h-4 w-4" aria-hidden />
                {t('agendaPage.calendar.newBlock')}
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => openCreate()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('agendaPage.new')}
            </Button>
          </div>
        }
      />

      {view !== 'automations' ? (
        <CalendarConnectBar
          connections={calendarConnections}
          loading={calendarLoading}
          onConnectionsChange={setCalendarConnections}
          onSynced={() => {
            setReloadKey((k) => k + 1)
            void load()
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => handleViewChange(v as ViewTab)}>
          <TabsList>
            <TabsTrigger value="week">{t('agendaPage.week')}</TabsTrigger>
            <TabsTrigger value="list">{t('agendaPage.list')}</TabsTrigger>
            <TabsTrigger value="automations">{t('agendaPage.automations')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {view !== 'automations' ? (
          <div className="flex flex-wrap items-center gap-2">
            {view === 'week' ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('agendaPage.prevWeek')}
                  onClick={() => applyWeekOffset(weekOffset - 1)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
                <span className="min-w-[9rem] px-1 text-center text-xs font-medium text-text-heading">
                  {weekLabel}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('agendaPage.nextWeek')}
                  onClick={() => applyWeekOffset(weekOffset + 1)}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={weekOffset === 0}
                  onClick={() => applyWeekOffset(0)}
                >
                  {t('agendaPage.thisWeek')}
                </Button>
              </div>
            ) : null}
            {view === 'list' ? (
              <Input
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                placeholder={t('agendaPage.listSearch')}
                className="h-8 w-[180px] text-xs"
                aria-label={t('agendaPage.listSearch')}
              />
            ) : null}
            <Select value={sourceFilter} onValueChange={(v) => handleSourceFilterChange(v as SourceFilter)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder={t('agendaPage.allSources')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('agendaPage.allSources')}</SelectItem>
                <SelectItem value="wakes">{t('agendaPage.sourceWakes')}</SelectItem>
                <SelectItem value="calendar">{t('agendaPage.sourceCalendar')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={handleAgentFilterChange}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t('agendaPage.allAgents')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('agendaPage.allAgents')}</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceFilter !== 'calendar' ? (
              <Select value={kindFilter} onValueChange={handleKindFilterChange}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue placeholder={t('agendaPage.allTypes')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('agendaPage.allTypes')}</SelectItem>
                  {Object.keys(KIND_LABELS)
                    .filter((value) => value !== 'calendar')
                    .map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`agendaPage.kinds.${value}`, { defaultValue: KIND_LABELS[value] })}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
      </div>

      {view === 'automations' ? (
        <AutomationsPanel
          reloadKey={reloadKey}
          onCreateTrigger={() => {
            setEditingTrigger(null)
            setInitialRunAt(null)
            setDialogOpen(true)
          }}
          onEditTrigger={(trigger) => {
            setEditingTrigger(trigger)
            setInitialRunAt(null)
            setDialogOpen(true)
          }}
        />
      ) : error ? (
        <ApiErrorBanner message={error} onRetry={() => void load()} />
      ) : loading ? (
        <CardGridSkeleton cards={7} className="sm:grid-cols-2 lg:grid-cols-7" />
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
                  isToday ? 'border-accent/50 bg-accent/[0.04]' : 'border-border/60 bg-bg-surface',
                )}
              >
                <button
                  type="button"
                  className="flex items-baseline justify-between rounded px-1 text-left hover:text-accent"
                  onClick={() => openCreate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0))}
                  title={t('agendaPage.scheduleDay')}
                >
                  <span className={cn('text-xs font-medium', isToday ? 'text-accent' : 'text-text-muted')}>
                    {formatAppDate(day, i18n.language, { weekday: 'short' })}
                  </span>
                  <span className="flex items-center gap-1">
                    {isToday ? (
                      <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                        {t('agendaPage.today')}
                      </Badge>
                    ) : null}
                    <span className={cn('text-sm font-semibold', isToday ? 'text-accent' : 'text-text-heading')}>
                      {day.getDate()}
                    </span>
                  </span>
                </button>
                {dayItems.length === 0 ? (
                  <button
                    type="button"
                    className="px-1 text-left text-[11px] font-medium text-accent hover:underline"
                    onClick={() => openCreate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0))}
                  >
                    + {t('agendaPage.scheduleEmptyDay')}
                  </button>
                ) : (
                  dayItems.map((item) => (
                    <AgendaChip
                      key={item.id}
                      item={{
                        ...item,
                        agent_name: resolveAgendaAgentName(item, agents, triggers, items) || item.agent_name,
                      }}
                      onClick={
                        isCalendarItem(item) || item.run_id || item.trigger_id
                          ? () => openItem(item)
                          : undefined
                      }
                    />
                  ))
                )}
              </div>
            )
          })}
        </div>
      ) : filtered.length === 0 && listQuery.trim() ? (
        <p className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-text-muted">
          {t('agendaPage.listFilterEmpty')}
        </p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-10 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-text-muted/50" aria-hidden />
          <p className="mt-3 text-sm font-medium text-text-heading">{t('agendaPage.emptyTitle')}</p>
          <p className="mt-1 text-sm text-text-muted">
            {t('agendaPage.emptyBody')}
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            <Button type="button" size="sm" onClick={() => openCreate()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('agendaPage.createRun')}
            </Button>
            <Link to="/docs/ai/agenda" className="text-xs font-medium text-accent hover:underline">
              {t('pageGuides.learnMore')}
            </Link>
          </div>
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
                    ? t('agendaPage.today')
                    : formatAppDate(day, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
                </h2>
                <div className="space-y-1.5">
                  {dayItems.map((item) => {
                    const at = parseAt(item.at)
                    const agentLabel = resolveAgendaAgentName(item, agents, triggers, items)
                    const agentId = resolveAgendaAgentId(item, triggers, items, agents)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={
                          !isCalendarItem(item) && !item.trigger_id && !(item.run_id && item.agent_id)
                        }
                        onClick={
                          isCalendarItem(item) || item.run_id || item.trigger_id
                            ? () => openItem(item)
                            : undefined
                        }
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-left text-sm transition-colors',
                          isCalendarItem(item) || item.run_id || item.trigger_id
                            ? 'hover:border-accent/60'
                            : 'cursor-default',
                          !item.enabled && item.status === 'planned' ? 'opacity-50' : '',
                          isCalendarItem(item) ? 'border-sky-500/30' : '',
                        )}
                      >
                        <span className="w-12 shrink-0 font-medium tabular-nums text-text-heading">
                          {formatTime(at, i18n.language)}
                        </span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {t(`agendaPage.kinds.${item.kind}`, { defaultValue: KIND_LABELS[item.kind] ?? item.kind })}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate font-medium text-text-heading">
                          {translateDecisionText(item.name, t) || item.name}
                        </span>
                        {agentLabel ? (
                          <span
                            className={`hidden shrink-0 text-xs sm:inline ${agentId ? 'text-accent hover:underline' : 'text-text-muted'}`}
                            onClick={
                              agentId
                                ? (event) => {
                                    event.stopPropagation()
                                    navigate(`/agents/${agentId}`)
                                  }
                                : undefined
                            }
                          >
                            {agentLabel}
                          </span>
                        ) : item.provider_label ? (
                          <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
                            {item.provider_label}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                            statusStyle(item.status, item.kind),
                          )}
                        >
                          {item.status === 'calendar'
                            ? t('agendaPage.kinds.calendar')
                            : agendaStatusLabel(item.status, t)}
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
      <CalendarEventDialog
        open={calendarDialogOpen}
        onOpenChange={(open) => {
          setCalendarDialogOpen(open)
          if (!open) setCalendarEditEvent(null)
        }}
        connections={calendarConnections}
        initialStart={initialRunAt}
        editEvent={calendarEditEvent}
        onCreated={onSaved}
      />
      <CalendarEventDetailDialog
        open={calendarDetailItem != null}
        onOpenChange={(open) => {
          if (!open) setCalendarDetailItem(null)
        }}
        item={calendarDetailItem}
        onDeleted={onSaved}
        onEdit={(seed) => {
          setCalendarDetailItem(null)
          setCalendarEditEvent(seed)
          setCalendarDialogOpen(true)
        }}
      />
    </PageContent>
  )
}
