import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import TriggerDialog, { type TargetOption } from '../components/agenda/TriggerDialog'
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
  type AgendaItem,
  type Trigger,
} from '../lib/orchestration-api'
import { listWorkstreams } from '../lib/workstreams-api'
import { formatAppDate, formatAppTime } from '../lib/app-locale'
import { clampWeekOffset, parseWeekOffset, weekOffsetParam } from '../lib/agenda-week'
import { isTypingTarget } from '../hooks/useInboxListShortcuts'
import { Input } from '../components/ui/input'
import { inboxPath } from '../lib/messages-paths'
import { resolveAgendaAgentId, resolveAgendaAgentName, humanizeAgendaActorName } from '../lib/agenda-label'
import { pickClosestThreadBySubject, triggerThreadPath } from '../lib/agenda-thread'
import { translateDecisionText } from '../lib/activity-labels'
import { agendaStatusLabel } from '../lib/status-labels'
import { humanizeContactName } from '../lib/contact-label'
import { cn } from '../lib/utils'
import { listThreads } from '../lib/inbox-api'
import { agentWorkforceRunUrl } from '../lib/workforce-run-urls'

type ViewTab = 'timeline' | 'week'

function parseAgendaView(raw: string | null): ViewTab {
  if (raw === 'week') return 'week'
  return 'timeline'
}

const KIND_LABELS: Record<string, string> = {
  once: 'One-off',
  event: 'Event',
  cron: 'Recurring',
  interval: 'Repeating',
  heartbeat: 'Check-in',
  webhook: 'Incoming',
  calendar: 'Calendar',
  follow_up: 'Look again',
}

type SourceFilter = 'tasks' | 'all' | 'wakes' | 'calendar'

function parseSourceFilter(raw: string | null): SourceFilter {
  if (raw === 'all' || raw === 'wakes' || raw === 'calendar' || raw === 'tasks') return raw
  // Default: human look-ats / follow-ups first (F-80) — cron scans stay secondary.
  return 'tasks'
}

function isCalendarItem(item: AgendaItem): boolean {
  return item.kind === 'calendar' || item.source === 'calendar'
}

function isLookbackItem(item: AgendaItem): boolean {
  if (item.kind === 'follow_up' || item.kind === 'task' || item.source === 'follow_up') return true
  if (item.actor_kind === 'person') return true
  return false
}

function isAgentAutomationItem(item: AgendaItem): boolean {
  if (isCalendarItem(item) || isLookbackItem(item)) return false
  return item.kind === 'cron' || item.kind === 'interval' || item.kind === 'heartbeat'
}

function isWakeItem(item: AgendaItem): boolean {
  return !isCalendarItem(item)
}

function lookbackSortRank(item: AgendaItem): number {
  if (isLookbackItem(item)) return 0
  if (isCalendarItem(item)) return 1
  if (isAgentAutomationItem(item)) return 3
  return 2
}

