import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import { formatAppDate, formatAppTime } from '../../lib/app-locale'
import { dayKey, groupByDay, isRoutine, itemOwner, itemStart, layerOf } from '../../lib/agenda-layout'
import { agendaStatusLabel } from '../../lib/status-labels'
import type { TimeItem } from '../../lib/time-items'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { agendaChipState, agendaStatusTone, LAYER_DOT, LAYER_ICON, LAYER_TEXT, isFailed, itemSubtitle } from './agenda-style'
import { AgendaOwnerMark } from './AgendaOwnerMark'
import type { AgendaSelection } from './AgendaTimeGrid'

type Props = {
  days: Date[]
  items: TimeItem[]
  nowMs: number
  landKey: string
  selectedId: string | null
  projectNames: Map<string, string>
  onSelect: (selection: AgendaSelection) => void
}

const QUIET_STATUSES = new Set(['planned', 'calendar', 'completed', 'done', 'ok', 'reported'])
const LAND_EPS = 72

export default function AgendaList({ days, items, nowMs, landKey, selectedId, projectNames, onSelect }: Props) {
  const { t, i18n } = useTranslation('nav')
  const byDay = useMemo(() => groupByDay(items), [items])
  const todayKey = dayKey(new Date(nowMs))
  const [openRoutines, setOpenRoutines] = useState<Set<string>>(new Set())
  const [awayFromLand, setAwayFromLand] = useState(false)
  const [fadeTop, setFadeTop] = useState(false)
  const [fadeBottom, setFadeBottom] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const landedRef = useRef<string | null>(null)
  const visible = useMemo(
    () =>
      days.filter((day) => {
        const key = dayKey(day)
        if (key === todayKey || key === landKey) return true
        return (byDay.get(key) ?? []).some((item) => !isRoutine(item) || isFailed(item.status))
      }),
    [days, byDay, todayKey, landKey],
  )

  const landDelta = useCallback(() => {
    const root = scrollRef.current
    const el = root?.querySelector(`[data-day="${landKey}"]`) as HTMLElement | null
    if (!root || !el || root.clientHeight < 40) return null
    return el.getBoundingClientRect().top - root.getBoundingClientRect().top
  }, [landKey])

  const scrollToLand = useCallback(() => {
    const root = scrollRef.current
    const delta = landDelta()
    if (!root || delta == null) return false
    const firstKey = visible[0] ? dayKey(visible[0]) : null
    if (Math.abs(delta) < 8) {
      if (landKey === firstKey || root.scrollTop > 8) {
        setAwayFromLand(false)
        return true
      }
      return false
    }
    root.scrollTop += delta
    const next = landDelta()
    const ok = next != null && Math.abs(next) < 24
    if (ok) setAwayFromLand(false)
    return ok
  }, [landDelta, landKey, visible])

  const scrollToLandRef = useRef(scrollToLand)
  scrollToLandRef.current = scrollToLand

  const setScroller = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node
    if (node) window.requestAnimationFrame(() => scrollToLandRef.current())
  }, [])

  const measureAway = useCallback(() => {
    const root = scrollRef.current
    const delta = landDelta()
    setAwayFromLand(delta != null && Math.abs(delta) > LAND_EPS)
    if (!root) return
    setFadeTop(root.scrollTop > 4)
    setFadeBottom(root.scrollHeight - root.clientHeight - root.scrollTop > 4)
  }, [landDelta])

  useLayoutEffect(() => {
    landedRef.current = null
    const ids = [0, 50, 150, 400].map((ms) =>
      window.setTimeout(() => {
        if (scrollToLand()) {
          landedRef.current = landKey
          const root = scrollRef.current
          if (root) {
            setFadeTop(root.scrollTop > 4)
            setFadeBottom(root.scrollHeight - root.clientHeight - root.scrollTop > 4)
          }
        }
      }, ms),
    )
    return () => ids.forEach((id) => window.clearTimeout(id))
  }, [landKey, visible.length, scrollToLand])

  if (visible.length === 0) return null

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col" data-testid="agenda-list">
      <div
        className="scroll-fade flex h-full min-h-0 flex-1 flex-col"
        data-fade-top={fadeTop ? 'true' : 'false'}
        data-fade-bottom={fadeBottom ? 'true' : 'false'}
        style={{ '--scroll-fade-color': 'rgb(var(--color-bg))' } as CSSProperties}
      >
        <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto pr-1" onScroll={measureAway}>
        <div className="space-y-5">
          {visible.map((day) => {
            const key = dayKey(day)
            const all = byDay.get(key) ?? []
            const routines = all.filter((item) => isRoutine(item))
            const rows = all.filter((item) => !isRoutine(item))
            const isToday = key === todayKey
            const nowIndex = isToday ? rows.findIndex((item) => itemStart(item).getTime() > nowMs) : -1
            const routinesOpen = openRoutines.has(key)
            return (
              <section key={key} data-day={key} data-today={isToday ? 'true' : undefined} className="scroll-mt-1">
                <h2 className="sticky top-0 z-10 mb-1.5 flex items-baseline gap-2 bg-bg/90 py-1 backdrop-blur-sm">
                  <span className={cn('text-sm font-semibold', isToday ? 'text-accent' : 'text-text-heading')}>
                    {isToday ? t('agendaPage.today') : formatAppDate(day, i18n.language, { weekday: 'long' })}
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatAppDate(day, i18n.language, { day: 'numeric', month: 'long' })}
                  </span>
                </h2>
                <div className="panel divide-y divide-border/40 overflow-hidden">
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
          <div aria-hidden className="h-[70vh]" />
        </div>
        </div>
      </div>
      {awayFromLand ? (
        <button
          type="button"
          onClick={scrollToLand}
          className="absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-bg-surface/95 text-text-heading shadow-sm hover:bg-bg-elevated"
          aria-label={t('agendaPage.list.backToTop')}
          title={t('agendaPage.list.backToTop')}
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
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
  const subtitle = item.kind === 'activity' ? itemSubtitle(item, t) : ''
  const owner = itemOwner(item)
  const showStatus = !QUIET_STATUSES.has(item.status.toLowerCase()) && item.kind !== 'activity'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-bg-elevated/60',
        dense ? 'py-1.5 pl-9 text-xs' : 'py-2 text-sm',
        agendaChipState({
          selected,
          past: past && layer !== 'activity',
          paused: item.enabled === false,
        }),
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
        {!dense && (subtitle || projectName || owner?.name) ? (
          <span className="block truncate text-xs text-text-muted">
            {[subtitle, owner?.name, projectName].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
      {owner ? <AgendaOwnerMark owner={owner} size={dense ? 16 : 20} /> : null}
      {showStatus ? (
        <Badge size="sm" variant={agendaStatusTone(item.status)}>
          {agendaStatusLabel(item.status, t)}
        </Badge>
      ) : null}
    </button>
  )
}
