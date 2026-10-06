import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import {
  dayKey,
  isAllDay,
  itemEnd,
  itemStart,
  layerOf,
  layoutDay,
  type AgendaLayer,
} from '../../lib/agenda-layout'
import type { TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { LAYER_BLOCK, LAYER_DOT, LAYER_ICON, LAYER_TEXT, isFailed } from './agenda-style'

const HOUR_PX = 48
const GUTTER = '3.25rem'

/** Layers that collapse into one chip per day instead of blocks. */
const SUMMARY_LAYERS: AgendaLayer[] = ['routines', 'activity']

export type AgendaSelection = { kind: 'item'; item: TimeItem } | { kind: 'group'; title: string; items: TimeItem[] }

type Props = {
  days: Date[]
  items: TimeItem[]
  nowMs: number
  selectedId: string | null
  onSelect: (selection: AgendaSelection) => void
  onCreateAt: (at: Date) => void
}

export default function AgendaTimeGrid({ days, items, nowMs, selectedId, onSelect, onCreateAt }: Props) {
  const { t, i18n } = useTranslation('nav')
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayKey = dayKey(new Date(nowMs))

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const key = dayKey(day)
        const dayStart = day.getTime()
        const dayEnd = dayStart + 24 * 3_600_000
        const mine = items.filter((item) => {
          const start = itemStart(item).getTime()
          if (isAllDay(item)) {
            const end = itemEnd(item).getTime()
            return start < dayEnd && (end > dayStart || dayKey(itemStart(item)) === key)
          }
          return dayKey(itemStart(item)) === key
        })
        const allDay = mine.filter((item) => isAllDay(item))
        const summaries = SUMMARY_LAYERS.map((layer) => ({
          layer,
          items: mine.filter((item) => !isAllDay(item) && layerOf(item) === layer),
        })).filter((group) => group.items.length > 0)
        const timed = mine.filter((item) => !isAllDay(item) && !SUMMARY_LAYERS.includes(layerOf(item)))
        return { day, key, allDay, summaries, placed: layoutDay(timed, day) }
      }),
    [days, items],
  )

  const hasTop = perDay.some((col) => col.allDay.length > 0 || col.summaries.length > 0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date(nowMs)
    const showsToday = days.some((day) => dayKey(day) === todayKey)
    const hour = showsToday && now.getHours() >= 9 ? now.getHours() - 2 : 7
    el.scrollTop = hour * HOUR_PX
    // Scroll once per range, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.getTime(), days.length])

  const columns = `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`
  const nowMinutes = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes()

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-surface" data-testid="agenda-time-grid">
      <div className={cn('overflow-x-auto', days.length > 1 && 'min-w-0')}>
        <div className={cn(days.length > 1 && 'min-w-[44rem]')}>
          <div className="grid border-b border-border/60" style={{ gridTemplateColumns: columns }}>
            <div />
            {perDay.map(({ day, key }) => {
              const isToday = key === todayKey
              return (
                <div key={key} className="flex items-baseline justify-center gap-1.5 border-l border-border/40 py-2">
                  <span className={cn('text-xs uppercase tracking-wide', isToday ? 'text-accent' : 'text-text-muted')}>
                    {formatAppDate(day, i18n.language, { weekday: 'short' })}
                  </span>
                  <span
                    className={cn(
                      'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums',
                      isToday ? 'bg-accent text-white' : 'text-text-heading',
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              )
            })}
          </div>

          {hasTop ? (
            <div className="grid border-b border-border/60 bg-bg-elevated/30" style={{ gridTemplateColumns: columns }}>
              <div className="px-1 py-1.5 text-right text-2xs text-text-muted">{t('agendaPage.grid.allDay')}</div>
              {perDay.map(({ key, allDay, summaries }) => (
                <div key={key} className="flex min-w-0 flex-col gap-1 border-l border-border/40 p-1">
                  {allDay.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect({ kind: 'item', item })}
                      className={cn(
                        'truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs font-medium text-text-heading',
                        LAYER_BLOCK[layerOf(item)],
                        selectedId === item.id && 'ring-2 ring-accent/60',
                      )}
                    >
                      {item.title}
                    </button>
                  ))}
                  {summaries.map(({ layer, items: group }) => {
                    const Icon = LAYER_ICON[layer]
                    const failed = group.some((item) => isFailed(item.status))
                    return (
                      <button
                        key={layer}
                        type="button"
                        onClick={() =>
                          onSelect({
                            kind: 'group',
                            title: t(`agendaPage.layers.${layer}`),
                            items: group,
                          })
                        }
                        className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-2xs text-text-muted hover:bg-bg-elevated hover:text-text-heading"
                      >
                        <Icon className={cn('h-3 w-3 shrink-0', LAYER_TEXT[layer])} aria-hidden />
                        <span className="truncate">{t(`agendaPage.layers.${layer}`)}</span>
                        <span className="ml-auto tabular-nums">{group.length}</span>
                        {failed ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-error" aria-hidden /> : null}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : null}

          <div ref={scrollRef} className="max-h-[calc(100vh-19rem)] min-h-[24rem] overflow-y-auto">
            <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}>
              <div className="relative">
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    key={hour}
                    className="absolute right-1.5 -translate-y-1/2 text-2xs tabular-nums text-text-muted"
                    style={{ top: hour * HOUR_PX }}
                  >
                    {hour === 0 ? '' : formatAppTime(new Date(2000, 0, 1, hour), i18n.language)}
                  </span>
                ))}
              </div>
              {perDay.map(({ day, key, placed }) => {
                const isToday = key === todayKey
                return (
                  <div
                    key={key}
                    className={cn('relative border-l border-border/40', isToday && 'bg-accent/5')}
                    onClick={(event) => {
                      if (event.target !== event.currentTarget) return
                      const rect = event.currentTarget.getBoundingClientRect()
                      const minutes = Math.floor(((event.clientY - rect.top) / HOUR_PX) * 2) * 30
                      onCreateAt(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes))
                    }}
                    title={t('agendaPage.grid.clickToPlan')}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <div
                        key={hour}
                        className="pointer-events-none absolute inset-x-0 border-t border-border/30"
                        style={{ top: hour * HOUR_PX }}
                      />
                    ))}
                    {placed.map(({ item, top, height, col, cols }) => {
                      const layer = layerOf(item)
                      const Icon = LAYER_ICON[layer]
                      const px = (height / 60) * HOUR_PX
                      const past = itemStart(item).getTime() + height * 60_000 < nowMs
                      const who = item.owner_name || item.agent_name || item.actor_name
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelect({ kind: 'item', item })}
                          className={cn(
                            'absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-sm transition-colors',
                            LAYER_BLOCK[layer],
                            past && 'opacity-60',
                            item.enabled === false && 'opacity-40',
                            isFailed(item.status) && 'ring-1 ring-status-error/60',
                            selectedId === item.id && 'z-10 ring-2 ring-accent/70',
                          )}
                          style={{
                            top: (top / 60) * HOUR_PX + 1,
                            height: px - 2,
                            left: `calc(${(col / cols) * 100}% + 2px)`,
                            width: `calc(${100 / cols}% - 4px)`,
                          }}
                        >
                          <span className="flex items-center gap-1 font-medium text-text-heading">
                            <Icon className={cn('h-3 w-3 shrink-0', LAYER_TEXT[layer])} aria-hidden />
                            <span className="truncate">{item.title}</span>
                          </span>
                          {px >= 36 ? (
                            <span className="block truncate text-2xs text-text-muted">
                              {formatAppTime(itemStart(item), i18n.language)}
                              {who ? ` · ${who}` : ''}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                    {isToday ? (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                        style={{ top: (nowMinutes / 60) * HOUR_PX }}
                        aria-hidden
                      >
                        <span className="-ml-1 h-2 w-2 rounded-full bg-status-error" />
                        <span className="h-px flex-1 bg-status-error" />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <Legend />
    </div>
  )
}

function Legend() {
  const { t } = useTranslation('nav')
  const layers: AgendaLayer[] = ['calendar', 'reminders', 'checkups', 'agents']
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 px-3 py-1.5 text-2xs text-text-muted">
      {layers.map((layer) => (
        <span key={layer} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-sm', LAYER_DOT[layer])} aria-hidden />
          {t(`agendaPage.layers.${layer}`)}
        </span>
      ))}
    </div>
  )
}
