import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import {
  dayKey,
  isAllDay,
  itemEnd,
  itemOwner,
  itemStart,
  layerOf,
  layoutDay,
} from '../../lib/agenda-layout'
import type { TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { agendaChipState, LAYER_BLOCK, LAYER_DOT, LAYER_ICON, LAYER_TEXT, isFailed } from './agenda-style'
import { AgendaOwnerMark } from './AgendaOwnerMark'

const HOUR_PX = 48
const GUTTER = '3.25rem'

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
        const timed = mine.filter((item) => !isAllDay(item))
        return { day, key, allDay, placed: layoutDay(timed, day) }
      }),
    [days, items],
  )

  const hasTop = perDay.some((col) => col.allDay.length > 0)

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
    <div className="panel overflow-hidden" data-testid="agenda-time-grid">
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
              {perDay.map(({ key, allDay }) => (
                <div key={key} className="flex min-w-0 flex-col gap-1 border-l border-border/40 p-1">
                  {allDay.map((item) => {
                    const owner = itemOwner(item)
                    return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect({ kind: 'item', item })}
                      className={cn(
                        'flex min-w-0 items-center gap-1 truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs font-medium text-text-heading',
                        LAYER_BLOCK[layerOf(item)],
                        agendaChipState({ selected: selectedId === item.id }),
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {owner ? <AgendaOwnerMark owner={owner} size={14} /> : null}
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
                      const selected = selectedId === item.id
                      const owner = itemOwner(item)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelect({ kind: 'item', item })}
                          className={cn(
                            'absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-sm transition-colors',
                            LAYER_BLOCK[layer],
                            agendaChipState({ selected, past, paused: item.enabled === false }),
                            isFailed(item.status) && !selected && 'ring-1 ring-status-error/60',
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
                            <span className="min-w-0 flex-1 truncate">{item.title}</span>
                            {owner ? <AgendaOwnerMark owner={owner} size={14} /> : null}
                          </span>
                          {px >= 36 ? (
                            <span className="flex min-w-0 items-center gap-1 text-2xs text-text-muted">
                              <span className="shrink-0 tabular-nums">{formatAppTime(itemStart(item), i18n.language)}</span>
                              {owner?.name ? (
                                <span className="min-w-0 truncate">· {owner.name}</span>
                              ) : null}
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
  const layers = ['calendar', 'tasks', 'activity'] as const
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
