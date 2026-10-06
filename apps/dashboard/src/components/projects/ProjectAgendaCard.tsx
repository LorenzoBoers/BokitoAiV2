import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CalendarClock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardHeaderActions, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { itemStart, layerOf } from '../../lib/agenda-layout'
import { listTimeItems, timeItemHref, type TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { LAYER_DOT, itemSubtitle } from '../agenda/agenda-style'

const MAX_ROWS = 6

/** What is due and what comes next for this project's tickets and agents. */
export function ProjectAgendaCard({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('nav')
  const [items, setItems] = useState<TimeItem[] | null>(null)
  const [nowMs] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    listTimeItems({
      from: new Date(nowMs - 30 * 86_400_000).toISOString(),
      to: new Date(nowMs + 14 * 86_400_000).toISOString(),
      sources: ['checkup', 'follow_up', 'session'],
      projectId,
    })
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, nowMs])

  const rows = useMemo(() => {
    const list = items ?? []
    const seen = new Set<string>()
    const due = list.filter((item) => {
      if (item.kind === 'session') return false
      if (item.status !== 'due' && itemStart(item).getTime() > nowMs) return false
      const key = item.series_id ?? item.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const upcoming = list
      .filter((item) => {
        if (itemStart(item).getTime() <= nowMs) return false
        const key = item.series_id ?? item.id
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => itemStart(a).getTime() - itemStart(b).getTime())
    return [...due.map((item) => ({ item, due: true })), ...upcoming.map((item) => ({ item, due: false }))].slice(
      0,
      MAX_ROWS,
    )
  }, [items, nowMs])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock size={16} className="shrink-0 text-text-muted" />
          {t('projects.home.agendaTitle')}
        </CardTitle>
        <CardHeaderActions>
          <Button type="button" size="sm" variant="ghost" asChild>
            <Link to={`/agenda?view=list&project=${encodeURIComponent(projectId)}`}>{t('projects.home.agendaOpen')}</Link>
          </Button>
        </CardHeaderActions>
      </CardHeader>
      <CardContent>
        {items == null ? (
          <div className="h-16 animate-pulse rounded-md bg-bg-muted/30" aria-busy="true" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">{t('projects.home.agendaEmpty')}</p>
        ) : (
          <ul className="-mx-1 space-y-0.5">
            {rows.map(({ item, due }) => {
              const start = itemStart(item)
              return (
                <li key={item.id}>
                  <Link
                    to={timeItemHref(item)}
                    className="flex items-start gap-2.5 rounded-md px-1 py-1 hover:bg-bg-hover"
                  >
                    <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', LAYER_DOT[layerOf(item)])} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text-primary">{item.title}</span>
                      <span className="block truncate text-2xs text-text-muted">{itemSubtitle(item, t)}</span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-2xs tabular-nums',
                        due ? 'font-medium text-status-warning' : 'text-text-muted',
                      )}
                    >
                      {due
                        ? t('projects.home.agendaDue')
                        : `${formatAppDate(start, i18n.language, { day: 'numeric', month: 'short' })} ${formatAppTime(start, i18n.language)}`}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
