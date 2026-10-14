import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Bell,
  Bot,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Plus,
  RefreshCw,
  Repeat,
  Webhook,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { Input } from '../components/ui/input'
import { toast } from 'sonner'
import TriggerDialog, { type TargetOption } from '../components/agenda/TriggerDialog'
import CalendarEventDialog, { type CalendarEventEditSeed } from '../components/agenda/CalendarEventDialog'
import CalendarEventDetailDialog from '../components/agenda/CalendarEventDetailDialog'
import AgendaRail from '../components/agenda/AgendaRail'
import AgendaTimeGrid, { type AgendaSelection } from '../components/agenda/AgendaTimeGrid'
import AgendaMonthGrid from '../components/agenda/AgendaMonthGrid'
import AgendaList from '../components/agenda/AgendaList'
import AgendaItemPanel from '../components/agenda/AgendaItemPanel'
import RoutinesDialog from '../components/agenda/RoutinesDialog'
import PlanDialog, { type PlanSeed } from '../components/inbox/PlanDialog'
import type { InboxThread } from '../lib/inbox-api'
import { getSignalThread } from '../lib/signals-api'
import { DEFAULT_REPEAT } from '../lib/thread-schedule'
import { useAuth } from '../context/AuthContext'
import { useMembers } from '../hooks/useMembers'
import { isTypingTarget } from '../hooks/useInboxListShortcuts'
import { listAgents } from '../lib/agents-api'
import {
  listCalendarConnections,
  listTenantCalendars,
  patchTenantCalendar,
  saveAccountCalendars,
  type CalendarConnection,
  type TenantCalendar,
} from '../lib/calendars-api'
import { listTriggers, type Trigger, type TriggerKind } from '../lib/orchestration-api'
import { listProjects } from '../lib/projects-api'
import { listTimeItems, type TimeItem, type TimeItemKind } from '../lib/time-items'
import { listWorkstreams } from '../lib/workstreams-api'
import { formatAppDate, formatAppTime } from '../lib/app-locale'
import {
  AGENDA_LAYERS,
  addDays,
  attentionOf,
  calendarIdsParam,
  dayKey,
  itemStart,
  layerOf,
  layersParam,
  matchesOwnerVisibility,
  matchesWho,
  parseCalendarIds,
  parseDayKey,
  parseLayers,
  parseView,
  parseWho,
  shiftAnchor,
  startOfDay,
  viewRange,
  type AgendaLayer,
  type AgendaView,
} from '../lib/agenda-layout'
import { hiddenCalendarKey, readHiddenCalendars, writeHiddenCalendars } from '../lib/agenda-hidden-calendars'
import {
  ownerVisibilityKey,
  readHiddenOwners,
  writeHiddenOwners,
} from '../lib/agenda-hidden-owners'
import { cn } from '../lib/utils'

const ALL_SOURCES: TimeItemKind[] = ['session', 'wake', 'checkup', 'task', 'calendar', 'activity']
const VIEW_KEYS: Record<string, AgendaView> = { d: 'day', w: 'week', m: 'month', l: 'list' }

