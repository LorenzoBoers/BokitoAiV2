import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlarmClock,
  Code2,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Webhook,
  Workflow,
} from 'lucide-react'
import { Card } from '../ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import { useEntityRefresh } from '../../lib/live-store'
import { formatAppTime, formatAppWeekdayDayMonth } from '../../lib/app-locale'
import {
  activityIconKind,
  activityWindow,
  clusterTimelineItems,
  formatActivityMoment,
  listTimeItems,
  parseTimelineMs,
  timeItemHref,
  timelinePct,
  type ActivityCluster,
  type ActivityIconKind,
  type TimeItem,
  type TimeWindow,
} from '../../lib/time-items'

type Lane = {
  agentId: string
  agentName: string
  items: TimeItem[]
}

const ICON_BY_KIND: Record<ActivityIconKind, ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  chat: MessageSquare,
  wake: AlarmClock,
  schedule: AlarmClock,
  heartbeat: RefreshCw,
  webhook: Webhook,
  workstream: Workflow,
  queue: ListChecks,
  coding: Code2,
  session: Sparkles,
}

function tickMarks(fromMs: number, toMs: number, nowMs: number): number[] {
  const span = toMs - fromMs
  if (span <= 0) return [nowMs]
  return [fromMs, fromMs + span * 0.25, nowMs, fromMs + span * 0.75, toMs]
}

function formatTick(ms: number, nowMs: number, language: string): string {
  const d = new Date(ms)
  const sameDay =
    d.getFullYear() === new Date(nowMs).getFullYear() &&
    d.getMonth() === new Date(nowMs).getMonth() &&
    d.getDate() === new Date(nowMs).getDate()
  if (sameDay) {
    return formatAppTime(d, language)
  }
  return formatAppWeekdayDayMonth(d, language)
}

function kindLabel(
  item: TimeItem,
  t: (key: string) => string,
): string {
  if (item.kind === 'wake') return t('workforce.agents.timelineWake')
  if (item.status === 'running') return t('workforce.agents.timelineWorking')
  return t('workforce.agents.timelineSession')
}

function ActivityTypeIcon({
  item,
  size = 11,
  className,
}: {
  item: TimeItem
  size?: number
  className?: string
}) {
  const Icon = ICON_BY_KIND[activityIconKind(item)]
  return <Icon size={size} strokeWidth={2} className={cn('block shrink-0', className)} aria-hidden />
}

function MarkerGlyph({ cluster }: { cluster: ActivityCluster }) {
  if (cluster.items.length > 1) {
    return (
      <span className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] font-semibold leading-none tabular-nums">
        {cluster.items.length > 9 ? '9+' : cluster.items.length}
      </span>
    )
  }
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center">
      <ActivityTypeIcon item={cluster.items[0]} size={11} />
    </span>
  )
}

function clusterTone(cluster: ActivityCluster): 'session' | 'wake' | 'mixed' {
  const kinds = new Set(cluster.items.map((item) => item.kind))
  if (kinds.size > 1) return 'mixed'
  return cluster.items[0]?.kind === 'wake' ? 'wake' : 'session'
}

