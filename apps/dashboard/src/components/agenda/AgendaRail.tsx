import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, Plus } from 'lucide-react'
import { AgendaRailRowsSkeleton } from '../ui/skeleton'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { BrandMark } from '../integrations/BrandMark'
import { Tip } from '../ui/Tip'
import { UserAvatar } from '../ui/UserAvatar'
import { AgentMark } from '../ui/AgentMark'
import { formatAppDate } from '../../lib/app-locale'
import { connectionsPathWithKind } from '../../lib/integration-kind-url'
import { addDays, dayKey, startOfWeek, type AgendaLayer } from '../../lib/agenda-layout'
import { ownerVisibilityKey } from '../../lib/agenda-hidden-owners'
import type { CalendarConnection, TenantCalendar } from '../../lib/calendars-api'
import {
  calendarBrandSlug,
  syncAllCalendars,
  listCalendarConnections,
  listTenantCalendars,
  utcIso,
} from '../../lib/calendars-api'
import { cn } from '../../lib/utils'
import { FolderTagTree } from '../inbox/FolderTagTree'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { LAYER_DOT } from './agenda-style'
import { CalendarSwatch } from './CalendarSwatch'
import { SectionLabel } from '../ui/section-label'
import { Button } from '../ui/button'

const CALENDAR_BRANDS = ['google-calendar', 'outlook-calendar'] as const
const AGENDA_RAIL_COLLAPSE_KEY = 'bokito.agenda.rail.collapsed'
const AGENDA_RAIL_ORDER_KEY = 'bokito.agenda.rail.order'

type AgendaRailSection = 'what' | 'people' | 'agents' | 'calendars'

const DEFAULT_AGENDA_ORDER: readonly AgendaRailSection[] = ['what', 'people', 'agents', 'calendars']

function isAgendaRailSection(value: unknown): value is AgendaRailSection {
  return value === 'what' || value === 'people' || value === 'agents' || value === 'calendars'
}

function readAgendaRailCollapsed(): Set<AgendaRailSection> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(AGENDA_RAIL_COLLAPSE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(isAgendaRailSection))
  } catch {
    return new Set()
  }
}

function readAgendaRailOrder(): AgendaRailSection[] {
  if (typeof window === 'undefined') return [...DEFAULT_AGENDA_ORDER]
  try {
    const raw = window.localStorage.getItem(AGENDA_RAIL_ORDER_KEY)
    if (!raw) return [...DEFAULT_AGENDA_ORDER]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...DEFAULT_AGENDA_ORDER]
    const order = parsed.filter(isAgendaRailSection)
    for (const section of DEFAULT_AGENDA_ORDER) {
      if (!order.includes(section)) order.push(section)
    }
    return order.length ? order : [...DEFAULT_AGENDA_ORDER]
  } catch {
    return [...DEFAULT_AGENDA_ORDER]
  }
}

function SortableAgendaSection({
  id,
  title,
  open,
  onOpenChange,
  actions,
  contentClassName,
  'data-testid': testId,
  children,
}: {
  id: AgendaRailSection
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  actions?: ReactNode
  contentClassName?: string
  'data-testid'?: string
  children: ReactNode
}) {
  const { t } = useTranslation('nav')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-60')}>
      <SectionLabel
        title={title}
        open={open}
        onOpenChange={onOpenChange}
        actions={actions}
        contentClassName={contentClassName}
        data-testid={testId}
        titleButtonProps={{
          ...attributes,
          ...listeners,
          className: 'cursor-grab active:cursor-grabbing',
          'aria-roledescription': t('support.customize.reorderAria', {
            defaultValue: 'Reorder {{label}}',
            label: title,
          }),
        }}
      >
        {children}
      </SectionLabel>
    </div>
  )
}

function CalendarBrandStack({ size = 14 }: { size?: number }) {
  const ring = Math.round(size * 1.55)
  return (
    <div className="flex shrink-0 items-center" aria-hidden>
      {CALENDAR_BRANDS.map((slug, index) => (
        <span
          key={slug}
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-bg-surface ring-2 ring-bg-elevated',
            index > 0 && '-ml-2',
          )}
          style={{ width: ring, height: ring }}
        >
          <BrandMark slug={slug} size={size} />
        </span>
      ))}
    </div>
  )
}

export type RailOption = {
  id: string
  name: string
  email?: string
  avatarUrl?: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
}

