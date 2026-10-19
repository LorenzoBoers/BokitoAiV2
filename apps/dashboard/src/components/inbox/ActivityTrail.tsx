import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Brain, Calendar, Check, ChevronDown, ChevronRight, CircleDot, FileText, Globe, Image, List, Mail, Pencil, Plus, Search, Send, Tags, ThumbsUp, Trash2, UserRound, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import {
  formatDuration,
  groupActivity,
  groupLiveLabel,
  groupSummary,
  historyLabel,
  isHandoffTool,
  isKnowledgeTool,
  imageGenerationFrames,
  isVisibleActivity,
  itemDurationMs,
  inviteTarget,
  itemLabel,
  webSearchFavicon,
  webSearchHost,
  type ActivityGroup,
  type ActivityItem,
  type ActivityKind,
  type HistoryView,
  type ImageFrameState,
} from '../../lib/agentActivity'
import { cn } from '../../lib/utils'
import { useAgents } from '../../hooks/useAgents'
import { KnowledgeMark } from '../knowledge/KnowledgeMark'
import { AgentMark } from '../ui/AgentMark'
import { ImageGenerationFrames } from './ImageGenerationFrame'
import { LiveEllipsis, THREAD_ICON, THREAD_META, ThreadMetaRow } from './ThreadMeta'

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

function SiteFavicon({ src, size }: { src: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[2px] object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Web search lead: animated globe, then site favicon when known.
 * Label text (host / "Searching for …") is rendered by the caller.
 */
function WebSearchLead({
  item,
  size = THREAD_ICON,
  live = false,
}: {
  item: ActivityItem
  size?: number
  live?: boolean
}) {
  const running = live || item.status === 'running'
  const favicon = webSearchFavicon(item)
  const host = webSearchHost(item)
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-0.5">
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          running && 'activity-live-icon',
        )}
      >
        <Globe size={size} className="shrink-0" />
      </span>
      {host && favicon ? <SiteFavicon src={favicon} size={size} /> : null}
    </span>
  )
}

const GROUP_ICON_MAX = 6

/** Same mark twice (two list calls, two searches) collapses to one icon. */
function groupIconKey(item: ActivityItem): string {
  const tool = item.tool || ''
  const invited = inviteTarget(item)
  if (invited) return `invite:${invited.id || invited.name || 'person'}`
  if (item.kind === 'think') return 'think'
  if (tool === 'web_search' || tool === 'fetch_url') {
    const host = webSearchHost(item)
    return host ? `web:${host}` : 'web'
  }
  if (tool.startsWith('search_')) return 'search'
  if (tool === 'list_tags' || tool.includes('tag')) return 'tags'
  if (tool.startsWith('list_') || tool.includes('_list_')) return 'list'
  if (tool.startsWith('read_') || tool.startsWith('get_')) return 'file'
  if (tool.startsWith('create_') || tool.startsWith('add_')) return 'plus'
  if (tool.startsWith('update_') || tool.startsWith('set_') || tool.startsWith('write_')) return 'pencil'
  if (tool.startsWith('delete_') || tool.startsWith('cancel_')) return 'trash'
  if (tool.startsWith('send_') || tool.startsWith('post_') || tool.includes('reply')) return 'send'
  if (tool.startsWith('schedule_') || tool.includes('calendar') || tool.includes('trigger')) return 'calendar'
  if (tool.includes('mail') || tool.includes('email')) return 'mail'
  if (tool === 'generate_image') return 'image'
  if (tool === 'react_to_message') return 'react'
  if (item.kind === 'other') return isHandoffTool(tool) ? 'handoff' : 'note'
  if (item.provider) return `provider:${item.provider}`
  if (isKnowledgeTool(tool)) return 'knowledge'
  return 'wrench'
}

