import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ClipboardList, History, Info, RefreshCw, Repeat, Users } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { BrandMark } from '../integrations/BrandMark'
import { Tip } from '../ui/Tip'
import { formatAppDate } from '../../lib/app-locale'
import { connectionsPathWithKind } from '../../lib/integration-kind-url'
import { AGENDA_LAYERS, addDays, dayKey, startOfWeek, type AgendaLayer, type AgendaWho } from '../../lib/agenda-layout'
import type { CalendarConnection } from '../../lib/calendars-api'
import { calendarBrandSlug, syncAllCalendars, listCalendarConnections, utcIso } from '../../lib/calendars-api'
import { timeAgo } from '../../lib/time-ago'
import { cn } from '../../lib/utils'
import { LAYER_DOT } from './agenda-style'
import { CalendarSwatch } from './CalendarSwatch'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

const CALENDAR_BRANDS = ['google-calendar', 'outlook-calendar'] as const

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
  avatar_image_url?: string | null
}

type Props = {
  anchor: Date
  nowMs: number
  busyDays: Set<string>
  onPickDay: (day: Date) => void
  who: AgendaWho
  onWho: (who: AgendaWho) => void
  people: RailOption[]
  agents: RailOption[]
  projectId: string
  onProject: (id: string) => void
  projects: RailOption[]
  layers: Set<AgendaLayer>
  counts: Record<AgendaLayer, number>
  onToggleLayer: (layer: AgendaLayer) => void
  calendars: CalendarConnection[]
  calendarIds: Set<string>
  calendarCounts: Record<string, number>
  onToggleCalendar: (connectionId: string) => void
  /** `connection|calendar` keys hidden in this view. */
  hiddenCalendars: Set<string>
  onToggleSubCalendar: (connectionId: string, calendarId: string) => void
  onEnableCalendar: (connectionId: string, calendarId: string) => void
  onShowAll: () => void
  onHideAll: () => void
  calendarsLoading: boolean
  onCalendars: (rows: CalendarConnection[]) => void
  onSynced: () => void
  routineCount: number
  onOpenRoutines: () => void
}

