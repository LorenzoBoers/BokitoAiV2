import { AlertCircle, Archive, ArchiveRestore, ArrowLeft, Bot, Clock, Flag, Forward, Hand, ListPlus, Mail, OctagonAlert, PanelRight, Pin, PinOff, Plus, RefreshCw, Sparkles, Star, Tag, Trash2, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import {
  listInboxMembers,
  type ThreadDetail as ThreadDetailType,
  type PatchThreadInput,
  type InboxMember,
  type ThreadId,
  type MessageAttachment,
} from '../../lib/inbox-api'
import { MessageTimelineItem, EventClusterTimelineItem, formatHourMinute } from './TimelineItem'
import DecisionRequestMessage from './DecisionRequestMessage'
import ReplyComposer from './ReplyComposer'
import AssigneeSelector from './AssigneeSelector'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { formatWakeTime, SNOOZE_PRESETS, snoozeUntilIso } from '../../lib/snooze'
import {
  isInternalThread,
  resolveComposerSurface,
  threadCounterpartyName,
} from '../../lib/message-composer'
import { useSignalStream } from '../../hooks/useSignalStream'
import ThinkingTrace from './ThinkingTrace'
import AgentSessionCard from './AgentSessionCard'
import { draftThreadReply, resolveThreadDecision } from '../../lib/inbox-api'
import { invokeSignalAgent, startAgentSession } from '../../lib/signals-api'
import { bokitoListChatTargets, type ChatTarget } from '../../lib/bokito-api'
import { getAgents, type RuntimeAgent } from '../../lib/workforce-api'
import { stripMentionMarkup, tokenizeMentions, type MentionItem } from '../../lib/mentions'
import { createAgentTask } from '../../lib/orchestration-api'
import { toast } from 'sonner'

type TimelineEntry =
  | { kind: 'message'; time: string; id: string; data: ThreadDetailType['messages'][number] }
  | { kind: 'event'; time: string; id: string; data: ThreadDetailType['events'][number] }
  | { kind: 'session'; time: string; id: string; data: ThreadDetailType['sessions'][number] }

type DayGroup = {
  dayKey: string
  label: string
  entries: TimelineEntry[]
}

// Render item after merging consecutive events into one compact cluster, so
// system/AI activity shows as a single pill row instead of stacked dividers.
type RenderItem =
  | { kind: 'message'; id: string; time: string; entry: Extract<TimelineEntry, { kind: 'message' }> }
  | { kind: 'events'; id: string; time: string; events: ThreadDetailType['events'] }
  | { kind: 'session'; id: string; time: string; session: ThreadDetailType['sessions'][number] }

function clusterEntries(entries: TimelineEntry[]): RenderItem[] {
  const items: RenderItem[] = []
  for (const entry of entries) {
    if (entry.kind === 'event') {
      const last = items[items.length - 1]
      if (last && last.kind === 'events') {
        last.events.push(entry.data)
      } else {
        items.push({ kind: 'events', id: entry.id, time: entry.time, events: [entry.data] })
      }
    } else if (entry.kind === 'session') {
      items.push({ kind: 'session', id: entry.id, time: entry.time, session: entry.data })
    } else {
      items.push({ kind: 'message', id: entry.id, time: entry.time, entry })
    }
  }
  return items
}

type Props = {
  detail: ThreadDetailType | null
  loading: boolean
  /**
   * Non-null when the most recent fetch of the selected thread failed. Used
   * to show explicit feedback in the empty area instead of silently falling
   * back to the "Select a thread" placeholder, which made it look like
   * nothing happened.
   */
  error: string | null
  /**
   * The thread the user has selected via the URL. Used (together with
   * `error`) to show the failure message including the threadId so users
   * can identify which thread failed to load.
   */
  threadId: ThreadId | null
  saving: boolean
  onPatch: (input: PatchThreadInput) => Promise<void>
  onReply: (
    bodyText: string,
    action: 'send' | 'send_and_close' | 'send_and_pending',
    format?: 'email' | 'plain',
    attachments?: MessageAttachment[],
    snoozeMinutes?: number,
    extras?: { cc?: string; bcc?: string },
  ) => Promise<void>
  onNote: (bodyText: string, attachments?: MessageAttachment[]) => Promise<void>
  /** Forward this email thread as a new outbound email (opens compose). */
  onForward?: () => void
  /** Edit an internal note in place. */
  onUpdateNote?: (messageId: string, bodyText: string) => Promise<void>
  /** Delete an internal note from the timeline. */
  onDeleteNote?: (messageId: string) => Promise<void>
  /** Mark the open thread as unread again (return-to-queue workflow). */
  onMarkUnread?: () => void | Promise<void>
  onRefresh: () => void
  onTogglePin?: () => void | Promise<void>
  /** Human takeover toggle for AI-handled channels (email/widget/chat/assistant). */
  onToggleTakeover?: () => void | Promise<void>
  onDelete?: () => void | Promise<void>
  deleting?: boolean
  /** Mobile stacked navigation: return to the thread list (hidden on md+). */
  onBack?: () => void
  onToggleContact?: () => void
  contactOpen?: boolean
  onDecisionResolved?: () => void
  /**
   * Composer behavior: `customer` threads get the reply/note composer,
   * `agent` (internal) threads get a note-only composer with an
   * "Ask assistant" action.
   */
  mode?: 'customer' | 'agent'
  /** Internal threads only: open a standalone assistant chat with context. */
  onAskAssistant?: () => void
}

const HEADER_ICON =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40'

/**
 * "Draft with AI" with an optional guidance field: click opens a small
 * popover where the operator can steer the draft (tone, decisions, facts).
 */
function DraftWithAiButton({
  drafting,
  disabled,
  onDraft,
}: {
  drafting: boolean
  disabled: boolean
  onDraft: (instruction: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const submit = () => {
    setOpen(false)
    onDraft(instruction.trim())
    setInstruction('')
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        size="sm"
        variant="secondary"
        disabled={drafting || disabled}
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        {drafting ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {drafting ? 'Drafting…' : 'Draft with AI'}
      </Button>
      {open ? (
        <div className="absolute bottom-full right-0 z-30 mb-1.5 w-80 rounded-xl border border-border/70 bg-bg-surface p-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)]">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Guidance (optional)
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
              if (e.key === 'Escape') setOpen(false)
            }}
            autoFocus
            rows={2}
            placeholder="e.g. Apologize for the delay and offer a replacement"
            className="mb-2 w-full resize-none rounded-lg border border-border/60 bg-bg-input px-2.5 py-1.5 text-[12.5px] text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 px-2 text-[11.5px]">
              Cancel
            </Button>
            <Button size="sm" onClick={submit} className="h-7 gap-1 px-2.5 text-[11.5px]">
              <Sparkles size={11} />
              Draft reply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * "Ask agent" launcher: pick which agent joins the thread as an inline
 * session. One click when only the personal assistant exists; a dropdown
 * when company agents are available too.
 */
function AgentSessionLauncher({
  threadId,
  disabled,
  onStarted,
}: {
  threadId: string
  disabled: boolean
  onStarted: () => void
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    bokitoListChatTargets(token)
      .then((res) => {
        if (!cancelled) setTargets(res.items)
      })
      .catch(() => {
        // Launcher falls back to the default agent on the backend.
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const start = async (agentId: string | null) => {
    if (!token || starting) return
    setStarting(true)
    try {
      await startAgentSession(token, threadId, agentId)
      onStarted()
    } catch {
      toast.error(t('agentSession.startError'))
    } finally {
      setStarting(false)
    }
  }

  const trigger = (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled || starting}
      className="gap-1.5 text-text-secondary"
      onClick={targets.length <= 1 ? () => void start(targets[0]?.id ?? null) : undefined}
    >
      {starting ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {t('agentSession.launcher')}
    </Button>
  )

  if (targets.length <= 1) return trigger

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {t('agentSession.pickAgent')}
        </p>
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.id}
            className="gap-2 text-xs"
            onSelect={() => void start(target.id)}
          >
            <Bot size={12} className="text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{target.name}</span>
            {target.is_default ? <span className="text-accent">•</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const PRIORITY_META: Record<string, { label: string; dot: string }> = {
  normal: { label: 'Normal', dot: 'bg-text-muted/40' },
  high: { label: 'High', dot: 'bg-status-warning' },
  urgent: { label: 'Urgent', dot: 'bg-status-error' },
}

/**
 * Compact chips row under the thread header: priority selector plus label
 * chips with add/remove. Backed by `PATCH /signals/{id}` (tags, priority).
 */
function ThreadMetaRow({
  tags,
  priority,
  saving,
  onPatch,
}: {
  tags: string[]
  priority: string
  saving: boolean
  onPatch: (input: PatchThreadInput) => Promise<void>
}) {
  const [addingTag, setAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addingTag) inputRef.current?.focus()
  }, [addingTag])

  const commitTag = () => {
    const value = tagInput.trim().toLowerCase()
    setTagInput('')
    setAddingTag(false)
    if (!value || tags.includes(value)) return
    void onPatch({ tags: [...tags, value] })
  }

  const removeTag = (tag: string) => {
    void onPatch({ tags: tags.filter((t) => t !== tag) })
  }

  const priorityMeta = PRIORITY_META[priority] ?? PRIORITY_META.normal

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border/40 bg-bg-surface/60 px-3 py-1 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={saving}
            aria-label="Set priority"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
              priority === 'normal'
                ? 'border-border/50 text-text-muted hover:border-border hover:text-text-secondary'
                : 'border-border/60 bg-bg-surface text-text-secondary hover:text-text-primary'
            }`}
          >
            <Flag size={10} />
            <span className={`h-1.5 w-1.5 rounded-full ${priorityMeta.dot}`} />
            {priorityMeta.label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          {Object.entries(PRIORITY_META).map(([value, meta]) => (
            <DropdownMenuItem
              key={value}
              className="gap-2 text-xs"
              onSelect={() => void onPatch({ priority: value as PatchThreadInput['priority'] })}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
              {value === priority ? <span className="ml-auto text-accent">•</span> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-0.5 h-3 w-px bg-border/50" aria-hidden />

      {tags.map((tag) => (
        <span
          key={tag}
          className="group/tag inline-flex items-center gap-1 rounded-full border border-border/50 bg-bg-surface-hover/50 px-2 py-0.5 text-[11px] text-text-secondary"
        >
          <Tag size={9} className="text-text-muted" />
          {tag}
          <button
            type="button"
            disabled={saving}
            aria-label={`Remove label ${tag}`}
            onClick={() => removeTag(tag)}
            className="-mr-0.5 rounded-full p-0.5 text-text-muted/50 hover:text-status-error transition-colors disabled:opacity-40"
          >
            <X size={9} />
          </button>
        </span>
      ))}

      {addingTag ? (
        <input
          ref={inputRef}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTag()
            }
            if (e.key === 'Escape') {
              setTagInput('')
              setAddingTag(false)
            }
          }}
          onBlur={commitTag}
          placeholder="Label…"
          className="h-5 w-24 rounded-full border border-accent/40 bg-bg-input px-2 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={saving}
          onClick={() => setAddingTag(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/50 px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:border-accent/40 hover:text-text-secondary disabled:opacity-40"
        >
          <Plus size={9} />
          Label
        </button>
      )}
    </div>
  )
}

const DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function makeDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeDayLabel(date: Date): string {
  const now = new Date()
  const todayKey = makeDayKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = makeDayKey(yesterday)
  const key = makeDayKey(date)
  if (key === todayKey) return 'Today'
  if (key === yesterdayKey) return 'Yesterday'
  return DAY_FORMATTER.format(date)
}

function groupByDay(entries: TimelineEntry[]): DayGroup[] {
  const map = new Map<string, DayGroup>()
  for (const entry of entries) {
    const date = new Date(entry.time)
    if (Number.isNaN(date.getTime())) continue
    const key = makeDayKey(date)
    let group = map.get(key)
    if (!group) {
      group = { dayKey: key, label: makeDayLabel(date), entries: [] }
      map.set(key, group)
    }
    group.entries.push(entry)
  }
  return Array.from(map.values())
}

export default function ThreadDetail({ detail, loading, error, threadId, saving, onPatch, onReply, onNote, onForward, onUpdateNote, onDeleteNote, onMarkUnread, onRefresh, onTogglePin, onToggleTakeover, onDelete, deleting = false, onBack, onToggleContact, contactOpen, onDecisionResolved, mode = 'customer', onAskAssistant }: Props) {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const gatewayStream = useSignalStream(threadId ? String(threadId) : null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef<number>(0)
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map())
  // Anchor-to-bottom: when a thread opens we want the timeline to stay pinned
  // to the bottom until the user manually scrolls up. Email iframes finish
  // measuring their height asynchronously, so a one-shot scroll right after
  // open is not enough; a ResizeObserver re-pins on every subsequent growth.
  const anchorToBottomRef = useRef<boolean>(false)
  const programmaticScrollRef = useRef<boolean>(false)
  const [membersById, setMembersById] = useState<Record<number, InboxMember>>({})
  const [activeDayLabel, setActiveDayLabel] = useState<string | null>(null)
  const [composerDraft, setComposerDraft] = useState<{
    body: string
    subject?: string
    key: string
    /** Set when the draft came from a suggestion card; sending resolves that decision. */
    decisionMessageId?: string
  } | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  // Active agents are @-mentionable in notes; a mention invokes the agent on
  // this thread and its answer lands as an internal note.
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  useEffect(() => {
    if (!token) return
    let cancelled = false
    getAgents(token)
      .then((rows) => {
        if (!cancelled) setAgents(rows)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Could not load agents; @agent mentions are unavailable.', {
            id: 'thread-agents-load',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])
  const mentionAgents: MentionItem[] = useMemo(
    () =>
      agents.map((a) => ({
        type: 'agent' as const,
        id: String(a.id),
        name: a.name,
      })),
    [agents],
  )

  useEffect(() => {
    if (!token) return
    let cancelled = false
    listInboxMembers(token)
      .then((members) => {
        if (cancelled) return
        const map: Record<number, InboxMember> = {}
        for (const m of members) {
          map[m.id] = m
        }
        setMembersById(map)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Could not load team members; @mentions may be incomplete.', {
            id: 'thread-members-load',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const messageLayout: 'chat' | 'email' =
    detail && resolveComposerSurface(detail.thread).channel === 'email' ? 'email' : 'chat'

  const groups = useMemo<DayGroup[]>(() => {
    if (!detail) return []
    const timeline: TimelineEntry[] = [
      ...detail.messages.map((m) => ({
        kind: 'message' as const,
        time: m.receivedAt ?? m.createdAt,
        id: `m-${m.id}`,
        data: m,
      })),
      ...detail.events
        .filter(
          (e) =>
            e.eventType !== 'replied' &&
            e.eventType !== 'note_added' &&
            e.eventType !== 'reply_sent' &&
            // The session card itself represents these lifecycle moments.
            e.eventType !== 'agent_session_started' &&
            e.eventType !== 'agent_session_closed',
        )
        .map((e) => ({
          kind: 'event' as const,
          time: e.createdAt,
          id: `e-${e.id}`,
          data: e,
        })),
      ...(detail.sessions ?? []).map((s) => ({
        kind: 'session' as const,
        time: s.startedAt,
        id: `s-${s.id}`,
        data: s,
      })),
    ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    return groupByDay(timeline)
  }, [detail])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = scrollRef.current
    if (!container) return
    programmaticScrollRef.current = true
    const top = Math.max(0, container.scrollHeight - container.clientHeight)
    if (behavior === 'smooth') {
      container.scrollTo({ top, behavior: 'smooth' })
    } else {
      container.scrollTop = top
    }
    window.setTimeout(() => {
      programmaticScrollRef.current = false
    }, 120)
  }, [])

  const pinToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      anchorToBottomRef.current = true
      scrollToBottom(behavior)
    },
    [scrollToBottom],
  )

  const loadedThreadId = detail?.thread.id ?? null
  const messageCount = detail?.messages.length ?? 0

  // Scroll to bottom whenever a thread finishes loading. We engage the anchor
  // flag so the ResizeObserver below keeps re-pinning as email iframes finish
  // measuring their height (often hundreds of ms after the initial render).
  useLayoutEffect(() => {
    if (loading || threadId == null || String(loadedThreadId) !== String(threadId) || groups.length === 0) {
      if (loadedThreadId == null) anchorToBottomRef.current = false
      return
    }

    previousMessageCountRef.current = messageCount
    pinToBottom('auto')

    const raf = window.requestAnimationFrame(() => pinToBottom('auto'))
    const t1 = window.setTimeout(() => pinToBottom('auto'), 0)
    const t2 = window.setTimeout(() => pinToBottom('auto'), 120)
    const t3 = window.setTimeout(() => pinToBottom('auto'), 350)
    const t4 = window.setTimeout(() => pinToBottom('auto'), 700)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.clearTimeout(t4)
    }
  }, [loading, threadId, loadedThreadId, groups.length, messageCount, pinToBottom])

  // Re-pin when timeline content changes while anchored (extra events/messages).
  useLayoutEffect(() => {
    if (!anchorToBottomRef.current || loadedThreadId == null || groups.length === 0) return
    pinToBottom('auto')
  }, [groups, loadedThreadId, pinToBottom])

  // Re-pin to the bottom on any content height growth (iframes loading,
  // images decoding, etc.) for as long as the anchor is engaged.
  useEffect(() => {
    const node = contentRef.current
    if (!node || typeof ResizeObserver === 'undefined' || loadedThreadId == null) return
    const observer = new ResizeObserver(() => {
      if (anchorToBottomRef.current) {
        scrollToBottom('auto')
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadedThreadId, scrollToBottom])

  // Release the anchor as soon as the user scrolls away from the bottom so we
  // don't fight them while they read older messages.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      if (programmaticScrollRef.current) return
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight
      if (distance > 80) {
        anchorToBottomRef.current = false
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [loadedThreadId])

  // Scroll on message-count growth, but only when the user is already near the bottom.
  useEffect(() => {
    if (loadedThreadId == null) return
    const prev = previousMessageCountRef.current
    previousMessageCountRef.current = messageCount
    if (messageCount <= prev) return
    const container = scrollRef.current
    if (!container) {
      scrollToBottom('smooth')
      return
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom < 150) {
      // Re-engage the anchor so iframes growing right after a new message
      // also stay pinned to the bottom.
      anchorToBottomRef.current = true
      scrollToBottom('smooth')
    }
  }, [messageCount, loadedThreadId, scrollToBottom])

  // Track which day group is currently visible at the top of the scroll
  // container so a single fixed bar above the scroll area can show the active
  // day label (no per-group sticky pill).
  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      setActiveDayLabel(null)
      return
    }
    if (groups.length === 0) {
      setActiveDayLabel(null)
      return
    }

    let rafId: number | null = null

    const update = () => {
      rafId = null
      const containerTop = container.getBoundingClientRect().top
      let currentLabel: string | null = groups[0]?.label ?? null
      for (const group of groups) {
        const node = groupRefs.current.get(group.dayKey)
        if (!node) continue
        const top = node.getBoundingClientRect().top - containerTop
        if (top <= 1) {
          currentLabel = group.label
        } else {
          break
        }
      }
      setActiveDayLabel(currentLabel)
    }

    const onScroll = () => {
      if (rafId != null) return
      rafId = window.requestAnimationFrame(update)
    }

    update()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [groups])

  const composerSurface = useMemo(
    () => (detail ? resolveComposerSurface(detail.thread) : null),
    [detail],
  )

  // Email thread whose mailbox was removed: history stays readable, but
  // outbound replies are impossible and must not pretend to work.
  const mailboxDisconnected = Boolean(
    detail &&
      composerSurface?.channel === 'email' &&
      detail.thread.channel === 'email' &&
      detail.thread.emailConnectionId == null,
  )

  useEffect(() => {
    setComposerDraft(null)
    setDraftError(null)
  }, [threadId])

  const myMemberId = useMemo(() => {
    const email = user?.email?.toLowerCase()
    if (!email) return null
    const me = Object.values(membersById).find((m) => m.email?.toLowerCase() === email)
    return me?.id ?? null
  }, [membersById, user?.email])

  const [creatingTask, setCreatingTask] = useState(false)

  const handleCreateTaskFromThread = useCallback(async () => {
    if (!detail || creatingTask) return
    setCreatingTask(true)
    try {
      const task = await createAgentTask({
        title: detail.thread.emailSubject || `Follow up: ${detail.thread.contactName || 'thread'}`,
        description: `Created from communication thread ${detail.thread.id} (${detail.thread.contactEmail || detail.thread.contactName || 'unknown contact'}).`,
        signal_id: String(detail.thread.id),
      })
      toast.success(`Task created: ${task.title}`, {
        description: 'Progress appears in this thread and under Activity.',
      })
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create a task.')
    } finally {
      setCreatingTask(false)
    }
  }, [detail, creatingTask])

  const handleDraftWithAi = useCallback(async (instruction = '') => {
    if (!token || !detail || drafting) return
    setDrafting(true)
    setDraftError(null)
    try {
      const draft = await draftThreadReply(token, detail.thread.id, instruction)
      if (draft) {
        setComposerDraft({ body: draft, key: `ai-draft-${Date.now()}` })
      } else {
        setDraftError('The AI returned an empty draft. Try again.')
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Could not draft a reply.')
    } finally {
      setDrafting(false)
    }
  }, [token, detail, drafting])

  const agentIdsAtStreamStartRef = useRef<Set<string>>(new Set())
  const wasStreamingRef = useRef(false)

  useEffect(() => {
    if (gatewayStream.streaming && !wasStreamingRef.current) {
      agentIdsAtStreamStartRef.current = new Set(
        (detail?.messages ?? [])
          .filter(
            (m) =>
              m.kind === 'agent_message' ||
              Boolean(m.payload?.agent_id) ||
              Boolean(m.agentTrace),
          )
          .map((m) => String(m.id)),
      )
    }
    wasStreamingRef.current = gatewayStream.streaming
  }, [gatewayStream.streaming, detail?.messages])

  // Safety net: once a NEW persisted agent reply lands, force-clear the live
  // ThinkingTrace (covers missed/late gateway stream events).
  useEffect(() => {
    if (!gatewayStream.streaming || !detail?.messages.length) return
    const last = detail.messages[detail.messages.length - 1]
    const isAgent =
      last.kind === 'agent_message' ||
      Boolean(last.payload?.agent_id) ||
      Boolean(last.agentTrace)
    if (!isAgent) return
    if (agentIdsAtStreamStartRef.current.has(String(last.id))) return
    gatewayStream.reset()
  }, [detail?.messages, gatewayStream.streaming, gatewayStream.reset])

  const handleReply = useCallback(
    async (
      bodyText: string,
      action: 'send' | 'send_and_close' | 'send_and_pending',
      attachments?: MessageAttachment[],
      snoozeMinutes?: number,
      extras?: { cc?: string; bcc?: string },
    ) => {
      const pendingDecisionId = composerDraft?.decisionMessageId
      if (pendingDecisionId && token && detail) {
        await resolveThreadDecision(token, detail.thread.id, pendingDecisionId, 'approve', {
          optionId: 'send',
          body: bodyText,
          subject: composerDraft?.subject,
        })
        setComposerDraft(null)
        onDecisionResolved?.()
        if (action === 'send_and_close') {
          await onPatch({ status: 'closed' })
        } else if (action === 'send_and_pending') {
          await onPatch({
            status: 'pending',
            snoozedUntil:
              snoozeMinutes && snoozeMinutes > 0
                ? new Date(Date.now() + snoozeMinutes * 60_000).toISOString()
                : null,
          })
        }
        window.setTimeout(() => scrollToBottom('smooth'), 80)
        return
      }
      const format = composerSurface?.includeSignature ? 'email' : 'plain'
      await onReply(bodyText, action, format, attachments, snoozeMinutes, extras)
      window.setTimeout(() => scrollToBottom('smooth'), 80)
    },
    [
      onReply,
      scrollToBottom,
      composerSurface,
      composerDraft,
      token,
      detail,
      onDecisionResolved,
      onPatch,
    ],
  )

  const handleNote = useCallback(
    async (bodyText: string, attachments?: MessageAttachment[]) => {
      await onNote(bodyText, attachments)
      window.setTimeout(() => scrollToBottom('smooth'), 80)
      // @agent mentions in the note invoke those agents on this thread.
      if (!token || !detail) return
      const mentionedAgentIds = tokenizeMentions(bodyText)
        .filter((t) => t.kind === 'mention' && t.targetType === 'agent')
        .map((t) => (t.kind === 'mention' ? t.id : ''))
      const uniqueIds = [...new Set(mentionedAgentIds.filter(Boolean))]
      if (uniqueIds.length === 0) return
      const instruction = stripMentionMarkup(bodyText)
      for (const agentId of uniqueIds) {
        const agentName = agents.find((a) => String(a.id) === agentId)?.name ?? 'Agent'
        toast.info(`${agentName} is working on this thread...`)
        try {
          await invokeSignalAgent(token, String(detail.thread.id), {
            agentId,
            instruction,
            output: 'note',
          })
          onRefresh()
          window.setTimeout(() => scrollToBottom('smooth'), 120)
        } catch {
          toast.error(`${agentName} could not complete the request.`)
        }
      }
    },
    [onNote, scrollToBottom, token, detail, agents, onRefresh],
  )

  const detailMatchesRoute =
    detail != null && threadId != null && String(detail.thread.id) === String(threadId)

  if (loading || (threadId != null && detail != null && !detailMatchesRoute)) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw size={18} className="animate-spin text-text-muted" />
      </div>
    )
  }

  // The detail fetch failed. Surface the actual error to the user instead
  // of silently showing the "Select a thread" placeholder, which hides
  // backend issues (e.g. runtime errors that previously slipped
  // through unnoticed).
  if (error && threadId != null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertCircle size={28} className="text-status-error" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-heading">
            Thread #{threadId} could not be loaded.
          </p>
          <p className="text-xs text-text-muted max-w-md break-words">{error}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onRefresh} className="gap-1.5">
          <RefreshCw size={13} />
          Try again
        </Button>
      </div>
    )
  }

  if (!detail) {
    // On small screens the list already fills the viewport when nothing is
    // selected, so the placeholder pane only exists from md up.
    return (
      <div className={`${threadId == null ? 'hidden md:flex' : 'flex'} flex-1 items-center justify-center`}>
        <p className="text-sm text-text-muted">Select a thread to view.</p>
      </div>
    )
  }

  const { thread } = detail
  const hasActiveSession = (detail.sessions ?? []).some((s) => s.state === 'active')

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-bg-surface/90 shrink-0 min-h-10">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversations"
            className="md:hidden -ml-1 shrink-0 rounded-md p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-[13px] font-medium text-text-heading truncate">{thread.emailSubject}</h2>
          <p className="text-[11px] text-text-muted truncate">
            {isInternalThread(thread)
              ? `Internal · ${threadCounterpartyName(thread)}`
              : thread.contactEmail || thread.contactName}
          </p>
        </div>
        {detail.csat ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex items-center gap-1 shrink-0 rounded-full border border-border/50 bg-bg-surface-hover/40 px-2 py-0.5 text-[11px] font-medium text-text-primary"
                aria-label={`Customer rating ${detail.csat.score} of 5`}
              >
                <Star size={11} className="text-amber-500 fill-amber-500" />
                {detail.csat.score}/5
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64">
              {detail.csat.comment
                ? `Customer rating - "${detail.csat.comment}"`
                : 'Customer rating'}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <div
          className="flex items-center shrink-0 rounded-lg border border-border/50 bg-bg-surface-hover/30 p-0.5"
          role="toolbar"
          aria-label="Thread actions"
        >
          <AssigneeSelector
            currentAssigneeId={thread.assignedToUserId}
            disabled={saving}
            onChange={(userId) => void onPatch({ assignedToUserId: userId ?? 0 })}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void onPatch({ status: thread.status === 'closed' ? 'open' : 'closed' })
                }
                aria-label={thread.status === 'closed' ? 'Reopen' : 'Close'}
                className={HEADER_ICON}
              >
                {thread.status === 'closed' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {thread.status === 'closed' ? 'Reopen' : 'Close'}
            </TooltipContent>
          </Tooltip>
          {!isInternalThread(thread) ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={thread.status === 'pending' ? 'Snoozed' : 'Snooze'}
                      className={`${HEADER_ICON}${thread.status === 'pending' ? ' text-accent' : ''}`}
                    >
                      <Clock size={14} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {thread.status === 'pending'
                    ? formatWakeTime(thread.snoozedUntil) ?? 'Snoozed until reply'
                    : 'Snooze'}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-52">
                {SNOOZE_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.key}
                    className="text-xs"
                    onSelect={() => void onPatch({ status: 'pending', snoozedUntil: snoozeUntilIso(preset) })}
                  >
                    {preset.label}
                  </DropdownMenuItem>
                ))}
                {thread.status === 'pending' ? (
                  <DropdownMenuItem
                    className="text-xs text-accent"
                    onSelect={() => void onPatch({ status: 'open', snoozedUntil: null })}
                  >
                    Unsnooze now
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {onForward ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={onForward}
                  aria-label="Forward as new email"
                  className={HEADER_ICON}
                >
                  <Forward size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Forward as new email</TooltipContent>
            </Tooltip>
          ) : null}
          {!isInternalThread(thread) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void onPatch({ status: thread.status === 'spam' ? 'open' : 'spam' })
                  }
                  aria-label={thread.status === 'spam' ? 'Not spam' : 'Mark as spam'}
                  className={`${HEADER_ICON}${thread.status === 'spam' ? ' text-status-error' : ''}`}
                >
                  <OctagonAlert size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {thread.status === 'spam' ? 'Not spam' : 'Mark as spam'}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || deleting}
                  onClick={() => void onDelete()}
                  aria-label="Delete"
                  className={`${HEADER_ICON} hover:text-status-error`}
                >
                  <Trash2 size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Delete</TooltipContent>
            </Tooltip>
          ) : null}
          {onMarkUnread && !thread.hasUnread ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void onMarkUnread()}
                  aria-label="Mark as unread"
                  className={HEADER_ICON}
                >
                  <Mail size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Mark as unread</TooltipContent>
            </Tooltip>
          ) : null}
          {onToggleTakeover &&
          ['email', 'widget', 'chat', 'assistant'].includes(thread.channel ?? '') ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void onToggleTakeover()}
                  aria-label={thread.aiPaused ? 'Hand back to AI' : 'Take over from AI'}
                  aria-pressed={thread.aiPaused}
                  className={`${HEADER_ICON}${thread.aiPaused ? ' text-accent' : ''}`}
                >
                  {thread.aiPaused ? <Bot size={14} /> : <Hand size={14} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {thread.aiPaused ? 'Hand back to AI' : 'Take over from AI'}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onTogglePin ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void onTogglePin()}
                  aria-label={thread.isPinned ? 'Unpin thread' : 'Pin thread'}
                  aria-pressed={thread.isPinned}
                  className={`${HEADER_ICON}${thread.isPinned ? ' text-accent' : ''}`}
                >
                  {thread.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {thread.isPinned ? 'Unpin thread' : 'Pin thread'}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onToggleContact ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleContact}
                  aria-label={contactOpen ? 'Hide details' : 'Show details'}
                  aria-pressed={contactOpen}
                  className={`${HEADER_ICON}${contactOpen ? ' text-accent' : ''}`}
                >
                  <PanelRight size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {contactOpen ? 'Hide details' : 'Show details'}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {!isInternalThread(thread) ? (
        <ThreadMetaRow
          tags={thread.tags}
          priority={thread.priority}
          saving={saving}
          onPatch={onPatch}
        />
      ) : null}

      {!isInternalThread(thread) &&
      thread.status !== 'closed' &&
      thread.status !== 'spam' &&
      (thread.suggestedActions?.length ?? 0) > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 bg-bg-surface/60 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Next
          </span>
          {thread.suggestedActions?.includes('close') ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onPatch({ status: 'closed' })}
              className="flex items-center gap-1 rounded-full border border-border/60 bg-bg-surface px-2.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
            >
              <Archive size={11} />
              Close thread
            </button>
          ) : null}
          {thread.suggestedActions?.includes('assign') && !thread.assignedToUserId && myMemberId != null ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onPatch({ assignedToUserId: myMemberId })}
              className="flex items-center gap-1 rounded-full border border-border/60 bg-bg-surface px-2.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
            >
              <UserPlus size={11} />
              Assign to me
            </button>
          ) : null}
          {thread.suggestedActions?.includes('create_task') ? (
            <button
              type="button"
              disabled={creatingTask}
              onClick={() => void handleCreateTaskFromThread()}
              className="flex items-center gap-1 rounded-full border border-border/60 bg-bg-surface px-2.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
            >
              <ListPlus size={11} />
              {creatingTask ? 'Creating…' : 'Create task'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto px-4 py-3"
        >
        <div ref={contentRef} className="mx-auto w-full max-w-[860px]">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-xs text-text-muted">
            <p>No messages in this thread yet.</p>
            <p className="mt-1 text-[11px] opacity-70">
              {thread.channel === 'email'
                ? 'New email will appear after the next mailbox sync.'
                : 'Send a message or wait for the agent to post an update.'}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.dayKey} className="mb-2">
              <div className="sticky top-0 z-20 flex justify-center py-2 pointer-events-none">
                <span className="rounded-full bg-bg-hover/80 backdrop-blur px-3 py-0.5 text-[11px] font-medium text-text-secondary shadow-sm pointer-events-auto">
                  {group.label}
                </span>
              </div>
              {clusterEntries(group.entries).map((item, index, items) => {
                const prevItem = index > 0 ? items[index - 1] : null
                const showTime =
                  item.kind === 'message' &&
                  (!prevItem || formatHourMinute(prevItem.time) !== formatHourMinute(item.time))
                return (
                <div key={item.id} className={item.kind === 'events' ? 'mb-1.5' : 'mb-3'}>
                  {showTime ? (
                    <div className="sticky top-9 z-10 flex justify-center pointer-events-none mb-1">
                      <span className="rounded-full bg-bg-surface/85 backdrop-blur px-2 py-0.5 text-[10px] text-text-muted shadow-sm border border-border/40">
                        {formatHourMinute(item.time)}
                      </span>
                    </div>
                  ) : null}
                  {item.kind === 'session' ? (
                    <AgentSessionCard
                      session={item.session}
                      threadId={String(thread.id)}
                      onChanged={onRefresh}
                      onUseAsReply={(text) => {
                        setComposerDraft({ body: text, key: `session-${Date.now()}` })
                        toast.success(t('agentSession.replyCopied'))
                      }}
                    />
                  ) : item.kind === 'message' ? (
                    item.entry.data.kind === 'decision_request' ? (
                      <DecisionRequestMessage
                        message={item.entry.data}
                        threadId={thread.id}
                        events={detail.events}
                        onResolved={onDecisionResolved}
                        onEditDraft={(draft) => {
                          setComposerDraft({
                            body: draft.body,
                            subject: draft.subject,
                            key: `${draft.decisionMessageId}-${Date.now()}`,
                            decisionMessageId: draft.decisionMessageId,
                          })
                        }}
                      />
                    ) : (
                      <MessageTimelineItem
                        message={item.entry.data}
                        layout={messageLayout}
                        contactName={thread.contactName}
                        contactEmail={thread.contactEmail}
                        contactPhone={thread.contactPhone}
                        agentName={thread.agentName}
                        membersById={membersById}
                        noteActions={
                          onUpdateNote && onDeleteNote
                            ? { onEdit: onUpdateNote, onDelete: onDeleteNote }
                            : undefined
                        }
                      />
                    )
                  ) : (
                    <EventClusterTimelineItem
                      events={item.events}
                      memberNameFor={(userId) =>
                        userId != null ? membersById[userId]?.name : undefined
                      }
                    />
                  )}
                </div>
                )
              })}
            </section>
          ))
        )}
        {gatewayStream.streaming ? (
          <div className="mb-3 flex items-start gap-2.5">
            <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-border/60 bg-bg-elevated text-accent">
              <Bot size={14} />
            </span>
            <ThinkingTrace
              steps={gatewayStream.steps}
              active
              streamText={gatewayStream.streamText}
              thinkingText={gatewayStream.thinkingText}
            />
          </div>
        ) : null}
        </div>
        </div>
        {/* Fade overlay tegen de bovenzijde van het thread inhoud venster.
            Full width, color from the theme (light/dark via --color-bg).
            z-[5] zit onder de dagpil (z-20) en tijdpil (z-10), maar boven de
            statische berichtinhoud, zodat berichten vervagen naar boven toe. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 right-0 h-10 z-[5] bg-gradient-to-b from-bg via-bg/85 to-transparent"
        />
      </div>

      {composerSurface ? (
        <ReplyComposer
          surface={composerSurface}
          onReply={handleReply}
          onNote={handleNote}
          saving={saving}
          disabled={thread.status === 'closed' || thread.status === 'spam'}
          replyDisabledNotice={
            mailboxDisconnected ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <AlertCircle size={13} className="shrink-0 text-status-warning" />
                {t('composer.mailboxDisconnected')}
                <a
                  href="/settings/channels"
                  className="font-medium text-accent hover:underline"
                >
                  {t('composer.reconnectMailbox')}
                </a>
              </span>
            ) : undefined
          }
          draftBody={composerDraft?.body ?? null}
          draftKey={composerDraft?.key ?? null}
          persistKey={String(thread.id)}
          mentionExtras={mentionAgents}
          extraActions={
            onAskAssistant && isInternalThread(thread) ? (
              <Button size="sm" variant="secondary" onClick={onAskAssistant} className="gap-1.5">
                <Sparkles size={12} />
                Ask assistant
              </Button>
            ) : !isInternalThread(thread) ? (
              <div className="flex items-center gap-2">
                {draftError ? (
                  <span className="text-[11px] text-status-error">{draftError}</span>
                ) : null}
                {!hasActiveSession ? (
                  <AgentSessionLauncher
                    threadId={String(thread.id)}
                    disabled={saving}
                    onStarted={() => {
                      onRefresh()
                      window.setTimeout(() => pinToBottom('smooth'), 400)
                    }}
                  />
                ) : null}
                <DraftWithAiButton
                  drafting={drafting}
                  disabled={
                    saving ||
                    thread.status === 'closed' ||
                    thread.status === 'spam' ||
                    mailboxDisconnected
                  }
                  onDraft={(instruction) => void handleDraftWithAi(instruction)}
                />
              </div>
            ) : null
          }
        />
      ) : null}
    </div>
    </TooltipProvider>
  )
}
