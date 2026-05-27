import { AlertCircle, Archive, ArchiveRestore, PanelRight, Pin, PinOff, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

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
  /**
   * Non-null when the most recent fetch of the selected thread failed. Used
   * to show explicit feedback in the empty area instead of silently falling
   * back to the "Selecteer een thread" placeholder, which made it look like
   * nothing happened.
   */
  error: string | null
  /**
   * The thread the user has selected via the URL. Used (together with
   * `error`) to show the failure message including the threadId so users
   * can identify which thread failed to load.
   */
  threadId: number | null
  saving: boolean
  onPatch: (input: PatchThreadInput) => Promise<void>
  onReply: (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => Promise<void>
  onNote: (bodyText: string) => Promise<void>
  onRefresh: () => void
  onTogglePin?: () => void | Promise<void>
  onDelete?: () => void | Promise<void>
  deleting?: boolean
  onToggleContact?: () => void
  contactOpen?: boolean
}

const HEADER_ICON =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40'

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

export default function ThreadDetail({ detail, loading, error, threadId, saving, onPatch, onReply, onNote, onRefresh, onTogglePin, onDelete, deleting = false, onToggleContact, contactOpen }: Props) {
  const { token } = useAuth()
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
    if (loading || threadId == null || loadedThreadId !== threadId || groups.length === 0) {
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

  // The detail fetch failed. Surface the actual error to the user instead
  // of silently showing the "Selecteer een thread" placeholder, which hides
  // backend issues (e.g. the Xano runtime errors that previously slipped
  // through unnoticed).
  if (error && threadId != null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertCircle size={28} className="text-status-error" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-heading">
            Thread #{threadId} kon niet worden geladen.
          </p>
          <p className="text-xs text-text-muted max-w-md break-words">{error}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onRefresh} className="gap-1.5">
          <RefreshCw size={13} />
          Opnieuw proberen
        </Button>
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
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-bg-surface/90 shrink-0 min-h-10">
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-[13px] font-medium text-text-heading truncate">{thread.emailSubject}</h2>
          <p className="text-[11px] text-text-muted truncate">{thread.contactEmail}</p>
        </div>
        <div
          className="flex items-center shrink-0 rounded-lg border border-border/50 bg-bg-surface-hover/30 p-0.5"
          role="toolbar"
          aria-label="Thread acties"
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
                aria-label={thread.status === 'closed' ? 'Heropenen' : 'Sluiten'}
                className={HEADER_ICON}
              >
                {thread.status === 'closed' ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {thread.status === 'closed' ? 'Heropenen' : 'Sluiten'}
            </TooltipContent>
          </Tooltip>
          {onDelete ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || deleting}
                  onClick={() => void onDelete()}
                  aria-label="Verwijderen"
                  className={`${HEADER_ICON} hover:text-status-error`}
                >
                  <Trash2 size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Verwijderen</TooltipContent>
            </Tooltip>
          ) : null}
          {onTogglePin ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={saving || loading}
                  onClick={() => void onTogglePin()}
                  aria-label={thread.isPinned ? 'Pin verwijderen' : 'Pinnen'}
                  aria-pressed={thread.isPinned}
                  className={`${HEADER_ICON}${thread.isPinned ? ' text-accent' : ''}`}
                >
                  {thread.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {thread.isPinned ? 'Pin verwijderen' : 'Pinnen'}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onToggleContact ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleContact}
                  aria-label={contactOpen ? 'Verberg contactpaneel' : 'Contactpaneel'}
                  aria-pressed={contactOpen}
                  className={`${HEADER_ICON}${contactOpen ? ' text-accent' : ''}`}
                >
                  <PanelRight size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {contactOpen ? 'Verberg contactpaneel' : 'Contactpaneel'}
              </TooltipContent>
            </Tooltip>
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