export default function AgendaRail(props: Props) {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [enablingId, setEnablingId] = useState<string | null>(null)
  const autoSynced = useRef(false)

  const sync = async () => {
    setSyncBusy(true)
    setSyncError(null)
    try {
      const payload = await syncAllCalendars()
      const results = payload.results ?? []
      const failed = results.filter((row) => row.status === 'error' || row.status === 'reconnect')
      const synced = results.reduce((sum, row) => sum + (row.synced || 0), 0)
      props.onCalendars(await listCalendarConnections())
      props.onSynced()
      if (failed.length > 0) {
        const message = failed[0]?.error || ''
        if (!/not enabled|refused access/i.test(message)) {
          setSyncError(syncProblemText(message, t) || t('agendaPage.calendar.syncPartial'))
        }
      } else if (synced > 0) {
        toast.success(t('agendaPage.calendar.syncDone', { count: synced }))
      } else if (results.length > 0) {
        toast.success(t('agendaPage.calendar.syncNone'))
      }
    } catch (err) {
      setSyncError(formatApiErrorMessage(err, t('agendaPage.calendar.syncError')))
    } finally {
      setSyncBusy(false)
    }
  }

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
    void sync()
    // Sync once when the page opens on a stale account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.calendarsLoading, props.calendars])

  return (
    <aside className="flex min-h-0 max-h-full flex-col gap-5 overflow-y-auto lg:self-start" data-testid="agenda-rail">
      <MiniMonth anchor={props.anchor} nowMs={props.nowMs} busyDays={props.busyDays} onPickDay={props.onPickDay} />

      <div className="flex min-h-0 flex-col gap-5 lg:sticky lg:top-3">
      <section className="space-y-2">
        <RailHeading>{t('agendaPage.rail.who')}</RailHeading>
        <ChoiceSelect
          aria-label={t('agendaPage.rail.who')}
          triggerClassName="h-8 text-xs"
          value={props.who}
          onValueChange={(value) => props.onWho(value as AgendaWho)}
          groups={[
            {
              items: [
                { value: 'all', label: t('agendaPage.who.all'), kind: 'icon', icon: Users },
                {
                  value: 'me',
                  label: t('agendaPage.who.me'),
                  kind: 'person',
                  person: user
                    ? { name: user.name || user.email || t('agendaPage.who.me'), email: user.email, avatarUrl: user.avatarUrl }
                    : { name: t('agendaPage.who.me') },
                },
              ],
            },
            {
              label: t('agendaPage.who.people'),
              items: props.people.map((person) => ({
                value: `user:${person.id}`,
                label: person.name,
                kind: 'person' as const,
                person: { name: person.name, email: person.email, avatarUrl: person.avatarUrl },
              })),
            },
            {
              label: t('agendaPage.who.agents'),
              items: props.agents.map((agent) => ({
                value: `agent:${agent.id}`,
                label: agent.name,
                kind: 'agent' as const,
                agent,
              })),
            },
          ]}
        />
        {props.projects.length > 0 ? (
          <ChoiceSelect
            aria-label={t('agendaPage.rail.allProjects')}
            triggerClassName="h-8 text-xs"
            value={props.projectId || 'all'}
            onValueChange={(value) => props.onProject(value === 'all' ? '' : value)}
            groups={[
              {
                items: [
                  { value: 'all', label: t('agendaPage.rail.allProjects'), kind: 'project' },
                  ...props.projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                    kind: 'project' as const,
                  })),
                ],
              },
            ]}
          />
        ) : null}
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between gap-2 px-1.5">
          <RailHeading>{t('agendaPage.rail.show')}</RailHeading>
          <span className="flex gap-2">
            <button type="button" className="text-2xs text-text-muted hover:text-accent" onClick={props.onShowAll}>
              {t('agendaPage.rail.showAll')}
            </button>
            <button type="button" className="text-2xs text-text-muted hover:text-accent" onClick={props.onHideAll}>
              {t('agendaPage.rail.hideAll')}
            </button>
          </span>
        </div>
        {props.calendars.map((connection) => {
          const on = props.calendarIds.has(connection.id)
          const subCalendars = connection.calendars ?? []
          const syncedAt = utcIso(connection.last_synced_at)
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
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', on ? 'text-text-heading' : 'text-text-muted')}>
                    {connection.account || connection.display_name}
                  </span>
                  <span className="block truncate text-2xs text-text-muted">
                    {syncedAt
                      ? t('agendaPage.calendar.lastSynced', { when: timeAgo(syncedAt, t) })
                      : t('agendaPage.calendar.notSynced')}
                  </span>
                </span>
                <span className="text-2xs tabular-nums text-text-muted">
                  {props.calendarCounts[connection.id] ?? 0}
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
                const shown = cal.enabled && on && !props.hiddenCalendars.has(`${connection.id}|${cal.id}`)
                const busy = enablingId === `${connection.id}|${cal.id}`
                return (
                  <button
                    key={cal.id}
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    disabled={busy}
                    title={cal.enabled ? t('agendaPage.calendar.hideCalendar') : t('agendaPage.calendar.enableSync')}
                    onClick={() => {
                      if (!cal.enabled) {
                        if (!connection.can_manage) return
                        setEnablingId(`${connection.id}|${cal.id}`)
                        props.onEnableCalendar(connection.id, cal.id)
                        window.setTimeout(() => setEnablingId(null), 8000)
                        return
                      }
                      props.onToggleSubCalendar(connection.id, cal.id)
                    }}
                    className="ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-60"
                    data-testid="agenda-subcalendar-toggle"
                  >
                    <CalendarSwatch color={cal.color} className={cn(!shown && 'opacity-30')} />
                    <span className={cn('min-w-0 flex-1 truncate', shown ? 'text-text-secondary' : 'text-text-muted line-through')}>
                      {cal.name}
                    </span>
                    {!cal.enabled ? (
                      <span className="shrink-0 text-2xs text-text-muted">{t('agendaPage.calendar.off')}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )
        })}
        {AGENDA_LAYERS.map((layer) => {
          const on = props.layers.has(layer)
          const Icon = layer === 'tasks' ? ClipboardList : History
          return (
            <button
              key={layer}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => props.onToggleLayer(layer)}
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <ToggleBox on={on} className={LAYER_DOT[layer]} />
              <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden />
              <span className={cn('min-w-0 flex-1 truncate', on ? 'text-text-heading' : 'text-text-muted')}>
                {t(`agendaPage.layers.${layer}`)}
              </span>
              <span className="text-2xs tabular-nums text-text-muted">{props.counts[layer] ?? 0}</span>
            </button>
          )
        })}
        {props.calendars.length > 0 ? (
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void sync()}
            className="inline-flex items-center gap-1.5 px-1.5 pt-1 text-xs text-text-muted hover:text-accent disabled:opacity-60"
          >
            <RefreshCw className={cn('h-3 w-3', syncBusy && 'animate-spin')} aria-hidden />
            {syncBusy ? t('agendaPage.calendar.syncing') : t('agendaPage.calendar.syncNow')}
          </button>
        ) : null}
        {syncError ? <p className="px-1.5 text-2xs text-status-error">{syncError}</p> : null}
        {!props.calendarsLoading && props.calendars.length === 0 ? (
          <div
            className="mt-1 rounded-lg border border-border/60 bg-bg-elevated/60 px-3 py-2.5"
            data-testid="agenda-connect-calendars-banner"
          >
            <div className="flex items-start gap-2.5">
              <CalendarBrandStack size={14} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-xs font-medium text-text-heading">
                  <span className="min-w-0">{t('agendaPage.rail.connectCalendarsTitle')}</span>
                  <Tip label={t('agendaPage.rail.connectCalendarsHint')} side="right" className="max-w-56 text-left font-normal">
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
      </section>

      <section>
        <button
          type="button"
          onClick={props.onOpenRoutines}
          className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-left text-sm hover:bg-bg-elevated"
        >
          <Repeat className="h-4 w-4 text-text-muted" aria-hidden />
          <span className="flex-1 text-text-heading">{t('agendaPage.rail.tasksManage')}</span>
          <span className="text-xs tabular-nums text-text-muted">{props.routineCount}</span>
        </button>
      </section>
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
      {on ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
    </span>
  )
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="px-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">{children}</h3>
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
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            aria-label={t('agendaPage.prevMonth')}
            onClick={() => onPickDay(shiftMonth(anchor, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            aria-label={t('agendaPage.nextMonth')}
            onClick={() => onPickDay(shiftMonth(anchor, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
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
                      ? 'text-text-muted/60 hover:bg-bg-elevated'
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