function ClusterMark({
  cluster,
  combined,
  language,
  t,
}: {
  cluster: ActivityCluster
  combined: boolean
  language: string
  t: (key: string) => string
}) {
  const tone = clusterTone(cluster)
  const running = cluster.items.some((item) => item.status === 'running')
  const failed = cluster.items.every((item) => item.status === 'failed')
  const primary = cluster.items[0]
  const singleHref = cluster.items.length === 1 ? timeItemHref(primary) : null
  const aria = cluster.items
    .map((item) => {
      const when = formatActivityMoment(item.start, item.kind === 'wake' ? null : item.end, language)
      return `${item.title}. ${[when.day, when.time].filter(Boolean).join(', ')}`
    })
    .join('. ')

  const markClass = cn(
    'absolute top-1/2 z-[1] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full p-0 leading-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ai [&_svg]:block',
    tone === 'wake' &&
      'border-[1.5px] border-ai bg-bg-surface text-ai-ink hover:bg-ai/15',
    tone === 'session' && 'border border-ai/80 bg-ai text-white hover:brightness-110',
    tone === 'mixed' && 'border border-ai bg-ai/90 text-white hover:brightness-110',
    running && 'shadow-[0_0_10px_rgb(var(--color-ai)/0.55)]',
    failed && 'opacity-50',
  )

  const tipBody = cluster.items.map((item, index) => {
    const when = formatActivityMoment(item.start, item.kind === 'wake' ? null : item.end, language)
    const body = (
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-start gap-1.5 font-medium text-text-primary">
          <ActivityTypeIcon item={item} size={12} className="mt-0.5 text-ai-ink" />
          <span className="min-w-0">{item.title}</span>
        </p>
        {combined ? <p className="pl-[18px] text-text-muted">{item.agent_name}</p> : null}
        <p className="pl-[18px] text-text-muted">{kindLabel(item, t)}</p>
        <p className="pl-[18px] text-text-secondary">{when.day}</p>
        <p className="pl-[18px] text-text-secondary">{when.time}</p>
      </div>
    )
    if (singleHref) {
      return (
        <div key={item.id} className="px-1.5 py-1">
          {body}
        </div>
      )
    }
    return (
      <Link
        key={item.id}
        to={timeItemHref(item)}
        className={cn(
          'block rounded-md px-1.5 py-1 hover:bg-bg-hover/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-ai',
          index > 0 && 'border-t border-border/50',
        )}
      >
        {body}
      </Link>
    )
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {singleHref ? (
          <Link
            to={singleHref}
            className={markClass}
            style={{ left: `${cluster.pct}%` }}
            aria-label={aria}
          >
            <MarkerGlyph cluster={cluster} />
          </Link>
        ) : (
          <button
            type="button"
            className={markClass}
            style={{ left: `${cluster.pct}%` }}
            aria-label={aria}
          >
            <MarkerGlyph cluster={cluster} />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs overflow-hidden p-1 font-normal">
        <div className="max-h-64 space-y-0 overflow-y-auto overscroll-contain pr-0.5">
          {tipBody}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function AgentActivityTimeline({
  agentId,
  agents,
  className,
}: {
  agentId?: string
  agents?: Array<{ id: string; name: string }>
  className?: string
}) {
  const { t, i18n } = useTranslation('nav')
  const [data, setData] = useState<TimeWindow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const combined = !agentId

  const loadSeq = useRef(0)
  const load = useCallback(() => {
    const seq = ++loadSeq.current
    void listTimeItems({ ...activityWindow(), agentId, sources: ['session', 'wake'] })
      .then((row) => {
        if (seq !== loadSeq.current) return
        setData(row)
        setError(null)
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return
        setError(e instanceof Error ? e.message : t('workforce.agents.timelineLoadError'))
      })
  }, [agentId, t])

  useEffect(() => {
    load()
    return () => {
      loadSeq.current += 1
    }
  }, [load])

  useEntityRefresh(['trigger'], load, {
    debounceMs: 800,
    topic: 'runs',
    topicMatch: (event) => event.event === 'agent.run' && Boolean(event.data?.status),
  })

  const fromMs = parseTimelineMs(data?.from)
  const toMs = parseTimelineMs(data?.to)
  const nowMs = parseTimelineMs(data?.now) || Date.now()
  const nowPct = timelinePct(nowMs, fromMs, toMs)

  const lanes = useMemo<Lane[]>(() => {
    const items = data?.items ?? []
    if (!combined) {
      return [
        {
          agentId: agentId ?? '',
          agentName: '',
          items,
        },
      ]
    }
    const byId = new Map<string, Lane>()
    for (const agent of agents ?? []) {
      byId.set(agent.id, { agentId: agent.id, agentName: agent.name, items: [] })
    }
    for (const item of items) {
      const lane = item.agent_id ? byId.get(item.agent_id) : undefined
      if (lane) lane.items.push(item)
    }
    return [...byId.values()]
  }, [agents, agentId, combined, data?.items])

  const ticks = Number.isFinite(fromMs) && Number.isFinite(toMs) ? tickMarks(fromMs, toMs, nowMs) : []
  const language = i18n.language

  return (
    <Card className={cn('overflow-hidden px-4 py-3', className)}>
      <div className="mb-2">
        <p className="text-sm font-medium text-text-heading">{t('workforce.agents.timelineTitle')}</p>
        <p className="text-xs text-text-muted">
          {combined ? t('workforce.agents.timelineCombinedHint') : t('workforce.agents.timelineHint')}
        </p>
      </div>
      {error ? <p className="mb-2 text-xs text-status-error">{error}</p> : null}
      <div className={cn('flex gap-3', combined && 'max-h-[22rem]')}>
        {combined ? (
          <div className="flex w-[6.75rem] shrink-0 flex-col pt-5">
            {lanes.map((lane) => (
              <Link
                key={lane.agentId}
                to={`/agents/${lane.agentId}`}
                className="flex h-8 items-center truncate text-xs font-medium text-text-secondary hover:text-text-heading hover:underline"
                title={lane.agentName}
              >
                {lane.agentName}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <div className="relative mb-1 h-4">
            {ticks.map((ms, index) => {
              const pct = timelinePct(ms, fromMs, toMs)
              const isNow = Math.abs(ms - nowMs) < 60_000
              const edge =
                index === 0 ? 'translate-x-0' : index === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
              return (
                <span
                  key={ms}
                  className={cn(
                    'absolute top-0 whitespace-nowrap text-2xs',
                    edge,
                    isNow ? 'font-medium text-ai-ink' : 'text-text-muted',
                  )}
                  style={{ left: `${pct}%` }}
                >
                  {isNow ? t('workforce.agents.timelineNow') : formatTick(ms, nowMs, language)}
                </span>
              )
            })}
          </div>
          <div className="relative">
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-ai/70"
              style={{ left: `${nowPct}%` }}
            />
            <div
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 text-ai-ink"
              style={{ left: `${nowPct}%` }}
              aria-hidden
            >
              <span className="block h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-current" />
            </div>
            {lanes.map((lane) => {
              const clusters =
                Number.isFinite(fromMs) && Number.isFinite(toMs)
                  ? clusterTimelineItems(lane.items, fromMs, toMs)
                  : []
              return (
                <div key={lane.agentId || 'one'} className="relative h-8">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ai/25" />
                  {clusters.map((cluster) => (
                    <ClusterMark
                      key={cluster.id}
                      cluster={cluster}
                      combined={combined}
                      language={language}
                      t={t}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {!data || (data.items.length === 0 && !combined) ? (
        <p className="mt-2 text-xs text-text-muted">{t('workforce.agents.timelineEmpty')}</p>
      ) : null}
    </Card>
  )
}

export default AgentActivityTimeline