type Props = {
  anchor: Date
  nowMs: number
  busyDays: Set<string>
  onPickDay: (day: Date) => void
  people: RailOption[]
  agents: RailOption[]
  /** People, agents, and calendars are still loading, so the lists show rows. */
  listsLoading?: boolean
  /** `user:id` / `agent:id` keys hidden like calendar checkboxes. */
  hiddenOwners: Set<string>
  onToggleOwner: (kind: 'user' | 'agent', id: string) => void
  projectId: string
  onProject: (id: string) => void
  projects: RailOption[]
  tag?: string
  path?: string
  onPath?: (next: { projectId: string; tag: string; path: string }) => void
  layers: Set<AgendaLayer>
  counts: Record<AgendaLayer, number>
  onToggleLayer: (layer: AgendaLayer) => void
  calendars: CalendarConnection[]
  tenantCalendars: TenantCalendar[]
  /** Selected tenant calendar UUIDs. */
  calendarIds: Set<string>
  calendarCounts: Record<string, number>
  onToggleCalendar: (connectionId: string) => void
  /** Tenant calendar UUIDs (and legacy connection|external keys). */
  hiddenCalendars: Set<string>
  onToggleSubCalendar: (connectionId: string, calendarId: string) => void
  onEnableCalendar: (connectionId: string, calendarId: string) => void
  calendarsLoading: boolean
  onCalendars: (rows: CalendarConnection[]) => void
  onTenantCalendars?: (rows: TenantCalendar[]) => void
  onSynced: () => void
  routineCount: number
  onOpenRoutines: () => void
  calendarTagFilter?: string[]
  onToggleCalendarTag?: (tag: string) => void
}

