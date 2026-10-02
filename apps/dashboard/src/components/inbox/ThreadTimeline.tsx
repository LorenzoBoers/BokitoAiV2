/**
 * Virtualized conversation timeline. One flat row list for every thread type
 * (customer, assistant chat, agent run): day pills, time pills, messages,
 * decision cards, agent session cards and merged event clusters are all rows,
 * so react-virtuoso can keep long threads cheap without a second code path.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type {
  InboxEvent,
  InboxMember,
  InboxMessage,
  ReplySendAs,
  ThreadDetail as ThreadDetailType,
  ThreadId,
} from '../../lib/inbox-api'
import type { ChatMessage } from '../../lib/signals-api'
import {
  mergeSessionLiveMessages,
  type SessionStreamState,
} from '../../lib/use-agent-session-chat'
import { assignBubbleStacks, CHAT_COLUMN_CLASS } from '../../lib/chat-layout'
import { cn } from '../../lib/utils'
import { EventClusterTimelineItem, MessageTimelineItem } from './TimelineItem'
import DecisionRequestMessage from './DecisionRequestMessage'
import AgentSessionCard from './AgentSessionCard'
import type { NoteActions } from './TimelineItem'
import type { BubbleStack } from './ChatBubble'

type ThreadSession = ThreadDetailType['sessions'][number]

type TimelineEntry =
  | { kind: 'message'; time: string; id: string; data: InboxMessage }
  | { kind: 'event'; time: string; id: string; data: InboxEvent }
  | { kind: 'session'; time: string; id: string; data: ThreadSession }

export type TimelineRow =
  | { kind: 'day'; id: string; time: string; label: string }
  | { kind: 'message'; id: string; time: string; data: InboxMessage }
  | { kind: 'events'; id: string; time: string; events: InboxEvent[] }
  | { kind: 'session'; id: string; time: string; session: ThreadSession }

/** Events the timeline never shows: a card in the list already says it. */
function isHiddenEvent(eventType: string): boolean {
  return (
    eventType === 'replied' ||
    eventType === 'note_added' ||
    eventType === 'reply_sent' ||
    eventType === 'agent_session_started' ||
    eventType === 'agent_session_closed' ||
    eventType === 'decision_created' ||
    eventType === 'suggestion_created'
  )
}

function makeDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function makeDayLabel(date: Date, t: (key: string) => string, locale?: string): string {
  const now = new Date()
  const todayKey = makeDayKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const key = makeDayKey(date)
  if (key === todayKey) return t('timeline.today')
  if (key === makeDayKey(yesterday)) return t('timeline.yesterday')
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/**
 * Flatten a thread into timeline rows. Consecutive events merge into one
 * cluster so system/AI activity reads as a single pill instead of a stack.
 */
export function buildTimelineRows(
  detail: ThreadDetailType | null,
  t: (key: string) => string,
  locale?: string,
): TimelineRow[] {
  if (!detail) return []
  const entries: TimelineEntry[] = [
    ...detail.messages.map((m) => ({
      kind: 'message' as const,
      time: m.receivedAt ?? m.createdAt,
      id: `m-${m.id}`,
      data: m,
    })),
    ...detail.events
      .filter((e) => !isHiddenEvent(e.eventType))
      .map((e) => ({ kind: 'event' as const, time: e.createdAt, id: `e-${e.id}`, data: e })),
    ...(detail.sessions ?? []).map((s) => ({
      kind: 'session' as const,
      time: s.startedAt,
      id: `s-${s.id}`,
      data: s,
    })),
  ]
    .filter((entry) => !Number.isNaN(new Date(entry.time).getTime()))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  const rows: TimelineRow[] = []
  let dayKey: string | null = null
  for (const entry of entries) {
    const date = new Date(entry.time)
    const key = makeDayKey(date)
    if (key !== dayKey) {
      dayKey = key
      rows.push({ kind: 'day', id: `d-${key}`, time: entry.time, label: makeDayLabel(date, t, locale) })
    }
    if (entry.kind === 'event') {
      const last = rows[rows.length - 1]
      if (last && last.kind === 'events') {
        last.events.push(entry.data)
        continue
      }
      rows.push({ kind: 'events', id: entry.id, time: entry.time, events: [entry.data] })
      continue
    }
    if (entry.kind === 'session') {
      rows.push({ kind: 'session', id: entry.id, time: entry.time, session: entry.data })
      continue
    }
    rows.push({ kind: 'message', id: entry.id, time: entry.time, data: entry.data })
  }
  return rows
}

/**
 * Author + lane key for WhatsApp-style bubble stacking. Notes stay in their
 * own lane so a teammate note does not glue to their customer reply.
 * Decision cards never stack. Anonymous / system rows fall back to kind so
 * consecutive system notes still group.
 */
function messageStackKey(message: InboxMessage): string | null {
  if (message.kind === 'decision_request') return null
  const isAgent =
    message.kind === 'agent_message' ||
    Boolean(message.payload?.agent_id) ||
    Boolean(message.agentTrace) ||
    Boolean(message.hasAgentTrace)
  if (isAgent) {
    const aid =
      typeof message.payload?.agent_id === 'string' && message.payload.agent_id
        ? message.payload.agent_id
        : 'agent'
    return `agent:${aid}`
  }
  const lane = message.direction === 'internal' ? 'note' : message.direction
  if (message.authorUserId != null) return `${lane}:user:${message.authorUserId}`
  const from = (message.fromAddress || '').trim().toLowerCase()
  if (from) return `${lane}:from:${from}`
  return `${lane}:kind:${message.kind || 'message'}`
}

/** Assign start/middle/end/single for consecutive same-author chat bubbles. */
function stacksForRows(rows: TimelineRow[]): Map<string, BubbleStack> {
  return assignBubbleStacks(
    rows.map((row) => ({
      id: row.id,
      key: row.kind === 'message' ? messageStackKey(row.data) : null,
      timeMs: new Date(row.time).getTime(),
      breaksRun: row.kind !== 'message',
    })),
  )
}

export type ThreadTimelineHandle = {
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void
}

type Props = {
  rows: TimelineRow[]
  threadId: ThreadId
  /** Latest message row id; used to pin the initial scroll position. */
  latestMessageRowId: string | null
  language?: string
  messageLayout: 'chat' | 'email'
  membersById: Record<number, InboxMember>
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  agentName?: string | null
  agentId?: string | null
  agentAvatarKind?: string | null
  agentAvatarIcon?: string | null
  agentAvatarColor?: string | null
  agentAvatarImageUrl?: string | null
  events: InboxEvent[]
  noteActions?: NoteActions
  /** Deep-linked card (`?message=`): highlighted and scrolled into view. */
  focusedMessageId: string | null
  hasOlder?: boolean
  loadingOlder?: boolean
  onLoadOlder?: () => void | Promise<void>
  activeSessionId: string | null
  sessionMessages: ChatMessage[] | null
  sessionStream: SessionStreamState
  agentStreaming: boolean
  onRefresh: () => void
  onUseSessionAsReply: (text: string) => void
  onDecisionResolved?: (info?: { closed?: boolean }) => void
  onEditDraft: (draft: {
    body: string
    subject?: string
    decisionMessageId: string
    sendAs?: ReplySendAs
  }) => void
  /** Decision message ids whose draft already sits in the composer. */
  compactDecisionMessageIds: string[]
  /** Live AI strip pinned under the last row while a reply streams. */
  liveTrace?: ReactNode
  emptyState?: ReactNode
  onAtBottomChange?: (atBottom: boolean) => void
}

const ThreadTimeline = forwardRef<ThreadTimelineHandle, Props>(function ThreadTimeline(
  {
    rows,
    threadId,
    latestMessageRowId,
    language,
    messageLayout,
    membersById,
    contactName,
    contactEmail,
    contactPhone,
    agentName,
    agentId,
    agentAvatarKind,
    agentAvatarIcon,
    agentAvatarColor,
    agentAvatarImageUrl,
    events,
    noteActions,
    focusedMessageId,
    hasOlder = false,
    loadingOlder = false,
    onLoadOlder,
    activeSessionId,
    sessionMessages,
    sessionStream,
    agentStreaming,
    onRefresh,
    onUseSessionAsReply,
    onDecisionResolved,
    onEditDraft,
    compactDecisionMessageIds,
    liveTrace,
    emptyState,
    onAtBottomChange,
  },
  ref,
) {
  const { t } = useTranslation('communication')
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const bubbleStacks = useMemo(() => stacksForRows(rows), [rows])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior: 'auto' | 'smooth' = 'auto') => {
        virtuosoRef.current?.scrollToIndex({
          index: Math.max(0, rows.length - 1),
          align: 'end',
          behavior,
        })
      },
    }),
    [rows.length],
  )

  const initialIndex = useMemo(() => {
    if (rows.length === 0) return 0
    const latest = latestMessageRowId ? rows.findIndex((row) => row.id === latestMessageRowId) : -1
    return latest >= 0 ? latest : rows.length - 1
  }, [rows, latestMessageRowId])

  // Deep link from a notification: land on that card instead of the bottom.
  useEffect(() => {
    if (!focusedMessageId) return
    const index = rows.findIndex(
      (row) => row.kind === 'message' && String(row.data.id) === focusedMessageId,
    )
    if (index < 0) return
    const timer = window.setTimeout(
      () => virtuosoRef.current?.scrollToIndex({ index, align: 'center' }),
      60,
    )
    return () => window.clearTimeout(timer)
  }, [focusedMessageId, rows])

  const compact = useMemo(
    () => new Set(compactDecisionMessageIds),
    [compactDecisionMessageIds],
  )

  if (rows.length === 0) {
    // h-full (not flex-1): the parent in ThreadDetail is a sized block box,
    // so flex-1 would collapse to 0 and hide the empty state / live trace.
    return (
      <div className="relative h-full min-h-0">
        <div className="absolute inset-0 overflow-y-auto px-4 py-4">
          <div className={CHAT_COLUMN_CLASS}>
            {emptyState}
            {liveTrace ? <div className="mb-3">{liveTrace}</div> : null}
          </div>
        </div>
      </div>
    )
  }

  const renderRow = (row: TimelineRow) => {
    if (row.kind === 'day') {
      return (
        <div className="flex justify-center pb-3 pt-2">
          <span className="rounded-full bg-bg-elevated/80 px-2.5 py-0.5 text-2xs font-medium text-text-muted backdrop-blur">
            {row.label}
          </span>
        </div>
      )
    }
    if (row.kind === 'events') {
      return (
        <div className="mb-3">
          <EventClusterTimelineItem
            events={row.events}
            memberNameFor={(userId) => (userId != null ? membersById[userId]?.name : undefined)}
          />
        </div>
      )
    }
    if (row.kind === 'session') {
      return (
        <div className="mb-4">
          <AgentSessionCard
            session={row.session}
            threadId={String(threadId)}
            liveMessages={
              row.session.id === activeSessionId
                ? mergeSessionLiveMessages(sessionMessages, sessionStream)
                : undefined
            }
            streaming={row.session.id === activeSessionId && agentStreaming}
            onChanged={onRefresh}
            onUseAsReply={onUseSessionAsReply}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
          />
        </div>
      )
    }
    const message = row.data
    const focused = focusedMessageId != null && String(message.id) === focusedMessageId
    const stack = bubbleStacks.get(row.id) ?? 'single'
    const tightBelow = stack === 'start' || stack === 'middle'
    return (
      <div
        data-message-id={String(message.id)}
        className={cn(
          tightBelow ? 'mb-0.5' : 'mb-4',
          focused && 'rounded-[20px] ring-2 ring-accent/50 ring-offset-4 ring-offset-bg-canvas',
        )}
      >
        {message.kind === 'decision_request' ? (
          <DecisionRequestMessage
            message={message}
            threadId={threadId}
            events={events}
            agentName={agentName}
            agentId={agentId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
            compactReplyProposal={compact.has(String(message.id))}
            onResolved={onDecisionResolved}
            onEditDraft={onEditDraft}
          />
        ) : (
          <MessageTimelineItem
            message={message}
            threadId={threadId}
            layout={messageLayout}
            contactName={contactName}
            contactEmail={contactEmail}
            contactPhone={contactPhone}
            agentName={agentName}
            agentId={agentId}
            agentAvatarKind={agentAvatarKind}
            agentAvatarIcon={agentAvatarIcon}
            agentAvatarColor={agentAvatarColor}
            agentAvatarImageUrl={agentAvatarImageUrl}
            membersById={membersById}
            noteActions={noteActions}
            stack={stack}
          />
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={rows}
        className="absolute inset-0"
        computeItemKey={(_index, row) => row.id}
        initialTopMostItemIndex={{ index: initialIndex, align: 'end' }}
        followOutput="auto"
        atBottomThreshold={120}
        atBottomStateChange={onAtBottomChange}
        // Email bodies render in iframes that measure asynchronously; a
        // generous viewport keeps them mounted so heights stay stable.
        increaseViewportBy={{ top: 1200, bottom: 1200 }}
        startReached={() => {
          if (hasOlder && !loadingOlder && onLoadOlder) void onLoadOlder()
        }}
        components={{
          Header: () =>
            hasOlder && onLoadOlder ? (
              <div className={cn(CHAT_COLUMN_CLASS, 'px-4 pb-3 pt-4')}>
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={loadingOlder}
                    onClick={() => void onLoadOlder()}
                    className="rounded-md border border-border/50 bg-bg-elevated/70 px-3 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                  >
                    {loadingOlder ? t('threadChrome.loadingOlder') : t('threadChrome.loadOlder')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-4" />
            ),
          Footer: () => (
            <div className="px-4 pb-6">
              <div className={CHAT_COLUMN_CLASS}>
                {liveTrace ? <div className="mb-3">{liveTrace}</div> : null}
              </div>
            </div>
          ),
        }}
        itemContent={(_index, row) => (
          <div className="px-4">
            <div className={CHAT_COLUMN_CLASS}>{renderRow(row)}</div>
          </div>
        )}
      />
      {/* Fade at the top so messages recede under the day pill. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-0 z-[5] h-10 bg-gradient-to-b from-bg via-bg/85 to-transparent"
      />
    </div>
  )
})

export default ThreadTimeline
