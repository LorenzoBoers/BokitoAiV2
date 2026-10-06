import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Repeat } from 'lucide-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select'
import { formatAppDate } from '../../lib/app-locale'
import { AGENDA_LAYERS, addDays, dayKey, startOfWeek, type AgendaLayer, type AgendaWho } from '../../lib/agenda-layout'
import type { CalendarConnection } from '../../lib/calendars-api'
import { cn } from '../../lib/utils'
import { CalendarConnectBar } from './CalendarConnectBar'
import { LAYER_DOT } from './agenda-style'

export type RailOption = { id: string; name: string }

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
  calendarsLoading: boolean
  onCalendars: (rows: CalendarConnection[]) => void
  onSynced: () => void
  routineCount: number
  onOpenRoutines: () => void
}

export default function AgendaRail(props: Props) {
  const { t } = useTranslation('nav')
  return (
    <aside className="flex min-h-0 max-h-full flex-col gap-5 overflow-y-auto lg:self-start" data-testid="agenda-rail">
      <MiniMonth anchor={props.anchor} nowMs={props.nowMs} busyDays={props.busyDays} onPickDay={props.onPickDay} />

      <div className="flex min-h-0 flex-col gap-5 lg:sticky lg:top-3">
      <section className="space-y-2">
        <RailHeading>{t('agendaPage.rail.who')}</RailHeading>
        <Select value={props.who} onValueChange={(value) => props.onWho(value as AgendaWho)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('agendaPage.who.all')}</SelectItem>
            <SelectItem value="me">{t('agendaPage.who.me')}</SelectItem>
            {props.people.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('agendaPage.who.people')}</SelectLabel>
                  {props.people.map((person) => (
                    <SelectItem key={person.id} value={`user:${person.id}`}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
            {props.agents.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('agendaPage.who.agents')}</SelectLabel>
                  {props.agents.map((agent) => (
                    <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
        {props.projects.length > 0 ? (
          <Select value={props.projectId || 'all'} onValueChange={(value) => props.onProject(value === 'all' ? '' : value)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('agendaPage.rail.allProjects')}</SelectItem>
              {props.projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </section>

      <section className="space-y-1">
        <RailHeading>{t('agendaPage.rail.show')}</RailHeading>
        {AGENDA_LAYERS.map((layer) => {
          const on = props.layers.has(layer)
          return (
            <button
              key={layer}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => props.onToggleLayer(layer)}
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-elevated"
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                  on ? cn(LAYER_DOT[layer], 'border-transparent') : 'border-border bg-transparent',
                )}
                aria-hidden
              >
                {on ? <span className="h-1.5 w-1.5 rounded-full bg-white/90" /> : null}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', on ? 'text-text-heading' : 'text-text-muted')}>
                {t(`agendaPage.layers.${layer}`)}
              </span>
              <span className="text-2xs tabular-nums text-text-muted">{props.counts[layer] || ''}</span>
            </button>
          )
        })}
        <p className="px-1.5 pt-1 text-2xs leading-relaxed text-text-muted">{t('agendaPage.rail.layersHint')}</p>
      </section>

      <section className="space-y-2">
        <RailHeading>{t('agendaPage.rail.calendars')}</RailHeading>
        <CalendarConnectBar
          variant="rail"
          connections={props.calendars}
          loading={props.calendarsLoading}
          onConnectionsChange={props.onCalendars}
          onSynced={props.onSynced}
        />
      </section>

      <section>
        <button
          type="button"
          onClick={props.onOpenRoutines}
          className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-left text-sm hover:bg-bg-elevated"
        >
          <Repeat className="h-4 w-4 text-text-muted" aria-hidden />
          <span className="flex-1 text-text-heading">{t('agendaPage.rail.routines')}</span>
          <span className="text-xs tabular-nums text-text-muted">{props.routineCount}</span>
        </button>
      </section>
      </div>
    </aside>
  )
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="px-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">{children}</h3>
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
            onClick={() => onPickDay(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            aria-label={t('agendaPage.nextMonth')}
            onClick={() => onPickDay(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
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
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPickDay(day)}
              className={cn(
                'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums transition-colors',
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
