import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { dayKey, groupByDay, itemStart, layerOf } from '../../lib/agenda-layout'
import { agendaStatusLabel } from '../../lib/status-labels'
import type { TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { LAYER_DOT, LAYER_ICON, LAYER_TEXT, isFailed, itemSubtitle } from './agenda-style'
import type { AgendaSelection } from './AgendaTimeGrid'

type Props = {
  days: Date[]
  items: TimeItem[]
  nowMs: number
  selectedId: string | null
  projectNames: Map<string, string>
  onSelect: (selection: AgendaSelection) => void
}

const QUIET_STATUSES = new Set(['planned', 'calendar', 'completed', 'done', 'ok', 'reported'])

export default function AgendaList({ days, items, nowMs, selectedId, projectNames, onSelect }: Props) {
  const { t, i18n } = useTranslation('nav')
  const byDay = useMemo(() => groupByDay(items), [items])
  const todayKey = dayKey(new Date(nowMs))
  const [openRoutines, setOpenRoutines] = useState<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const visible = days.filter(
    (day) =>
      dayKey(day) === todayKey ||
      (byDay.get(dayKey(day)) ?? []).some((item) => layerOf(item) !== 'routines' || isFailed(item.status)),
  )
  const firstDay = days[0]?.getTime()

  useEffect(() => {
    rootRef.current?.querySelector('[data-today="true"]')?.scrollIntoView({ block: 'start' })
  }, [firstDay, items.length > 0])

  if (visible.length === 0) return null

  return (
    <div ref={rootRef} className="space-y-5" data-testid="agenda-list">
      {visible.map((day) => {
        const key = dayKey(day)
        const all = byDay.get(key) ?? []
        const routines = all.filter((item) => layerOf(item) === 'routines')
        const rows = all.filter((item) => layerOf(item) !== 'routines')
        const isToday = key === todayKey
        const nowIndex = isToday ? rows.findIndex((item) => itemStart(item).getTime() > nowMs) : -1
        const routinesOpen = openRoutines.has(key)
        return (
          <section key={key} data-today={isToday ? 'true' : undefined} className="scroll-mt-4">
            <h2 className="sticky top-0 z-10 mb-1.5 flex items-baseline gap-2 bg-bg/90 py-1 backdrop-blur-sm">
              <span className={cn('text-sm font-semibold', isToday ? 'text-accent' : 'text-text-heading')}>
                {isToday ? t('agendaPage.today') : formatAppDate(day, i18n.language, { weekday: 'long' })}
              </span>
              <span className="text-xs text-text-muted">
                {formatAppDate(day, i18n.language, { day: 'numeric', month: 'long' })}
              </span>
            </h2>
            <div className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-bg-surface">
              {rows.length === 0 && routines.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-text-muted">{t('agendaPage.list.emptyDay')}</p>
              ) : null}
              {rows.map((item, index) => (
                <Fragment key={item.id}>
                  {index === nowIndex ? <NowLine /> : null}
                  <Row
                    item={item}
                    nowMs={nowMs}
                    selected={selectedId === item.id}
                    projectName={item.project_id ? projectNames.get(item.project_id) : undefined}
                    onSelect={() => onSelect({ kind: 'item', item })}
                  />
                </Fragment>
              ))}
              {isToday && nowIndex === -1 && rows.length > 0 ? <NowLine /> : null}
              {routines.length > 0 ? (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenRoutines((prev) => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        return next
                      })
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-muted hover:bg-bg-elevated/60"
                  >
                    {routinesOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                    {t('agendaPage.list.routines', { count: routines.length })}
                    {routines.some((item) => isFailed(item.status)) ? (
                      <span className="text-status-error">{t('agendaPage.list.routinesFailed')}</span>
                    ) : null}
                  </button>
                  {routinesOpen
                    ? routines.map((item) => (
                        <Row
                          key={item.id}
                          item={item}
                          nowMs={nowMs}
                          dense
                          selected={selectedId === item.id}
                          onSelect={() => onSelect({ kind: 'item', item })}
                        />
                      ))
                    : null}
                </div>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function NowLine() {
  const { t } = useTranslation('nav')
  return (
    <div className="flex items-center gap-2 px-3 py-0.5" aria-label={t('agendaPage.list.now')}>
      <span className="text-2xs font-semibold uppercase tracking-wide text-status-error">{t('agendaPage.list.now')}</span>
      <span className="h-px flex-1 bg-status-error/60" />
    </div>
  )
}

function Row({
  item,
  nowMs,
  selected,
  dense,
  projectName,
  onSelect,
}: {
  item: TimeItem
  nowMs: number
  selected: boolean
  dense?: boolean
  projectName?: string
  onSelect: () => void
}) {
  const { t, i18n } = useTranslation('nav')
  const layer = layerOf(item)
  const Icon = LAYER_ICON[layer]
  const start = itemStart(item)
  const past = start.getTime() < nowMs
  const subtitle = itemSubtitle(item, t)
  const showStatus = !QUIET_STATUSES.has(item.status.toLowerCase()) && item.kind !== 'activity'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-bg-elevated/60',
        dense ? 'py-1.5 pl-9 text-xs' : 'py-2 text-sm',
        selected && 'bg-accent/10',
        past && layer !== 'activity' && 'opacity-70',
        item.enabled === false && 'opacity-50',
      )}
    >
      <span className="w-11 shrink-0 tabular-nums text-text-muted">
        {item.all_day ? t('agendaPage.grid.allDay') : formatAppTime(start, i18n.language)}
      </span>
      <span className={cn('relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-elevated', dense && 'h-5 w-5')}>
        <Icon className={cn('h-3.5 w-3.5', LAYER_TEXT[layer])} aria-hidden />
        <span className={cn('absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full', LAYER_DOT[layer])} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-heading">{item.title}</span>
        {!dense && (subtitle || projectName) ? (
          <span className="block truncate text-xs text-text-muted">
            {[subtitle, projectName].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
      {showStatus ? (
        <span
          className={cn(
            'shrink-0 rounded-md border px-1.5 py-0.5 text-2xs',
            isFailed(item.status)
              ? 'border-status-error/40 text-status-error'
              : item.status === 'due'
                ? 'border-status-warning/40 text-status-warning'
                : 'border-border/60 text-text-muted',
          )}
        >
          {agendaStatusLabel(item.status, t)}
        </span>
      ) : null}
    </button>
  )
}
