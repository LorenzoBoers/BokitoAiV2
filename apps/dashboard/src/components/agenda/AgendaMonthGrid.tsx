import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { dayKey, groupByDay, itemOwner, itemStart, layerOf } from '../../lib/agenda-layout'
import type { TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { agendaChipState, LAYER_DOT } from './agenda-style'
import { AgendaOwnerMark } from './AgendaOwnerMark'
import type { AgendaSelection } from './AgendaTimeGrid'

const VISIBLE = 3

type Props = {
  days: Date[]
  month: number
  items: TimeItem[]
  nowMs: number
  selectedId: string | null
  onSelect: (selection: AgendaSelection) => void
  onOpenDay: (day: Date) => void
}

export default function AgendaMonthGrid({ days, month, items, nowMs, selectedId, onSelect, onOpenDay }: Props) {
  const { t, i18n } = useTranslation('nav')
  const byDay = useMemo(() => groupByDay(items), [items])
  const todayKey = dayKey(new Date(nowMs))

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-surface" data-testid="agenda-month-grid">
      <div className="grid grid-cols-7 border-b border-border/60">
        {days.slice(0, 7).map((day) => (
          <div key={day.getDay()} className="py-2 text-center text-xs uppercase tracking-wide text-text-muted">
            {formatAppDate(day, i18n.language, { weekday: 'short' })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day)
          const all = byDay.get(key) ?? []
          const planned = all.filter((item) => !['routines', 'activity'].includes(layerOf(item)))
          const quiet = all.length - planned.length
          const outside = day.getMonth() !== month
          return (
            <div
              key={key}
              className={cn(
                'flex min-h-[6.5rem] min-w-0 flex-col gap-0.5 border-b border-l border-border/40 p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0',
                outside && 'bg-bg-elevated/30',
              )}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                className={cn(
                  'mb-0.5 inline-flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-xs font-semibold tabular-nums hover:bg-bg-elevated',
                  key === todayKey ? 'bg-accent text-white hover:bg-accent' : outside ? 'text-text-muted' : 'text-text-heading',
                )}
              >
                {day.getDate()}
              </button>
              {planned.slice(0, VISIBLE).map((item) => {
                const owner = itemOwner(item)
                return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect({ kind: 'item', item })}
                  className={cn(
                    'flex min-w-0 items-center gap-1 rounded px-1 text-left text-2xs hover:bg-bg-elevated',
                    agendaChipState({
                      selected: selectedId === item.id,
                      past: itemStart(item).getTime() < nowMs,
                    }),
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', LAYER_DOT[layerOf(item)])} aria-hidden />
                  <span className="shrink-0 tabular-nums text-text-muted">
                    {item.all_day ? '' : formatAppTime(itemStart(item), i18n.language)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-heading">{item.title}</span>
                  {owner ? <AgendaOwnerMark owner={owner} size={12} /> : null}
                </button>
                )
              })}
              {planned.length > VISIBLE || quiet > 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="px-1 text-left text-2xs text-text-muted hover:text-accent"
                >
                  {planned.length > VISIBLE
                    ? t('agendaPage.grid.more', { count: planned.length - VISIBLE })
                    : t('agendaPage.grid.quiet', { count: quiet })}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