export default function AgendaRail(props: Props) {
  const { t } = useTranslation('nav')
  const [enablingId, setEnablingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<AgendaRailSection>>(readAgendaRailCollapsed)
  const [sectionOrder, setSectionOrder] = useState<AgendaRailSection[]>(readAgendaRailOrder)
  const autoSynced = useRef(false)
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const setSectionOpen = (section: AgendaRailSection, open: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (open) next.delete(section)
      else next.add(section)
      try {
        window.localStorage.setItem(AGENDA_RAIL_COLLAPSE_KEY, JSON.stringify([...next]))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }

  const visibleSectionIds = useMemo(() => {
    return sectionOrder.filter((section) => {
      if (section === 'people') return props.listsLoading || props.people.length > 0
      if (section === 'agents') return props.listsLoading || props.agents.length > 0
      return true
    })
  }, [sectionOrder, props.listsLoading, props.people.length, props.agents.length])

  const onSectionDragEnd = useCallback((event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    if (!overId || activeId === overId || !isAgendaRailSection(activeId) || !isAgendaRailSection(overId)) {
      return
    }
    setSectionOrder((prev) => {
      const oldIndex = prev.indexOf(activeId)
      const newIndex = prev.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      try {
        window.localStorage.setItem(AGENDA_RAIL_ORDER_KEY, JSON.stringify(next))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }, [])

  // Silent background refresh when an account looks stale; worker also syncs every 15 min.
  useEffect(() => {
    if (props.calendarsLoading || autoSynced.current || props.calendars.length === 0) return
    const stale = props.calendars.some((connection) => {
      if (connection.sync_status === 'error' || connection.sync_status === 'idle' || !connection.last_synced_at) {
        return true
      }
      const at = new Date(utcIso(connection.last_synced_at) || '').getTime()
      return !Number.isFinite(at) || Date.now() - at > 15 * 60_000
    })
    if (!stale) return
    autoSynced.current = true
    void syncAllCalendars()
      .then(async () => {
        const [rows, tenantRows] = await Promise.all([
          listCalendarConnections(),
          listTenantCalendars(),
        ])
        props.onCalendars(rows)
        props.onTenantCalendars?.(tenantRows)
        props.onSynced()
      })
      .catch(() => {
        // Background only — errors surface via reconnect / sync_status on the row.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.calendarsLoading, props.calendars])

  return (
    <aside className="flex min-h-0 max-h-full flex-col gap-4 overflow-y-auto lg:self-start" data-testid="agenda-rail">
      <MiniMonth anchor={props.anchor} nowMs={props.nowMs} busyDays={props.busyDays} onPickDay={props.onPickDay} />

      <div className="flex min-h-0 flex-col gap-4 lg:sticky lg:top-3">
        <DndContext
          sensors={sectionSensors}
          collisionDetection={closestCenter}
          onDragEnd={onSectionDragEnd}
        >
          <SortableContext items={visibleSectionIds} strategy={verticalListSortingStrategy}>
            {visibleSectionIds.map((section) => {
              if (section === 'what') {
                return (
                  <SortableAgendaSection
                    key={section}
                    id={section}
                    title={t('agendaPage.rail.what')}
                    open={!collapsed.has('what')}
                    onOpenChange={(open) => setSectionOpen('what', open)}
                    contentClassName="space-y-2 pt-1"
                  >
                    <AgendaFolderFilter
                      projectId={props.projectId}
                      tag={props.tag}
                      path={props.path}
                      onPath={props.onPath}
                      onProject={props.onProject}
                      projects={props.projects}
                    />
                  </SortableAgendaSection>
                )
              }
              if (section === 'people') {
                return (
                  <SortableAgendaSection
                    key={section}
                    id={section}
                    title={t('agendaPage.who.people')}
                    open={!collapsed.has('people')}
                    onOpenChange={(open) => setSectionOpen('people', open)}
                    data-testid="agenda-people-toggles"
                    contentClassName="space-y-1 pt-0.5"
                  >
                    {props.listsLoading && props.people.length === 0 ? <AgendaRailRowsSkeleton /> : null}
                    {props.people.map((person) => {
                      const on = !props.hiddenOwners.has(ownerVisibilityKey('user', person.id))
                      return (
                        <button
                          key={person.id}
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => props.onToggleOwner('user', person.id)}
                          className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                          data-testid="agenda-owner-toggle"
                        >
                          <ToggleBox on={on} className="bg-accent" />
                          <UserAvatar
                            name={person.name}
                            email={person.email || person.name}
                            avatarUrl={person.avatarUrl}
                            size={16}
                            decorative
                          />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate',
                              on ? 'text-text-heading' : 'text-text-muted line-through',
                            )}
                          >
                            {person.name}
                          </span>
                        </button>
                      )
                    })}
                  </SortableAgendaSection>
                )
              }
              if (section === 'agents') {
                return (
                  <SortableAgendaSection
                    key={section}
                    id={section}
                    title={t('agendaPage.who.agents')}
                    open={!collapsed.has('agents')}
                    onOpenChange={(open) => setSectionOpen('agents', open)}
                    data-testid="agenda-agents-toggles"
                    contentClassName="space-y-1 pt-0.5"
                  >
                    {props.listsLoading && props.agents.length === 0 ? <AgendaRailRowsSkeleton /> : null}
                    {props.agents.map((agent) => {
                      const on = !props.hiddenOwners.has(ownerVisibilityKey('agent', agent.id))
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => props.onToggleOwner('agent', agent.id)}
                          className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                          data-testid="agenda-owner-toggle"
                        >
                          <ToggleBox on={on} className="bg-ai" />
                          <AgentMark
                            agent={agent} fallbackName={agent.name}
                            size={16}
                            decorative
                            mode="static"
                          />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate',
                              on ? 'text-text-heading' : 'text-text-muted line-through',
                            )}
                          >
                            {agent.name}
                          </span>
                        </button>
                      )
                    })}
                  </SortableAgendaSection>
                )
              }
              return (
                <SortableAgendaSection
                  key={section}
                  id={section}
                  title={t('agendaPage.rail.calendars')}
                  open={!collapsed.has('calendars')}
                  onOpenChange={(open) => setSectionOpen('calendars', open)}
                  contentClassName="space-y-1 pt-0.5"
                  actions={
                    <Link
                      to={connectionsPathWithKind('calendar')}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-accent"
                      aria-label={t('agendaPage.rail.addCalendar')}
                      title={t('agendaPage.rail.addCalendar')}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  }
                >
                  {props.calendarsLoading && props.calendars.length === 0 ? <AgendaRailRowsSkeleton rows={3} /> : null}
                  {props.calendars.map((connection) => {
                    const tenantSubs = props.tenantCalendars.filter(
                      (c) => c.connection_id === connection.id,
                    )
                    const syncedSubs = tenantSubs.filter((c) => c.sync_enabled)
                    const on =
                      syncedSubs.length > 0 &&
                      syncedSubs.every((c) => props.calendarIds.has(c.id))
                    const subCalendars =
                      tenantSubs.length > 0
                        ? tenantSubs.map((c) => ({
                            id: c.id,
                            external_id: c.external_id,
                            name: c.name,
                            color: c.color,
                            enabled: c.sync_enabled,
                            tags: c.tags,
                            can_manage: c.can_manage,
                          }))
                        : (connection.calendars ?? []).map((c) => ({
                            id: c.tenant_calendar_id || c.id,
                            external_id: c.id,
                            name: c.name,
                            color: c.color,
                            enabled: c.enabled,
                            tags: [] as Array<{ id: string; name: string }>,
                            can_manage: connection.can_manage,
                          }))
                    return (
                      <div key={connection.id}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => props.onToggleCalendar(connection.id)}
                          className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                          data-testid="agenda-calendar-toggle"
                        >
                          <ToggleBox on={on} className={LAYER_DOT.calendar} />
                          <BrandMark slug={calendarBrandSlug(connection.provider)} size={14} />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate',
                              on ? 'text-text-heading' : 'text-text-muted line-through',
                            )}
                          >
                            {connection.account || connection.display_name}
                          </span>
                        </button>
                        {connection.sync_status === 'error' && connection.sync_error ? (
                          <p className="ml-7 text-2xs text-status-error">
                            {syncProblemText(connection.sync_error, t)}
                            {/not enabled/i.test(connection.sync_error) ? (
                              <>
                                {' '}
                                <a
                                  href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-accent hover:underline"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {t('agendaPage.calendar.enableApi')}
                                </a>
                              </>
                            ) : null}
                          </p>
                        ) : null}
                        {connection.sync_status === 'reconnect' ? (
                          <Link
                            to={connectionsPathWithKind('calendar')}
                            className="ml-7 inline-flex items-center gap-1 text-2xs text-status-warning hover:underline"
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            {t('agenda.reconnect', { ns: 'calendar' })}
                          </Link>
                        ) : null}
                        {subCalendars.map((cal) => {
                          const hidden =
                            props.hiddenCalendars.has(cal.id) ||
                            props.hiddenCalendars.has(`${connection.id}|${cal.external_id}`)
                          const shown =
                            cal.enabled && props.calendarIds.has(cal.id) && !hidden
                          const busy = enablingId === `${connection.id}|${cal.external_id}`
                          return (
                            <div key={cal.id}>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={shown}
                                disabled={busy}
                                title={
                                  cal.enabled
                                    ? t('agendaPage.calendar.hideCalendar')
                                    : t('agendaPage.calendar.enableSync')
                                }
                                onClick={() => {
                                  if (!cal.enabled) {
                                    if (!cal.can_manage && !connection.can_manage) return
                                    setEnablingId(`${connection.id}|${cal.external_id}`)
                                    props.onEnableCalendar(connection.id, cal.external_id)
                                    window.setTimeout(() => setEnablingId(null), 8000)
                                    return
                                  }
                                  props.onToggleSubCalendar(connection.id, cal.id)
                                }}
                                className="ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-60"
                                data-testid="agenda-subcalendar-toggle"
                              >
                                <ToggleBox on={shown} className={LAYER_DOT.calendar} />
                                <CalendarSwatch color={cal.color} className={cn(!shown && 'opacity-30')} />
                                <span
                                  className={cn(
                                    'min-w-0 flex-1 truncate',
                                    shown ? 'text-text-heading' : 'text-text-muted line-through',
                                  )}
                                >
                                  {cal.name}
                                </span>
                              </button>
                              {cal.tags.length > 0 ? (
                                <div className="ml-12 flex flex-wrap gap-1 pb-1">
                                  {cal.tags.map((tag) => {
                                    const active = props.calendarTagFilter?.includes(tag.name)
                                    return (
                                      <button
                                        key={tag.id}
                                        type="button"
                                        className={cn(
                                          'rounded-md px-1.5 py-0.5 text-2xs',
                                          active
                                            ? 'bg-accent/15 text-accent'
                                            : 'text-text-muted hover:bg-bg-elevated',
                                        )}
                                        onClick={() => props.onToggleCalendarTag?.(tag.name)}
                                      >
                                        #{tag.name}
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {!props.calendarsLoading && props.calendars.length === 0 ? (
                    <div
                      className="mt-1 rounded-lg border border-border bg-bg-elevated/60 px-3 py-2.5"
                      data-testid="agenda-connect-calendars-banner"
                    >
                      <div className="flex items-start gap-2.5">
                        <CalendarBrandStack size={14} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 text-xs font-medium text-text-heading">
                            <span className="min-w-0">{t('agendaPage.rail.connectCalendarsTitle')}</span>
                            <Tip
                              label={t('agendaPage.rail.connectCalendarsHint')}
                              side="right"
                              className="max-w-56 text-left font-normal"
                            >
                              <button
                                type="button"
                                className="inline-flex shrink-0 rounded-full p-0.5 text-text-muted hover:text-text-heading focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                aria-label={t('agendaPage.rail.connectCalendarsHint')}
                              >
                                <Info className="h-3 w-3" aria-hidden />
                              </button>
                            </Tip>
                          </p>
                          <Link
                            to={connectionsPathWithKind('calendar')}
                            className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                          >
                            {t('agendaPage.rail.openConnections')}
                          </Link>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </SortableAgendaSection>
              )
            })}
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  )
}

function syncProblemText(raw: string, t: (key: string) => string): string {
  if (/not enabled/i.test(raw)) return t('agendaPage.calendar.apiDisabled')
  if (/refused access/i.test(raw)) return t('agendaPage.calendar.permissionDenied')
  if (/could not be reached/i.test(raw)) return t('agendaPage.calendar.unreachable')
  return raw
}

function ToggleBox({ on, className }: { on: boolean; className: string }) {
  return (
    <span
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        on ? cn(className, 'border-transparent text-white') : 'border-border bg-transparent',
      )}
      aria-hidden
    >
      {on ? <Check className="h-2.5 w-2.5" /> : null}
    </span>
  )
}

function shiftMonth(anchor: Date, delta: number): Date {
  const target = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(anchor.getDate(), last))
}

function MiniMonth({
  anchor,
  nowMs,
  busyDays,
  onPickDay,
}: {
  anchor: Date
  nowMs: number
  busyDays: Set<string>
  onPickDay: (day: Date) => void
}) {
  const { t, i18n } = useTranslation('nav')
  const month = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const days = useMemo(() => {
    const from = startOfWeek(month)
    return Array.from({ length: 42 }, (_, i) => addDays(from, i))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month.getTime()])
  const todayKey = dayKey(new Date(nowMs))
  const anchorKey = dayKey(anchor)
  const weekStart = startOfWeek(anchor).getTime()
  const weekEnd = addDays(startOfWeek(anchor), 7).getTime()
  return (
    <section>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold capitalize text-text-heading">
          {formatAppDate(month, i18n.language, { month: 'long', year: 'numeric' })}
        </span>
        <span className="flex">
          <Button variant="ghost" size="iconSm"
            type="button"
            className="text-text-muted"
            aria-label={t('agendaPage.prevMonth')}
            onClick={() => onPickDay(shiftMonth(anchor, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="iconSm"
            type="button"
            className="text-text-muted"
            aria-label={t('agendaPage.nextMonth')}
            onClick={() => onPickDay(shiftMonth(anchor, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((day) => (
          <span key={day.getDay()} className="py-1 text-2xs uppercase text-text-muted">
            {formatAppDate(day, i18n.language, { weekday: 'narrow' })}
          </span>
        ))}
        {days.map((day) => {
          const key = dayKey(day)
          const outside = day.getMonth() !== month.getMonth()
          const inWeek = day.getTime() >= weekStart && day.getTime() < weekEnd
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickDay(day)}
              aria-current={key === todayKey ? 'date' : undefined}
              aria-pressed={key === anchorKey}
              className={cn(
                'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums transition-colors',
                inWeek && key !== todayKey && 'bg-accent/5',
                key === todayKey
                  ? 'bg-accent font-semibold text-white'
                  : key === anchorKey
                    ? 'bg-accent/15 font-semibold text-accent'
                    : outside
                      ? 'text-text-muted hover:bg-bg-elevated'
                      : 'text-text-heading hover:bg-bg-elevated',
              )}
            >
              {day.getDate()}
              {busyDays.has(key) && key !== todayKey ? (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent/70" aria-hidden />
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AgendaFolderFilter({
  projectId,
  tag,
  path,
  onPath,
  onProject,
  projects,
}: {
  projectId: string
  tag?: string
  path?: string
  onPath?: (next: { projectId: string; tag: string; path: string }) => void
  onProject: (id: string) => void
  projects: RailOption[]
}) {
  const { t } = useTranslation('nav')
  const { nav, loaded } = useCommunicationNav()
  const selectedId = path || tag || projectId
  if (!onPath) {
    if (projects.length === 0) return null
    return (
      <ChoiceSelect
        aria-label={t('agendaPage.rail.what')}
        triggerClassName="h-8 text-xs"
        value={projectId || projects[0]?.id || ''}
        onValueChange={(value) => onProject(value)}
        groups={[
          {
            items: projects.map((project) => ({
              value: project.id,
              label: project.name,
              kind: 'project' as const,
            })),
          },
        ]}
      />
    )
  }
  return (
    <FolderTagTree
      folders={nav.projects}
      tags={nav.tags}
      ticketTags={nav.ticketTags}
      loading={!loaded}
      mode="agenda"
      selectedId={selectedId}
      onSelect={(kind, id, name) => {
        if (kind === 'tag') onPath({ projectId: '', tag: name, path: '' })
        else if (id.includes(':')) {
          const [folderId, tagId] = id.split(':')
          onPath({ projectId: folderId, tag: '', path: tagId || '' })
        } else onPath({ projectId: id, tag: '', path: '' })
      }}
      t={t}
    />
  )
}