function uniqueIconItems(items: ActivityItem[]): ActivityItem[] {
  const seen = new Set<string>()
  const unique: ActivityItem[] = []
  for (const item of items) {
    const key = groupIconKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

/** One icon per kind of action in a group (globe+favicon for web search). */
function GroupIconStrip({
  items,
  size = THREAD_ICON,
  liveLast = false,
}: {
  items: ActivityItem[]
  size?: number
  liveLast?: boolean
}) {
  const unique = uniqueIconItems(items)
  if (!unique.length) return null
  const shown = unique.slice(0, GROUP_ICON_MAX)
  const overflow = unique.length - shown.length
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-0.5">
      {shown.map((item, index) => {
        const live = liveLast && index === shown.length - 1
        if (item.tool === 'web_search' || item.tool === 'fetch_url') {
          return <WebSearchLead key={item.id} item={item} size={size} live={live} />
        }
        return (
          <ActivityIcon
            key={item.id}
            kind={item.kind}
            tool={item.tool}
            provider={item.provider}
            item={item}
            size={size}
            live={live}
          />
        )
      })}
      {overflow > 0 ? (
        <span className="pl-0.5 text-2xs tabular-nums text-text-muted">+{overflow}</span>
      ) : null}
    </span>
  )
}

/** Face of the agent (or person) being invited, instead of a generic wrench. */
function InviteMark({ item, size }: { item: ActivityItem; size: number; live?: boolean }) {
  const { agents } = useAgents()
  const target = inviteTarget(item)
  const agent = target?.id ? agents.find((row) => String(row.id) === target.id) : undefined
  const name = agent?.name || target?.name || ''
  if (!agent && !name) return <UserRound size={size} className="shrink-0" />
  return (
    <AgentMark
        agent={agent ?? { name, id: target?.id }}
      size={size}
      mode="static"
      decorative
    />
  )
}

/** Kind icon: Brain for thinking, the integration logo or a wrench for work. */
export function ActivityIcon({
  kind,
  tool = '',
  provider = '',
  item,
  size = THREAD_ICON,
  live = false,
}: {
  kind: ActivityKind
  tool?: string
  provider?: string
  item?: ActivityItem
  size?: number
  live?: boolean
}) {
  let icon
  if (item && inviteTarget(item)) icon = <InviteMark item={item} size={size} live={live} />
  else if (kind === 'think') icon = <Brain size={size} className="shrink-0" />
  else if (tool === 'web_search' || tool === 'fetch_url' || tool.startsWith('search_')) icon = <Search size={size} className="shrink-0" />
  else if (tool === 'list_tags' || tool.includes('tag')) icon = <Tags size={size} className="shrink-0" />
  else if (tool.startsWith('list_') || tool.includes('_list_')) icon = <List size={size} className="shrink-0" />
  else if (tool.startsWith('read_') || tool.startsWith('get_')) icon = <FileText size={size} className="shrink-0" />
  else if (tool.startsWith('create_') || tool.startsWith('add_')) icon = <Plus size={size} className="shrink-0" />
  else if (tool.startsWith('update_') || tool.startsWith('set_') || tool.startsWith('write_')) icon = <Pencil size={size} className="shrink-0" />
  else if (tool.startsWith('delete_') || tool.startsWith('cancel_')) icon = <Trash2 size={size} className="shrink-0" />
  else if (tool.startsWith('send_') || tool.startsWith('post_') || tool.includes('reply')) icon = <Send size={size} className="shrink-0" />
  else if (tool.startsWith('schedule_') || tool.includes('calendar') || tool.includes('trigger')) icon = <Calendar size={size} className="shrink-0" />
  else if (tool.includes('mail') || tool.includes('email')) icon = <Mail size={size} className="shrink-0" />
  else if (tool === 'generate_image') icon = <Image size={size} className="shrink-0" />
  else if (tool === 'react_to_message') icon = <ThumbsUp size={size} className="shrink-0" />
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

function inviteLine(item: ActivityItem, t: (key: string, opts?: Record<string, unknown>) => string, name: string): string | null {
  if (!inviteTarget(item)) return null
  if (!name) return t('activity.invitingSomeone')
  return t('activity.inviting', { name })
}

function ItemRow({ item }: { item: ActivityItem }) {
  const { t } = useTranslation('communication')
  const { agents } = useAgents()
  const target = inviteTarget(item)
  const invited = target?.id ? agents.find((row) => String(row.id) === target.id) : undefined
  const line = inviteLine(item, t, invited?.name || target?.name || '') ?? itemLabel(item, t)
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
          'flex min-h-7 w-full min-w-0 items-center gap-2 text-left',
          THREAD_META,
          'text-text-secondary',
          detail ? 'hover:text-text-primary' : 'cursor-default',
        )}
      >
        {item.tool === 'web_search' || item.tool === 'fetch_url' ? (
          <WebSearchLead item={item} />
        ) : (
          <ActivityIcon kind={item.kind} tool={item.tool} provider={item.provider} item={item} />
        )}
        <span className="min-w-0 truncate-fade">{line}</span>
        {item.status === 'error' ? (
          <AlertCircle size={THREAD_ICON} className="shrink-0 text-status-error" aria-label={t('activity.failed')} />
        ) : item.status !== 'running' ? (
          <Check size={THREAD_ICON} className="shrink-0 text-status-success" aria-hidden />
        ) : null}
        {duration > 0 ? (
          <span className="ml-auto shrink-0 tabular-nums text-text-muted">
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

/** One status line. A new action pushes the previous one up and out. */
function LiveActionSlot({ rowKey, children }: { rowKey: string; children: ReactNode }) {
  const nodeRef = useRef(children)
  nodeRef.current = children
  const [current, setCurrent] = useState<{ key: string; node: ReactNode }>({ key: rowKey, node: children })
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null)
  useEffect(() => {
    setCurrent((prev) => {
      if (prev.key === rowKey) return { key: rowKey, node: nodeRef.current }
      setLeaving(prev)
      return { key: rowKey, node: nodeRef.current }
    })
  }, [rowKey])
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setLeaving(null), 340)
    return () => window.clearTimeout(timer)
  }, [leaving])
  return (
    <div className="activity-slot">
      {leaving ? (
        <div className="activity-slot-row" data-phase="out">
          {leaving.node}
        </div>
      ) : null}
      <div key={current.key} className="activity-slot-row" data-phase="in">
        {current.key === rowKey ? children : current.node}
      </div>
    </div>
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
 * Live reasoning: the shimmering "Thinking" line is already a toggle, so a
 * long think can be read while it streams. The open panel follows the newest
 * text unless the reader scrolled up in it.
 */
function LiveThinkLine({ group }: { group: ActivityGroup }) {
  const { t } = useTranslation('communication')
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLPreElement>(null)
  const followRef = useRef(true)
  const text = group.items
    .map((i) => (i.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n')

  useLayoutEffect(() => {
    const el = panelRef.current
    if (open && el && followRef.current) el.scrollTop = el.scrollHeight
  }, [open, text])

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!text}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'group flex min-h-7 min-w-0 items-center gap-2 text-left',
          THREAD_META,
          text ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <span className="activity-live-label min-w-0 truncate-fade" role="status" aria-live="polite">
          <span className="thinking-shimmer-text">
            {t('activity.thinking')}
            <LiveEllipsis />
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-text-muted">{formatDuration(group.durationMs)}</span>
        {text ? (
          open ? (
            <ChevronDown size={THREAD_ICON} className="shrink-0 text-text-muted" />
          ) : (
            <ChevronRight size={THREAD_ICON} className="shrink-0 text-text-muted opacity-60 group-hover:opacity-100" />
          )
        ) : null}
      </button>
      {open && text ? (
        <pre
          ref={panelRef}
          onScroll={(e) => {
            const el = e.currentTarget
            followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="mb-1 ml-5 mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-elevated/70 px-2 py-1 text-2xs leading-relaxed text-text-muted"
        >
          {text}
        </pre>
      ) : null}
    </div>
  )
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
  const { agents } = useAgents()
  const [expanded, setExpanded] = useState(false)
  const current = group.items[group.items.length - 1]
  const hasError = group.items.some((i) => i.status === 'error')
  const invited = current ? inviteTarget(current) : null
  const invitedAgent = invited?.id ? agents.find((row) => String(row.id) === invited.id) : undefined
  const liveInvite = current ? inviteLine(current, t, invitedAgent?.name || invited?.name || '') : null

  if (live && group.kind === 'think') {
    return <LiveThinkLine group={group} />
  }

  if (live) {
    const label = liveInvite || groupLiveLabel(group, t)
    return (
      <div key={current?.id} role="status" aria-live="polite">
        <ThreadMetaRow
          live
          icon={
            current ? (
              <ActivityIcon
                kind={current.kind}
                tool={current.tool}
                provider={current.provider}
                item={current}
                live
              />
            ) : undefined
          }
          trailing={group.kind === 'work' && group.items.length > 1 ? group.items.length : undefined}
        >
          {label}
        </ThreadMetaRow>
      </div>
    )
  }

  // A lone note is its own label; expanding would only repeat it.
  if (group.kind === 'other' && group.items.length === 1 && current?.label === 'note') {
    return (
      <ThreadMetaRow icon={<ActivityIcon kind="other" tool={current.tool} />}>
        <span className="whitespace-pre-wrap break-words">{itemLabel(current, t)}</span>
      </ThreadMetaRow>
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
        className="group w-full min-w-0 text-left"
      >
        <ThreadMetaRow
            suffix={
              <>
                <GroupIconStrip items={group.items} />
                {hasError ? <AlertCircle size={THREAD_ICON} className="text-status-error" /> : <Check size={THREAD_ICON} className="text-status-success" />}
                {expanded ? (
                <ChevronDown size={THREAD_ICON} className="opacity-70" />
              ) : (
                <ChevronRight size={THREAD_ICON} className="opacity-0 transition-opacity group-hover:opacity-70" />
              )}
            </>
          }
          className="hover:text-text-primary"
        >
          {groupSummary(group, t)}
        </ThreadMetaRow>
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
 * Activity between two agent bubbles.
 * Live: one sliding status line, then any image frames.
 * Saved: one collapsed tool row for that message, then the frames.
 */
function SavedHistory({
  history,
  items,
  onExpand,
}: {
  history: HistoryView
  items: ActivityItem[]
  onExpand?: () => void
}) {
  const { t } = useTranslation('communication')
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!expanded) onExpand?.()
          setExpanded((open) => !open)
        }}
        aria-expanded={expanded}
        className="group w-full min-w-0 text-left"
      >
        {history.rows.map((row, index) => {
          const tools = row.tools ?? []
          const iconItems: ActivityItem[] = tools.map((tool, toolIndex) => ({
            id: `${tool}:${toolIndex}`,
            kind: row.kind,
            tool,
            label: '',
            provider: '',
            startedAt: null,
            endedAt: null,
            durationMs: null,
            status: 'ok',
          }))
          return (
          <ThreadMetaRow
            key={`${row.kind}:${row.labelKey}:${index}`}
            suffix={
              <>
                {iconItems.length ? <GroupIconStrip items={iconItems} /> : null}
                <Check size={THREAD_ICON} className="text-status-success" />
                {index === history.rows.length - 1 ? (
                expanded ? (
                  <ChevronDown size={THREAD_ICON} className="opacity-70" />
                ) : (
                  <ChevronRight size={THREAD_ICON} className="opacity-0 transition-opacity group-hover:opacity-70" />
                )
              ) : null}
              </>
            }
          >
            {historyLabel(row, t)}
          </ThreadMetaRow>
          )
        })}
      </button>
      {expanded ? (
        <ul className="ml-1.5 mt-0.5 space-y-0.5 border-l border-border/60 pl-3">
          {items.filter(isVisibleActivity).map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
      <ImageGenerationFrames frames={history.frames} />
    </>
  )
}

export default function ActivityTrail({
  items,
  live = false,
  showLine = true,
  holdLabel = null,
  history = null,
  frames: framesFromServer,
  onExpand,
  className,
}: {
  items: ActivityItem[]
  live?: boolean
  /** Live overlay: hide the status line once the reply itself is on screen. */
  showLine?: boolean
  /** Gap with no running tool. Slides into the same slot as the last action. */
  holdLabel?: string | null
  /** Saved summary from the API. When set, the client does not regroup tools. */
  history?: HistoryView | null
  /** Live frames from the turn status. When set, the client does not rebuild them. */
  frames?: ImageFrameState[]
  onExpand?: () => void
  className?: string
}) {
  const { t } = useTranslation('communication')
  const now = useNow(live)
  const visible = items.filter(isVisibleActivity)
  const frames = framesFromServer ?? imageGenerationFrames(visible)
  const groups = groupActivity(
    live ? visible.filter((item) => item.tool !== 'generate_image') : visible,
    now,
  )
  if (!live && groups.length === 0 && frames.length === 0) return null
  const running = visible.filter((item) => item.status === 'running')
  const current = running[running.length - 1] ?? null
  const lineText = holdLabel || (current ? itemLabel(current, t) : '')
  const lineKey = lineText ? `${current?.id ?? 'hold'}:${lineText}` : ''
  const line =
    showLine && lineKey ? (
      <LiveActionSlot rowKey={lineKey}>
        {holdLabel && !current ? (
          <ThreadMetaRow live>{holdLabel}</ThreadMetaRow>
        ) : current ? (
          <ThreadMetaRow
            live
            icon={
              <ActivityIcon
                kind={current.kind}
                tool={current.tool}
                provider={current.provider}
                item={current}
                live
              />
            }
          >
            {lineText}
          </ThreadMetaRow>
        ) : null}
      </LiveActionSlot>
    ) : null
  if (live) {
    if (!line && frames.length === 0) return null
    return (
      <div className={cn('min-w-0 max-w-[85%]', className)}>
        {line}
        <ImageGenerationFrames frames={frames} />
      </div>
    )
  }
  if (history) {
    if (history.rows.length === 0 && history.frames.length === 0) return null
    return (
      <div className={cn('min-w-0 max-w-[85%]', className)}>
        <SavedHistory history={history} items={items} onExpand={onExpand} />
      </div>
    )
  }
  const ordered = groups
  if (ordered.length === 0 && frames.length === 0) return null
  return (
    <div className={cn('min-w-0 max-w-[85%]', className)}>
      {ordered.map((group) => (
        <ActivityGroupLine key={group.key} group={group} onExpand={onExpand} />
      ))}
      <ImageGenerationFrames frames={frames} />
    </div>
  )
}
