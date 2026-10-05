import { useEffect, useState } from 'react'
import { AlertCircle, Brain, ChevronDown, ChevronRight, CircleDot, UserRound, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import {
  formatDuration,
  groupActivity,
  groupLiveLabel,
  groupProvider,
  groupSummary,
  isHandoffTool,
  isKnowledgeTool,
  itemDurationMs,
  itemLabel,
  type ActivityGroup,
  type ActivityItem,
  type ActivityKind,
} from '../../lib/agentActivity'
import { cn } from '../../lib/utils'
import { KnowledgeMark } from '../knowledge/KnowledgeMark'

function ProviderLogo({ provider, size }: { provider: string; size: number }) {
  const brand = useIntegrationBrand(provider)
  if (!brand.logoUrl) return <Wrench size={size} className="shrink-0" />
  return (
    <img
      src={brand.logoUrl}
      alt=""
      title={brand.name}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[3px] object-contain"
      loading="lazy"
    />
  )
}

/** Kind icon: Brain for thinking, the integration logo or a wrench for work. */
export function ActivityIcon({
  kind,
  tool = '',
  provider = '',
  size = 13,
  live = false,
}: {
  kind: ActivityKind
  tool?: string
  provider?: string
  size?: number
  live?: boolean
}) {
  let icon
  if (kind === 'think') icon = <Brain size={size} className="shrink-0" />
  else if (kind === 'other') {
    icon = isHandoffTool(tool) ? (
      <UserRound size={size} className="shrink-0" />
    ) : (
      <CircleDot size={size} className="shrink-0" />
    )
  } else if (provider) icon = <ProviderLogo provider={provider} size={size} />
  else if (isKnowledgeTool(tool)) icon = <KnowledgeMark size={size} />
  else icon = <Wrench size={size} className="shrink-0" />
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center', live && 'activity-live-icon')}
    >
      {icon}
    </span>
  )
}

function detailText(value: unknown): string {
  if (value == null) return ''
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return text.length > 600 ? `${text.slice(0, 600)}...` : text
  } catch {
    return String(value)
  }
}

function ItemRow({ item }: { item: ActivityItem }) {
  const { t } = useTranslation('communication')
  const [open, setOpen] = useState(false)
  const detail =
    item.kind === 'think'
      ? (item.text ?? '').trim()
      : [detailText(item.input), detailText(item.result)].filter(Boolean).join('\n\n')
  const duration = itemDurationMs(item)
  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={!detail}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-xs text-text-secondary',
          detail ? 'hover:text-text-primary' : 'cursor-default',
        )}
      >
        <ActivityIcon kind={item.kind} tool={item.tool} provider={item.provider} size={12} />
        <span className="min-w-0 truncate-fade">{itemLabel(item, t)}</span>
        {item.status === 'error' ? (
          <AlertCircle size={11} className="shrink-0 text-status-error" aria-label={t('activity.failed')} />
        ) : null}
        {duration > 0 ? (
          <span className="ml-auto shrink-0 tabular-nums text-2xs text-text-muted">
            {formatDuration(duration)}
          </span>
        ) : null}
      </button>
      {open && detail ? (
        <pre className="mb-1 ml-5 mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-elevated/70 px-2 py-1 text-2xs leading-relaxed text-text-muted">
          {detail}
        </pre>
      ) : null}
    </li>
  )
}

/** Ticks once a second so a running group's duration counts up. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return now
}

/**
 * One group of same-kind actions. Live: a single line with the newest action
 * (each new action replaces the label). Finished: "Worked for 12s · 4 actions",
 * expandable to every action.
 */
export function ActivityGroupLine({
  group,
  live = false,
  onExpand,
}: {
  group: ActivityGroup
  live?: boolean
  /** Saved list payloads carry no tool detail; load it on first expand. */
  onExpand?: () => void
}) {
  const { t } = useTranslation('communication')
  const [expanded, setExpanded] = useState(false)
  const current = group.items[group.items.length - 1]
  const provider = group.kind === 'work' ? groupProvider(group) : ''
  const sharedTool = group.items.every((i) => i.tool === current?.tool) ? current?.tool : ''
  const hasError = group.items.some((i) => i.status === 'error')

  if (live) {
    const label = groupLiveLabel(group, t)
    return (
      <div className="flex min-w-0 items-center gap-2 py-0.5 text-sm" role="status" aria-live="polite">
        <ActivityIcon kind={group.kind} tool={current?.tool} provider={current?.provider} size={14} live />
        <span key={current?.id} className="activity-live-label min-w-0 truncate-fade font-medium thinking-shimmer-text">
          {label}
        </span>
        {group.kind === 'work' && group.items.length > 1 ? (
          <span className="shrink-0 text-2xs tabular-nums text-text-muted">{group.items.length}</span>
        ) : null}
      </div>
    )
  }

  // A lone note is its own label; expanding would only repeat it.
  if (group.kind === 'other' && group.items.length === 1 && current?.label === 'note') {
    return (
      <div className="flex min-w-0 items-start gap-1.5 py-0.5 text-xs text-text-muted">
        <ActivityIcon kind="other" tool={current.tool} size={12} />
        <span className="min-w-0 whitespace-pre-wrap break-words">{itemLabel(current, t)}</span>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => {
          if (!expanded) onExpand?.()
          setExpanded((v) => !v)
        }}
        aria-expanded={expanded}
        className="group flex min-w-0 items-center gap-1.5 py-0.5 text-left text-xs text-text-muted hover:text-text-secondary"
      >
        <ActivityIcon kind={group.kind} tool={sharedTool} provider={provider} size={12} />
        <span className="min-w-0 truncate-fade">{groupSummary(group, t)}</span>
        {hasError ? <AlertCircle size={11} className="shrink-0 text-status-error" /> : null}
        {expanded ? (
          <ChevronDown size={12} className="shrink-0 opacity-70" />
        ) : (
          <ChevronRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
        )}
      </button>
      {expanded ? (
        <ul className="ml-1.5 mt-0.5 space-y-0.5 border-l border-border/60 pl-3">
          {group.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Activity between two agent bubbles. With `live`, the last group is the
 * running line; earlier groups are already collapsed.
 */
export default function ActivityTrail({
  items,
  live = false,
  onExpand,
  className,
}: {
  items: ActivityItem[]
  live?: boolean
  onExpand?: () => void
  className?: string
}) {
  const now = useNow(live)
  const groups = groupActivity(items, now)
  if (groups.length === 0) return null
  return (
    <div className={cn('min-w-0 max-w-[82%] space-y-0.5', className)}>
      {groups.map((group, index) => (
        <ActivityGroupLine
          key={group.key}
          group={group}
          live={live && index === groups.length - 1 && group.running}
          onExpand={onExpand}
        />
      ))}
    </div>
  )
}