function itemIsClickable(item: AgendaItem): boolean {
  return (
    isCalendarItem(item) ||
    Boolean(item.run_id) ||
    Boolean(item.trigger_id) ||
    Boolean(item.signal_id)
  )
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
  if (s === 'awaiting_human' || s === 'overdue') return 'border-status-warning/40 bg-status-warning/10 text-status-warning'
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
    <div
      className={cn(
        'w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
        statusStyle(item.status, item.kind),
        !item.enabled && item.status === 'planned' ? 'opacity-50' : '',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={cn('w-full text-left', onClick ? 'hover:opacity-90' : 'cursor-default')}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium tabular-nums">
            {showDate ? `${formatAppDate(at, i18n.language, { day: 'numeric', month: 'short' })} ` : ''}
            {formatTime(at, i18n.language)}
          </span>
          <span className="rounded border border-current/30 px-1 py-px text-2xs opacity-80">
            {t(`agendaPage.kinds.${item.kind}`, { defaultValue: KIND_LABELS[item.kind] ?? item.kind })}
          </span>
        </div>
        <p className="mt-0.5 truncate-fade font-medium">{translateDecisionText(item.name, t) || item.name}</p>
        {item.actor_name || item.agent_name ? (
          <p className="truncate-fade opacity-75">
            {t(`agendaPage.actor.${item.actor_kind === 'person' ? 'person' : 'agent'}`)}
            {' · '}
            {item.actor_kind === 'person'
              ? humanizeContactName(item.actor_name, null, t('contactsPage.widgetVisitor'))
              : item.agent_name || humanizeAgendaActorName(item.actor_name)}
          </p>
        ) : null}
        {isCalendarItem(item) && item.provider_label ? (
          <p className="truncate-fade opacity-75">{item.provider_label}</p>
        ) : null}
        {item.status !== 'planned' && item.status !== 'calendar' ? (
          <p className="mt-0.5 text-2xs opacity-75">{agendaStatusLabel(item.status, t)}</p>
        ) : null}
      </button>
    </div>
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
  const [automationsExpanded, setAutomationsExpanded] = useState(false)

  const handleViewChange = useCallback(
    (next: ViewTab) => {
      setView(next)
      const params = new URLSearchParams(searchParams)
      if (next === 'timeline') params.delete('view')
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
    // Persist the default lookbacks filter so a refresh keeps the human-first view.
    if (next === 'tasks') params.delete('source')
    else params.set('source', next)
    setSearchParams(params, { replace: true })
  }

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])

  const dateWindow = useMemo(() => {
    if (view === 'week') return { from: weekStart, to: addDays(weekStart, 7) }
    return { from: addDays(startOfDay(new Date()), -7), to: addDays(startOfDay(new Date()), 21) }
  }, [view, weekStart])

  const load = useCallback(async () => {
    if (!token) return
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
      if (isTypingTarget(event.target)) return
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
    if (sourceFilter === 'tasks') out = out.filter((i) => isLookbackItem(i) || isCalendarItem(i))
    if (sourceFilter === 'wakes') out = out.filter((i) => isWakeItem(i))
    if (sourceFilter === 'calendar') out = out.filter((i) => isCalendarItem(i))
    if (kindFilter !== 'all') out = out.filter((i) => i.kind === kindFilter)
    const q = listQuery.trim().toLowerCase()
    if (q) {
      out = out.filter((i) => {
        const hay = `${i.name} ${i.agent_name ?? ''} ${i.provider_label ?? ''} ${i.kind} ${i.status}`.toLowerCase()
        return hay.includes(q)
      })
    }
    return [...out].sort((a, b) => {
      const byRank = lookbackSortRank(a) - lookbackSortRank(b)
      if (byRank !== 0) return byRank
      return parseAt(a.at).getTime() - parseAt(b.at).getTime()
    })
  }, [items, kindFilter, sourceFilter, listQuery])

  const primaryFiltered = useMemo(
    () => (sourceFilter === 'all' ? filtered.filter((i) => !isAgentAutomationItem(i)) : filtered),
    [filtered, sourceFilter],
  )

  const automationFiltered = useMemo(
    () => (sourceFilter === 'all' ? filtered.filter((i) => isAgentAutomationItem(i)) : []),
    [filtered, sourceFilter],
  )

  const primaryByDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const item of primaryFiltered) {
      const key = dayKey(parseAt(item.at))
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return map
  }, [primaryFiltered])

  const byDay = useMemo(() => {
    // Week grid uses the human-first list; automations stay out of the day cells
    // when browsing "All" so cron scans do not bury look-ats (F-80).
    const map = new Map<string, AgendaItem[]>()
    for (const item of primaryFiltered) {
      const key = dayKey(parseAt(item.at))
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return map
  }, [primaryFiltered])

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
    if (item.source === 'follow_up' || item.kind === 'follow_up') {
      if (item.signal_id) {
        navigate(inboxPath('open', item.signal_id))
        return
      }
    }
    void (async () => {
      // The trigger knows its own thread; only older rows need a subject search.
      const direct = item.status !== 'planned' || item.run_id ? triggerThreadPath(item) : null
      if (direct) {
        navigate(direct)
        return
      }
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
              navigate(inboxPath('all', String(match.id)))
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
      <ContentHeader
        guide="agenda"
        title={t('tabs.agenda.title')}
        subtitle={t('tabs.agenda.subtitle')}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {refreshedAt ? (
              <span className="text-xs text-text-muted">
                {t('agendaPage.refreshedAt', { time: formatAppTime(refreshedAt, i18n.language) })}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={t('agendaPage.refresh')}
              onClick={() => {
                setReloadKey((k) => k + 1)
                void load()
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

      <CalendarConnectBar
        connections={calendarConnections}
        loading={calendarLoading}
        onConnectionsChange={setCalendarConnections}
        onSynced={() => {
          setReloadKey((k) => k + 1)
          void load()
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => handleViewChange(v as ViewTab)}>
          <TabsList>
            <TabsTrigger value="timeline">{t('agendaPage.timeline')}</TabsTrigger>
            <TabsTrigger value="week">{t('agendaPage.week')}</TabsTrigger>
          </TabsList>
        </Tabs>

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
            {view === 'timeline' ? (
              <Input
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                placeholder={t('agendaPage.listSearch')}
                className="h-8 w-[180px] text-xs"
                aria-label={t('agendaPage.listSearch')}
              />
            ) : null}
            <Select value={sourceFilter} onValueChange={(v) => handleSourceFilterChange(v as SourceFilter)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue placeholder={t('agendaPage.sourceTasks')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tasks">{t('agendaPage.sourceTasks')}</SelectItem>
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
                    .filter((value) => value !== 'calendar' && value !== 'task')
                    .map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`agendaPage.kinds.${value}`, { defaultValue: KIND_LABELS[value] })}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : null}
        </div>
      </div>

      {error ? (
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
                  'flex min-h-[10rem] flex-col gap-1.5 rounded-lg border p-2',
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
                      <Badge variant="secondary" className="h-4 px-1 text-2xs">
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
                    className="px-1 text-left text-xs font-medium text-accent hover:underline"
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
                      onClick={itemIsClickable(item) ? () => openItem(item) : undefined}
                    />
                  ))
                )}
              </div>
            )
          })}
        </div>
      ) : primaryFiltered.length === 0 && automationFiltered.length === 0 && listQuery.trim() ? (
        <p className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-text-muted">
          {t('agendaPage.listFilterEmpty')}
        </p>
      ) : primaryFiltered.length === 0 && automationFiltered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-text-muted/50" aria-hidden />
          <p className="mt-3 text-sm font-medium text-text-heading">
            {sourceFilter === 'tasks' ? t('agendaPage.emptyLookbacksTitle') : t('agendaPage.emptyTitle')}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {sourceFilter === 'tasks' ? t('agendaPage.emptyLookbacksBody') : t('agendaPage.emptyBody')}
          </p>
          <div className="mt-4 flex flex-col items-center gap-3">
            {sourceFilter === 'tasks' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => handleSourceFilterChange('all')}>
                {t('agendaPage.showAllIncludingAutomations')}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => openCreate()}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('agendaPage.createRun')}
              </Button>
            )}
            <Link to="/docs/ai/agenda" className="text-xs font-medium text-accent hover:underline">
              {t('pageGuides.learnMore')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {[...primaryByDay.entries()].map(([key, dayItems]) => {
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
                    const clickable = itemIsClickable(item)
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-sm transition-colors',
                          isCalendarItem(item) ? 'border-sky-500/30' : '',
                          isLookbackItem(item) ? 'border-status-warning/35' : '',
                          !item.enabled && item.status === 'planned' ? 'opacity-50' : '',
                        )}
                      >
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={clickable ? () => openItem(item) : undefined}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-3 text-left',
                            clickable ? 'hover:opacity-90' : 'cursor-default',
                          )}
                        >
                          <span className="w-12 shrink-0 font-medium tabular-nums text-text-heading">
                            {formatTime(at, i18n.language)}
                          </span>
                          <Badge variant="outline" className="shrink-0 text-2xs">
                            {t(`agendaPage.kinds.${item.kind}`, {
                              defaultValue: KIND_LABELS[item.kind] ?? item.kind,
                            })}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate-fade font-medium text-text-heading">
                            {translateDecisionText(item.name, t) || item.name}
                          </span>
                          {item.actor_name || agentLabel ? (
                            <span
                              className={`hidden shrink-0 text-xs sm:inline ${agentId && item.actor_kind !== 'person' ? 'text-accent hover:underline' : 'text-text-muted'}`}
                              onClick={
                                agentId && item.actor_kind !== 'person'
                                  ? (event) => {
                                      event.stopPropagation()
                                      navigate(`/agents/${agentId}`)
                                    }
                                  : undefined
                              }
                            >
                              {t(`agendaPage.actor.${item.actor_kind === 'person' ? 'person' : 'agent'}`)}
                              {' · '}
                              {item.actor_kind === 'person'
                                ? humanizeContactName(
                                    item.actor_name,
                                    null,
                                    t('contactsPage.widgetVisitor'),
                                  )
                                : agentLabel || humanizeAgendaActorName(item.actor_name)}
                            </span>
                          ) : item.provider_label ? (
                            <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
                              {item.provider_label}
                            </span>
                          ) : null}
                          <span
                            className={cn(
                              'shrink-0 rounded-md border px-2 py-0.5 text-2xs ',
                              statusStyle(item.status, item.kind),
                            )}
                          >
                            {item.status === 'calendar'
                              ? t('agendaPage.kinds.calendar')
                              : agendaStatusLabel(item.status, t)}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
          {automationFiltered.length > 0 ? (
            <section className="rounded-lg border border-border/50 bg-bg-elevated/40">
              <button
                type="button"
                onClick={() => setAutomationsExpanded((open) => !open)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
              >
                <span className="font-medium text-text-heading">
                  {t('agendaPage.automationsCollapsed', { count: automationFiltered.length })}
                </span>
                <span className="text-xs text-text-muted">
                  {automationsExpanded ? t('agendaPage.automationsHide') : t('agendaPage.automationsShow')}
                </span>
              </button>
              {automationsExpanded ? (
                <div className="space-y-1.5 border-t border-border/40 px-3 py-2.5">
                  {automationFiltered.map((item) => {
                    const at = parseAt(item.at)
                    const clickable = itemIsClickable(item)
                    return (
                      <div
                        key={item.id}
                        className="flex w-full items-center gap-3 rounded-lg border border-border/40 bg-bg-surface/80 px-3 py-1.5 text-sm opacity-80"
                      >
                        <button
                          type="button"
                          disabled={!clickable}
                          onClick={clickable ? () => openItem(item) : undefined}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-3 text-left',
                            clickable ? 'hover:opacity-90' : 'cursor-default',
                          )}
                        >
                          <span className="w-12 shrink-0 tabular-nums text-text-muted">
                            {formatAppDate(at, i18n.language, { day: 'numeric', month: 'short' })}{' '}
                            {formatTime(at, i18n.language)}
                          </span>
                          <Badge variant="outline" className="shrink-0 text-2xs">
                            {t(`agendaPage.kinds.${item.kind}`, {
                              defaultValue: KIND_LABELS[item.kind] ?? item.kind,
                            })}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate-fade text-text-secondary">
                            {translateDecisionText(item.name, t) || item.name}
                          </span>
                          <span className="shrink-0 text-2xs text-text-muted">
                            {agendaStatusLabel(item.status, t)}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </section>
          ) : null}
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