export default function AgendaPage() {
  const { t, i18n } = useTranslation('nav')
  const { token, user } = useAuth()
  const { members } = useMembers()
  const [searchParams, setSearchParams] = useSearchParams()

  const view = parseView(searchParams.get('view'))
  const anchor = useMemo(
    () => parseDayKey(searchParams.get('date')) ?? startOfDay(new Date()),
    [searchParams],
  )
  const who = parseWho(searchParams.get('who'))
  const projectId = searchParams.get('project') ?? ''
  const tagFilter = searchParams.get('tag') ?? ''
  const pathFilter = searchParams.get('path') ?? ''
  const layers = useMemo(() => parseLayers(searchParams.get('layers')), [searchParams])

  const [nowMs, setNowMs] = useState(() => Date.now())
  const [items, setItems] = useState<TimeItem[]>([])
  const [attentionItems, setAttentionItems] = useState<TimeItem[]>([])
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [agents, setAgents] = useState<TargetOption[]>([])
  const [workstreams, setWorkstreams] = useState<TargetOption[]>([])
  const [projects, setProjects] = useState<TargetOption[]>([])
  const [calendars, setCalendars] = useState<CalendarConnection[]>([])
  const [tenantCalendars, setTenantCalendars] = useState<TenantCalendar[]>([])
  const [calendarsLoading, setCalendarsLoading] = useState(true)
  const availableCalendarIds = useMemo(
    () => tenantCalendars.filter((c) => c.sync_enabled).map((c) => c.id),
    [tenantCalendars],
  )
  const calendarTagFilter = useMemo(() => {
    const raw = searchParams.get('calTag')
    if (!raw?.trim()) return [] as string[]
    return raw.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean)
  }, [searchParams])
  const calendarIds = useMemo(() => {
    const fromCal = searchParams.get('cal')
    if (fromCal != null || searchParams.get('cals') == null) {
      return parseCalendarIds(fromCal, availableCalendarIds)
    }
    // Legacy `cals` = connection ids → expand to tenant calendars.
    const connIds = parseCalendarIds(
      searchParams.get('cals'),
      calendars.map((c) => c.id),
    )
    const expanded = tenantCalendars
      .filter((c) => c.sync_enabled && connIds.has(c.connection_id))
      .map((c) => c.id)
    return new Set(expanded)
  }, [searchParams, availableCalendarIds, calendars, tenantCalendars])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selection, setSelection] = useState<AgendaSelection | null>(null)

  // Webhooks and flow rules keep the trigger editor; everything else is a thread.
  const [triggerDialog, setTriggerDialog] = useState<{ trigger: Trigger | null; kind: TriggerKind } | null>(null)
  const [plan, setPlan] = useState<{ thread: InboxThread | null; seed?: PlanSeed } | null>(null)
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false)
  const [calendarEditEvent, setCalendarEditEvent] = useState<CalendarEventEditSeed | null>(null)
  const [calendarSeedAt, setCalendarSeedAt] = useState<Date | null>(null)
  const [calendarDetailItem, setCalendarDetailItem] = useState<TimeItem | null>(null)
  const [routinesOpen, setRoutinesOpen] = useState(false)

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams)
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '') next.delete(key)
        else next.set(key, value)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // Deep links from elsewhere: `agent` narrows to one agent, `new` opens the
  // create dialog, `trigger` opens that item once the data is in.
  const agentParam = searchParams.get('agent')
  const newParam = searchParams.get('new')
  const triggerParam = searchParams.get('trigger')
  useEffect(() => {
    if (!agentParam && !newParam && !searchParams.has('source')) return
    if (newParam === 'calendar') {
      setCalendarEditEvent(null)
      setCalendarSeedAt(null)
      setCalendarDialogOpen(true)
    } else if (newParam === 'webhook') {
      setTriggerDialog({ trigger: null, kind: 'webhook' })
    } else if (newParam) {
      openPlan({ repeat: newParam === 'cron' || newParam === 'interval' ? DEFAULT_REPEAT : null })
    }
    setParams({
      agent: null,
      new: null,
      seed: null,
      source: null,
      ...(agentParam ? { who: `agent:${agentParam}` } : {}),
    })
    // openPlan is stable enough for a one-off deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentParam, newParam, searchParams, setParams])

  const setView = (next: AgendaView) =>
    setParams({
      view: next === 'day' ? null : next,
      ...(next === 'list' ? { date: null } : {}),
    })
  const setAnchor = (next: Date) =>
    setParams({ date: dayKey(next) === dayKey(new Date()) ? null : dayKey(next) })
  const toggleLayer = (layer: AgendaLayer) => {
    const next = new Set(layers)
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    setParams({ layers: layersParam(next) })
  }
  // Calendars inside an account (`connection|calendar`), remembered on this browser.
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(() => readHiddenCalendars())
  // People and agents, same checkbox model as calendars.
  const [hiddenOwners, setHiddenOwners] = useState<Set<string>>(() => readHiddenOwners())
  const [agendaQuery, setAgendaQuery] = useState('')
  const toggleOwner = (kind: 'user' | 'agent', id: string) => {
    const key = ownerVisibilityKey(kind, id)
    setHiddenOwners((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeHiddenOwners(next)
      return next
    })
  }
  const toggleCalendar = (connectionId: string) => {
    const subs = tenantCalendars.filter((c) => c.connection_id === connectionId && c.sync_enabled)
    const allOn = subs.every((c) => calendarIds.has(c.id))
    const next = new Set(calendarIds)
    setHiddenCalendars((prev) => {
      const hidden = new Set(prev)
      for (const cal of subs) {
        if (allOn) {
          hidden.add(cal.id)
          hidden.add(hiddenCalendarKey(connectionId, cal.external_id))
          next.delete(cal.id)
        } else {
          hidden.delete(cal.id)
          hidden.delete(hiddenCalendarKey(connectionId, cal.external_id))
          next.add(cal.id)
        }
      }
      writeHiddenCalendars(hidden)
      return hidden
    })
    setParams({ cal: calendarIdsParam(next, availableCalendarIds), cals: null })
  }
  const toggleSubCalendar = (connectionId: string, calendarId: string) => {
    const tenant = tenantCalendars.find(
      (c) => c.connection_id === connectionId && (c.id === calendarId || c.external_id === calendarId),
    )
    const key = tenant?.id ?? hiddenCalendarKey(connectionId, calendarId)
    const legacy = hiddenCalendarKey(connectionId, tenant?.external_id ?? calendarId)
    const wasHidden = hiddenCalendars.has(key) || hiddenCalendars.has(legacy)
    const nextHidden = new Set(hiddenCalendars)
    if (wasHidden) {
      nextHidden.delete(key)
      nextHidden.delete(legacy)
    } else {
      nextHidden.add(key)
      nextHidden.add(legacy)
    }
    writeHiddenCalendars(nextHidden)
    setHiddenCalendars(nextHidden)
    const nextIds = new Set(calendarIds)
    if (tenant) {
      if (wasHidden) nextIds.add(tenant.id)
      else nextIds.delete(tenant.id)
    }
    setParams({ cal: calendarIdsParam(nextIds, availableCalendarIds), cals: null })
  }
  const enableCalendar = async (connectionId: string, calendarId: string) => {
    const connection = calendars.find((row) => row.id === connectionId)
    const tenant = tenantCalendars.find(
      (c) => c.connection_id === connectionId && (c.id === calendarId || c.external_id === calendarId),
    )
    try {
      if (tenant?.can_manage) {
        await patchTenantCalendar(tenant.id, { sync_enabled: true })
      } else if (connection?.can_manage) {
        const payload = (connection.calendars ?? []).map((cal) => ({
          id: cal.id,
          enabled: cal.enabled || cal.id === calendarId,
        }))
        await saveAccountCalendars(connectionId, { calendars: payload })
      } else {
        return
      }
      const [rows, tenantRows] = await Promise.all([listCalendarConnections(), listTenantCalendars()])
      setCalendars(rows)
      setTenantCalendars(tenantRows)
      const enabled = tenantRows.find(
        (c) => c.connection_id === connectionId && (c.id === calendarId || c.external_id === calendarId),
      )
      setHiddenCalendars((prev) => {
        const next = new Set(prev)
        if (enabled) next.delete(enabled.id)
        next.delete(hiddenCalendarKey(connectionId, calendarId))
        writeHiddenCalendars(next)
        return next
      })
      const available = tenantRows.filter((c) => c.sync_enabled).map((c) => c.id)
      const nextIds = new Set(parseCalendarIds(searchParams.get('cal'), available))
      if (enabled) nextIds.add(enabled.id)
      setParams({ cal: calendarIdsParam(nextIds, available), cals: null })
      setReloadKey((key) => key + 1)
      toast.success(t('agendaPage.calendar.syncStarted'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agendaPage.calendar.syncError')))
    }
  }

  const range = useMemo(() => viewRange(view, anchor), [view, anchor])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const now = Date.now()
      const whoAgentId = who.startsWith('agent:') ? who.slice('agent:'.length) : undefined
      const whoUserId =
        who === 'me'
          ? user?.uuid ?? undefined
          : who.startsWith('user:')
            ? who.slice('user:'.length)
            : undefined
      const calFilter =
        calendarIds.size === availableCalendarIds.length ? undefined : [...calendarIds]
      const [window_, attention, triggerRows] = await Promise.all([
        listTimeItems({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          sources: ALL_SOURCES,
          projectId: projectId || undefined,
          tag: tagFilter || undefined,
          path: pathFilter || undefined,
          agentId: whoAgentId,
          userId: whoUserId,
          calendarIds: calFilter,
          calendarTags: calendarTagFilter.length ? calendarTagFilter : undefined,
        }),
        listTimeItems({
          from: new Date(now - 30 * 86_400_000).toISOString(),
          to: new Date(now + 60_000).toISOString(),
          sources: ['task', 'checkup', 'session'],
          scheduledOnly: true,
          projectId: projectId || undefined,
          tag: tagFilter || undefined,
          path: pathFilter || undefined,
          agentId: whoAgentId,
          userId: whoUserId,
        }),
        listTriggers({ limit: 500 }),
      ])
      setItems(window_.items)
      setAttentionItems(attention.items)
      setTriggers(triggerRows)
      setNowMs(Date.now())
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [
    token,
    range,
    projectId,
    tagFilter,
    pathFilter,
    who,
    user?.uuid,
    t,
    calendarIds,
    availableCalendarIds.length,
    calendarTagFilter,
  ])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!token) return
    setCalendarsLoading(true)
    Promise.all([listCalendarConnections(), listTenantCalendars()])
      .then(([rows, tenantRows]) => {
        setCalendars(rows)
        setTenantCalendars(tenantRows)
      })
      .catch(() => {
        setCalendars([])
        setTenantCalendars([])
      })
      .finally(() => setCalendarsLoading(false))
  }, [token, reloadKey])

  useEffect(() => {
    if (!token) return
    void Promise.all([
      listAgents().catch(() => []),
      listWorkstreams().catch(() => []),
      listProjects().catch(() => []),
    ]).then(([agentRows, wsRows, projectRows]) => {
      setAgents(
        agentRows.map((a) => ({
          id: a.id,
          name: a.name,
          avatar_kind: a.avatar_kind,
          avatar_icon: a.avatar_icon,
          avatar_color: a.avatar_color,
          avatar_shape: a.avatar_shape,
          avatar_image_url: a.avatar_image_url,
        })),
      )
      setWorkstreams((Array.isArray(wsRows) ? wsRows : []).map((w) => ({ id: w.id, name: w.name })))
      setProjects(projectRows.map((p) => ({ id: p.id, name: p.name })))
    })
  }, [token])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      if (document.querySelector('[role="dialog"]')) return
      if (event.key === 'ArrowLeft') setAnchor(shiftAnchor(view, anchor, -1))
      else if (event.key === 'ArrowRight') setAnchor(shiftAnchor(view, anchor, 1))
      else if (event.key === 't') setAnchor(new Date())
      else if (event.key === 'Escape') setSelection(null)
      else if (VIEW_KEYS[event.key]) setView(VIEW_KEYS[event.key])
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!triggerParam || loading) return
    const item = items.find((row) => row.series_id === triggerParam || row.trigger_id === triggerParam)
    const trigger = triggers.find((row) => row.id === triggerParam)
    if (item) setSelection({ kind: 'item', item })
    else if (trigger) void editTrigger(trigger)
    setParams({ trigger: null })
  }, [triggerParam, loading, items, triggers, setParams])

  const meId = user?.uuid ?? null
  const byWho = useMemo(
    () =>
      items.filter(
        (item) => matchesWho(item, who, meId) && matchesOwnerVisibility(item, hiddenOwners),
      ),
    [items, who, meId, hiddenOwners],
  )
  const visible = useMemo(
    () =>
      byWho.filter((item) => {
        const layer = layerOf(item)
        if (layer === 'calendar') {
          const tcId = item.tenant_calendar_id
          if (tcId) {
            if (hiddenCalendars.has(tcId)) return false
            return calendarIds.has(tcId)
          }
          if (!item.connection_id) return calendarIds.size > 0
          if (hiddenCalendars.has(hiddenCalendarKey(item.connection_id, item.calendar_id ?? ''))) return false
          const match = tenantCalendars.find(
            (c) => c.connection_id === item.connection_id && c.external_id === item.calendar_id,
          )
          return match ? calendarIds.has(match.id) : false
        }
        return layers.has(layer)
      }),
    [byWho, layers, calendarIds, hiddenCalendars, tenantCalendars],
  )
  const needle = agendaQuery.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!needle) return visible
    return visible.filter((item) =>
      [item.title, item.location, item.calendar_name, item.owner_name, item.agent_name, item.detail]
        .some((part) => (part || '').toLowerCase().includes(needle)),
    )
  }, [visible, needle])
  const counts = useMemo(() => {
    const out = Object.fromEntries(AGENDA_LAYERS.map((layer) => [layer, 0])) as Record<AgendaLayer, number>
    for (const item of byWho) {
      const layer = layerOf(item)
      if (layer === 'calendar') continue
      out[layer] += 1
    }
    return out
  }, [byWho])
  const calendarCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const item of byWho) {
      if (item.kind !== 'calendar') continue
      const tcId = item.tenant_calendar_id
      if (tcId) {
        if (hiddenCalendars.has(tcId) || !calendarIds.has(tcId)) continue
        const conn = tenantCalendars.find((c) => c.id === tcId)?.connection_id
        if (conn) out[conn] = (out[conn] || 0) + 1
        continue
      }
      if (!item.connection_id) continue
      if (hiddenCalendars.has(hiddenCalendarKey(item.connection_id, item.calendar_id ?? ''))) continue
      out[item.connection_id] = (out[item.connection_id] || 0) + 1
    }
    return out
  }, [byWho, hiddenCalendars, calendarIds, tenantCalendars])
  const attention = useMemo(
    () => attentionOf(attentionItems.filter((item) => matchesWho(item, who, meId)), nowMs),
    [attentionItems, who, meId, nowMs],
  )
  const busyDays = useMemo(
    () => new Set(shown.filter((item) => layerOf(item) !== 'activity').map((item) => dayKey(itemStart(item)))),
    [shown],
  )
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const agentNames = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents])
  const people = useMemo(
    () =>
      members
        .filter((m) => m.uuid)
        .map((m) => ({ id: m.uuid, name: m.name || m.email, email: m.email, avatarUrl: m.avatarUrl })),
    [members],
  )

  const reload = () => setReloadKey((k) => k + 1)
  function openPlan(seed: PlanSeed = {}) {
    const agentId = who.startsWith('agent:') ? who.slice('agent:'.length) : null
    setPlan({ thread: null, seed: { agentId, ...seed } })
  }
  async function editThread(signalId: string) {
    if (!token) return
    try {
      const detail = await getSignalThread(token, signalId, { limit: 1 })
      if (detail) setPlan({ thread: detail.thread })
    } catch (err) {
      setError(formatApiErrorMessage(err, t('agendaPage.loadError')))
    }
  }
  async function editTrigger(trigger: Trigger) {
    if (trigger.kind === 'webhook' || trigger.workstream_id || !trigger.signal_id) {
      setTriggerDialog({ trigger, kind: trigger.kind })
      return
    }
    await editThread(trigger.signal_id)
  }
  const openCalendarNew = (at: Date | null = null) => {
    setCalendarEditEvent(null)
    setCalendarSeedAt(at)
    setCalendarDialogOpen(true)
  }

  const rangeLabel = useMemo(() => {
    const lang = i18n.language
    if (view === 'day') return formatAppDate(anchor, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (view === 'month') return formatAppDate(anchor, lang, { month: 'long', year: 'numeric' })
    const last = addDays(range.to, -1)
    return `${formatAppDate(range.from, lang, { day: 'numeric', month: 'short' })} – ${formatAppDate(last, lang, { day: 'numeric', month: 'short', year: 'numeric' })}`
  }, [view, anchor, range, i18n.language])

  const selectedId = selection?.kind === 'item' ? selection.item.id : null
  const attentionTotal = attention.tasks.length + attention.failed.length

  return (
    <PageContent width="full" className="flex h-full min-h-0 flex-col gap-3 px-6 pb-4 pt-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
          {t('agendaPage.today')}
        </Button>
        <div className="flex">
          <Button type="button" size="sm" variant="ghost" aria-label={t('agendaPage.previous')} onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={t('agendaPage.next')} onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
            {t('agendaPage.today')}
          </Button>
        </div>
        <h2 className="text-base font-semibold text-text-heading first-letter:uppercase">
          {view === 'list'
            ? t('agendaPage.list.range', { from: formatAppDate(anchor, i18n.language, { day: 'numeric', month: 'short' }) })
            : rangeLabel}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            value={agendaQuery}
            onChange={(event) => setAgendaQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAgendaQuery('')
            }}
            placeholder={t('agendaPage.search')}
            aria-label={t('agendaPage.search')}
            type="search"
            className="h-8 w-44"
          />
          <Tabs value={view} onValueChange={(value) => setView(value as AgendaView)}>
            <TabsList>
              {(['day', 'week', 'month', 'list'] as AgendaView[]).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(`agendaPage.views.${value}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t('agendaPage.refresh')}
            title={t('agendaPage.refreshedAt', { time: formatAppTime(new Date(nowMs), i18n.language) })}
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('agendaPage.new')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <NewItem icon={CalendarClock} title={t('agendaPage.newMenu.item')} body={t('agendaPage.newMenu.itemBody')} onSelect={() => openPlan()} />
              <NewItem icon={Repeat} title={t('agendaPage.newMenu.routine')} body={t('agendaPage.newMenu.routineBody')} onSelect={() => openPlan({ repeat: DEFAULT_REPEAT })} />
              <NewItem icon={Webhook} title={t('agendaPage.newMenu.webhook')} body={t('agendaPage.newMenu.webhookBody')} onSelect={() => setTriggerDialog({ trigger: null, kind: 'webhook' })} />
              <NewItem
                icon={CalendarDays}
                title={t('agendaPage.newMenu.calendar')}
                body={calendars.length ? t('agendaPage.newMenu.calendarBody') : t('agendaPage.newMenu.calendarNeedsConnect')}
                disabled={calendars.length === 0}
                onSelect={() => openCalendarNew()}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {attentionTotal > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-status-warning/30 bg-status-warning/5 px-3 py-2" data-testid="agenda-attention">
          <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium text-text-heading">
            <AlertTriangle className="h-4 w-4 text-status-warning" aria-hidden />
            {t('agendaPage.attention.title')}
          </span>
          {attention.tasks.length > 0 ? (
            <AttentionChip
              icon={ClipboardCheck}
              label={t('agendaPage.attention.tasks', { count: attention.tasks.length })}
              onClick={() => setSelection({ kind: 'group', title: t('agendaPage.attention.tasksTitle'), items: attention.tasks })}
            />
          ) : null}
          {attention.failed.length > 0 ? (
            <AttentionChip
              icon={AlertTriangle}
              tone="error"
              label={t('agendaPage.attention.failed', { count: attention.failed.length })}
              onClick={() => setSelection({ kind: 'group', title: t('agendaPage.attention.failedTitle'), items: attention.failed })}
            />
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-5 overflow-hidden lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]',
          selection && 'xl:grid-cols-[16.5rem_minmax(0,1fr)_21rem]',
        )}
      >
        <AgendaRail
          anchor={anchor}
          nowMs={nowMs}
          busyDays={busyDays}
          onPickDay={(day) => setAnchor(day)}
          people={people}
          agents={agents}
          hiddenOwners={hiddenOwners}
          onToggleOwner={toggleOwner}
          projectId={projectId}
          onProject={(id) => setParams({ project: id || null, tag: null, path: null })}
          projects={projects}
          tag={tagFilter}
          path={pathFilter}
          onPath={(next) =>
            setParams({
              project: next.projectId || null,
              tag: next.tag || null,
              path: next.path || null,
            })
          }
          layers={layers}
          counts={counts}
          onToggleLayer={toggleLayer}
          calendars={calendars}
          tenantCalendars={tenantCalendars}
          calendarIds={calendarIds}
          calendarCounts={calendarCounts}
          onToggleCalendar={toggleCalendar}
          hiddenCalendars={hiddenCalendars}
          onToggleSubCalendar={toggleSubCalendar}
          onEnableCalendar={(connectionId, calendarId) => void enableCalendar(connectionId, calendarId)}
          calendarsLoading={calendarsLoading}
          onCalendars={setCalendars}
          onTenantCalendars={setTenantCalendars}
          calendarTagFilter={calendarTagFilter}
          onToggleCalendarTag={(tag) => {
            const next = new Set(calendarTagFilter)
            if (next.has(tag)) next.delete(tag)
            else next.add(tag)
            setParams({ calTag: next.size ? [...next].join(',') : null })
          }}
          onSynced={reload}
          routineCount={triggers.filter((row) => row.kind !== 'once' && row.kind !== 'event').length}
          onOpenRoutines={() => setRoutinesOpen(true)}
        />

        <main className={cn('flex h-full min-h-0 min-w-0 flex-col', view !== 'list' && 'overflow-y-auto')}>
          {error ? <ApiErrorBanner message={error} onRetry={reload} /> : null}
          {!loading && byWho.length > 0 && shown.length === 0 ? (
            <p className="mb-3 rounded-lg border border-border/60 bg-bg-elevated/60 px-3 py-2 text-sm text-text-secondary">
              {needle ? t('agendaPage.searchEmpty') : t('agendaPage.filtersHideAll')}
            </p>
          ) : null}
          {view === 'day' || view === 'week' ? (
            <AgendaTimeGrid
              days={range.days}
              items={shown}
              onOpenDay={(day) => setParams({ view: 'day', date: dayKey(day) })}
              nowMs={nowMs}
              selectedId={selectedId}
              onSelect={setSelection}
              onCreateAt={(at) => openPlan({ at })}
            />
          ) : view === 'month' ? (
            <AgendaMonthGrid
              days={range.days}
              month={anchor.getMonth()}
              items={shown}
              nowMs={nowMs}
              selectedId={selectedId}
              onSelect={setSelection}
              onOpenDay={(day) => setParams({ view: 'day', date: dayKey(day) })}
            />
          ) : shown.length === 0 && !loading ? (
            <EmptyAgenda onPlan={() => openPlan()} />
          ) : (
            <AgendaList
              days={range.days}
              items={shown}
              nowMs={nowMs}
              landKey={dayKey(anchor)}
              selectedId={selectedId}
              projectNames={projectNames}
              onSelect={setSelection}
            />
          )}
        </main>

        {selection ? (
          <div className="fixed inset-y-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] shadow-overlay xl:static xl:inset-auto xl:z-auto xl:min-h-0 xl:w-auto xl:overflow-y-auto xl:shadow-none">
            <AgendaItemPanel
              selection={selection}
              nowMs={nowMs}
              triggers={triggers}
              projectNames={projectNames}
              onSelect={setSelection}
              onClose={() => setSelection(null)}
              onEditTrigger={(trigger) => void editTrigger(trigger)}
              onEditThread={(signalId) => void editThread(signalId)}
              onOpenCalendar={(item) => setCalendarDetailItem(item)}
              onChanged={reload}
            />
          </div>
        ) : null}
      </div>

      <TriggerDialog
        open={triggerDialog != null}
        onOpenChange={(open) => {
          if (!open) setTriggerDialog(null)
        }}
        trigger={triggerDialog?.trigger ?? null}
        agents={agents}
        workstreams={workstreams}
        initialKind={triggerDialog?.kind}
        initialAgentId={who.startsWith('agent:') ? who.slice('agent:'.length) : null}
        onSaved={reload}
      />
      <PlanDialog
        open={plan != null}
        onOpenChange={(open) => {
          if (!open) setPlan(null)
        }}
        thread={plan?.thread ?? null}
        seed={plan?.seed}
        onSaved={reload}
      />
      <RoutinesDialog
        open={routinesOpen}
        onOpenChange={setRoutinesOpen}
        triggers={triggers.filter((row) => row.kind !== 'once' && row.kind !== 'event')}
        agentNames={agentNames}
        onEdit={(trigger) => void editTrigger(trigger)}
        onCreate={() => openPlan({ repeat: DEFAULT_REPEAT })}
        onChanged={reload}
      />
      <CalendarEventDialog
        open={calendarDialogOpen}
        onOpenChange={(open) => {
          setCalendarDialogOpen(open)
          if (!open) setCalendarEditEvent(null)
        }}
        connections={calendars}
        initialStart={calendarSeedAt}
        editEvent={calendarEditEvent}
        onCreated={reload}
      />
      <CalendarEventDetailDialog
        open={calendarDetailItem != null}
        onOpenChange={(open) => {
          if (!open) setCalendarDetailItem(null)
        }}
        item={calendarDetailItem}
        onDeleted={() => {
          setSelection(null)
          reload()
        }}
        onEdit={(seed) => {
          setCalendarDetailItem(null)
          setCalendarEditEvent(seed)
          setCalendarDialogOpen(true)
        }}
      />
    </PageContent>
  )
}

function NewItem({
  icon: Icon,
  title,
  body,
  disabled,
  onSelect,
}: {
  icon: typeof Bot
  title: string
  body: string
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="items-start gap-2.5 py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-heading">{title}</span>
        <span className="block text-xs text-text-muted">{body}</span>
      </span>
    </DropdownMenuItem>
  )
}

function AttentionChip({
  icon: Icon,
  label,
  tone = 'warning',
  onClick,
}: {
  icon: typeof Bell
  label: string
  tone?: 'warning' | 'error'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border bg-bg-surface px-2.5 py-1 text-xs font-medium transition-colors hover:bg-bg-elevated',
        tone === 'error' ? 'border-status-error/40 text-status-error' : 'border-status-warning/40 text-status-warning',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  )
}

function EmptyAgenda({ onPlan }: { onPlan: () => void }) {
  const { t } = useTranslation('nav')
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-10 text-center">
      <CalendarDays className="mx-auto h-8 w-8 text-text-muted/50" aria-hidden />
      <p className="mt-3 text-sm font-medium text-text-heading">{t('agendaPage.emptyTitle')}</p>
      <p className="mt-1 text-sm text-text-muted">{t('agendaPage.emptyBody')}</p>
      <div className="mt-4 flex flex-col items-center gap-3">
        <Button type="button" size="sm" onClick={onPlan}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          {t('agendaPage.createRun')}
        </Button>
        <Link to="/docs/ai/agenda" className="text-xs font-medium text-accent hover:underline">
          {t('pageGuides.learnMore')}
        </Link>
      </div>
    </div>
  )
}
