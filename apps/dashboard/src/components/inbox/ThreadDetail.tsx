import { Archive, ChevronDown, MailOpen, PanelRight, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { useAuth } from '../../context/AuthContext'
import {
  listInboxMembers,
  type ThreadDetail as ThreadDetailType,
  type PatchThreadInput,
  type InboxMember,
} from '../../lib/inbox-api'
import { MessageTimelineItem, EventTimelineItem, formatHourMinute } from './TimelineItem'
import ReplyComposer from './ReplyComposer'
import AssigneeSelector from './AssigneeSelector'
import { Button } from '../ui/button'
import { TooltipProvider } from '../ui/tooltip'

type TimelineEntry =
  | { kind: 'message'; time: string; id: string; data: ThreadDetailType['messages'][number] }
  | { kind: 'event'; time: string; id: string; data: ThreadDetailType['events'][number] }

type DayGroup = {
  dayKey: string
  label: string
  entries: TimelineEntry[]
}

type Props = {
  detail: ThreadDetailType | null
  loading: boolean
  saving: boolean
  onPatch: (input: PatchThreadInput) => Promise<void>
  onReply: (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => Promise<void>
  onNote: (bodyText: string) => Promise<void>
  onRefresh: () => void
  onMarkUnread: () => void | Promise<void>
  onToggleContact?: () => void
  contactOpen?: boolean
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'In behandeling' },
  { value: 'closed', label: 'Gesloten' },
  { value: 'spam', label: 'Spam' },
] as const

const STATUS_COLORS: Record<string, string> = {
  open: 'text-status-success',
  pending: 'text-status-warning',
  closed: 'text-text-muted',
  spam: 'text-status-error',
}

const DAY_FORMATTER = new Intl.DateTimeFormat('nl-NL', {
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
  if (key === todayKey) return 'Vandaag'
  if (key === yesterdayKey) return 'Gisteren'
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

export default function ThreadDetail({ detail, loading, saving, onPatch, onReply, onNote, onRefresh, onMarkUnread, onToggleContact, contactOpen }: Props) {
  const { token } = useAuth()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef<number>(0)
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map())
  // Anchor-to-bottom: when a thread opens we want the timeline to stay pinned
  // to the bottom until the user manually scrolls up. Email iframes finish
  // measuring their height asynchronously, so a one-shot scroll right after
  // open is not enough; a ResizeObserver re-pins on every subsequent growth.
  const anchorToBottomRef = useRef<boolean>(false)
  const [membersById, setMembersById] = useState<Record<number, InboxMember>>({})
  const [activeDayLabel, setActiveDayLabel] = useState<string | null>(null)

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
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token])

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
        .filter((e) => e.eventType !== 'replied' && e.eventType !== 'note_added')
        .map((e) => ({
          kind: 'event' as const,
          time: e.createdAt,
          id: `e-${e.id}`,
          data: e,
        })),
    ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    return groupByDay(timeline)
  }, [detail])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = bottomRef.current
    if (!node) return
    node.scrollIntoView({ block: 'end', behavior })
  }, [])

  const threadId = detail?.thread.id ?? null
  const messageCount = detail?.messages.length ?? 0

  // Scroll to bottom whenever a new thread is opened. We engage the anchor
  // flag so the ResizeObserver below keeps re-pinning to the bottom as email
  // iframes finish measuring their height (often a few hundred ms after the
  // initial render).
  useEffect(() => {
    if (threadId == null) {
      anchorToBottomRef.current = false
      return
    }
    previousMessageCountRef.current = messageCount
    anchorToBottomRef.current = true
    const raf = window.requestAnimationFrame(() => scrollToBottom('auto'))
    return () => window.cancelAnimationFrame(raf)
    // Re-run only when switching threads, not on every message update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // Re-pin to the bottom on any content height growth (iframes loading,
  // images decoding, etc.) for as long as the anchor is engaged.
  useEffect(() => {
    const node = contentRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (anchorToBottomRef.current) {
        scrollToBottom('auto')
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [scrollToBottom])

  // Release the anchor as soon as the user scrolls away from the bottom so we
  // don't fight them while they read older messages.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight
      if (distance > 80) {
        anchorToBottomRef.current = false
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll on message-count growth, but only when the user is already near the bottom.
  useEffect(() => {
    if (threadId == null) return
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
  }, [messageCount, threadId, scrollToBottom])

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

  const handleReply = useCallback(
    async (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => {
      await onReply(bodyText, action)
      window.setTimeout(() => scrollToBottom('smooth'), 80)
    },
    [onReply, scrollToBottom],
  )

  const handleNote = useCallback(
    async (bodyText: string) => {
      await onNote(bodyText)
      window.setTimeout(() => scrollToBottom('smooth'), 80)
    },
    [onNote, scrollToBottom],
  )

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw size={18} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-muted">Selecteer een thread om te bekijken.</p>
      </div>
    )
  }

  const { thread } = detail

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/50 bg-bg-surface shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-text-heading truncate">{thread.emailSubject}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-text-secondary truncate">{thread.contactEmail}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AssigneeSelector
            currentAssigneeId={thread.assignedToUserId}
            disabled={saving}
            onChange={(userId) => void onPatch({ assignedToUserId: userId ?? 0 })}
          />
          <div className="relative">
            <select
              value={thread.status}
              disabled={saving}
              onChange={(e) =>
                void onPatch({ status: e.target.value as typeof thread.status })
              }
              className={cn(
                'appearance-none rounded border border-border bg-bg-surface py-0.5 pl-2 pr-6 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50 cursor-pointer',
                STATUS_COLORS[thread.status] ?? 'text-text-primary',
              )}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted" />
          </div>
          {thread.status !== 'closed' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onPatch({ status: 'closed' })}
              disabled={saving}
              title="Sluiten"
            >
              <Archive size={14} />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onPatch({ status: 'open' })}
              disabled={saving}
              title="Heropenen"
            >
              <X size={14} />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onMarkUnread()}
            disabled={saving || loading}
            title="Markeer als ongelezen"
            aria-label="Markeer als ongelezen"
          >
            <MailOpen size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          {onToggleContact ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggleContact}
              title={contactOpen ? 'Verberg contactpaneel' : 'Toon contactpaneel'}
              aria-label={contactOpen ? 'Verberg contactpaneel' : 'Toon contactpaneel'}
              aria-pressed={contactOpen}
              className={contactOpen ? 'text-accent' : ''}
            >
              <PanelRight size={13} />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto px-4 py-3"
        >
        <div ref={contentRef}>
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-xs text-text-muted">
            <p>Geen berichten in deze thread.</p>
            <p className="mt-1 text-[11px] opacity-70">De berichten worden bij de volgende synchronisatie geladen.</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.dayKey} className="mb-2">
              <div className="sticky top-0 z-20 flex justify-center py-2 pointer-events-none">
                <span className="rounded-full bg-bg-hover/80 backdrop-blur px-3 py-0.5 text-[11px] font-medium text-text-secondary shadow-sm pointer-events-auto">
                  {group.label}
                </span>
              </div>
              {group.entries.map((entry) => (
                <div key={entry.id} className="mb-3">
                  <div className="sticky top-9 z-10 flex justify-center pointer-events-none mb-1">
                    <span className="rounded-full bg-bg-surface/85 backdrop-blur px-2 py-0.5 text-[10px] text-text-muted shadow-sm border border-border/40">
                      {formatHourMinute(entry.time)}
                    </span>
                  </div>
                  {entry.kind === 'message' ? (
                    <MessageTimelineItem
                      message={entry.data}
                      contactName={thread.contactName}
                      contactEmail={thread.contactEmail}
                      contactPhone={thread.contactPhone}
                      membersById={membersById}
                    />
                  ) : (
                    <EventTimelineItem
                      event={entry.data}
                      memberName={
                        entry.data.actorUserId != null ? membersById[entry.data.actorUserId]?.name : undefined
                      }
                    />
                  )}
                </div>
              ))}
            </section>
          ))
        )}
        <div ref={bottomRef} />
        </div>
        </div>
        {/* Fade overlay tegen de bovenzijde van het thread inhoud venster.
            Volledige breedte, kleur uit het thema (light/dark via --color-bg).
            z-[5] zit onder de dagpil (z-20) en tijdpil (z-10), maar boven de
            statische berichtinhoud, zodat berichten vervagen naar boven toe. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 right-0 h-10 z-[5] bg-gradient-to-b from-bg via-bg/85 to-transparent"
        />
      </div>

      <ReplyComposer
        onReply={handleReply}
        onNote={handleNote}
        saving={saving}
        disabled={thread.status === 'closed' || thread.status === 'spam'}
      />
    </div>
    </TooltipProvider>
  )
}
