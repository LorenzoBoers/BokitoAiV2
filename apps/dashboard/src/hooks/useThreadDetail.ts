import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent, onGatewayStatus, type GatewayStatus } from '../lib/gateway'
import {
  extractLiveMessage,
  extractLiveThreadRow,
  mergeThreadRow,
  upsertLiveMessage,
} from '../lib/thread-live'
import type { AiHandling, AiHandlingMode } from '../lib/ai-handling'
import { setAiHandling } from '../lib/ai-handling-api'
import {
  getThread,
  patchThread,
  replyToThread,
  addNoteToThread,
  updateThreadNote,
  deleteThreadNote,
  markThreadRead,
  markThreadUnread,
  pinThread,
  unpinThread,
  type ThreadDetail,
  type PatchThreadInput,
  type ReplyInput,
  type ThreadId,
} from '../lib/inbox-api'
import {
  buildOptimisticOutbound,
  dropMatchedLocals,
  keepPendingLocals,
  patchLocalSendStatus,
  readOptimisticReply,
  replaceLocalWithServer,
} from '../lib/optimistic-outbound'
import { trailingUnreadInboundIds } from '../components/inbox/ThreadTimeline'

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPlainReplyHtml(bodyText: string): string {
  const text = bodyText.trim()
  const content = escapeHtml(text).replace(/\n/g, '<br/>')
  return `<div>${content || '&nbsp;'}</div>`
}

function buildEmailReplyHtml(bodyText: string, signatureImageUrl: string): string {
  const text = bodyText.trim()
  const content = escapeHtml(text).replace(/\n/g, '<br/>')
  const safeUrl = escapeHtml(signatureImageUrl)
  return [
    `<div>${content || '&nbsp;'}</div>`,
    '<div style="margin-top:16px;">',
    `<img src="${safeUrl}" alt="Signature" style="display:block;max-width:260px;height:auto;" />`,
    '</div>',
  ].join('')
}

export function useThreadDetail(
  threadId: ThreadId | null,
  pinnedIds: ThreadId[] = [],
  options?: { skipMarkRead?: boolean },
) {
  const { token, user } = useAuth()
  const [rawDetail, setRawDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Inbound message ids briefly highlighted after opening an unread thread. */
  const [unreadHighlightIds, setUnreadHighlightIds] = useState<string[]>([])
  // Bumps whenever the open thread changes (or a new fetch starts) so in-flight
  // responses for a previous thread cannot overwrite the current detail pane.
  const fetchGeneration = useRef(0)
  const unreadHighlightTimer = useRef<number | null>(null)

  // Drop the previous conversation before paint when the route thread changes,
  // otherwise one frame still renders the old detail under the new URL.
  useLayoutEffect(() => {
    fetchGeneration.current += 1
    setRawDetail(null)
    setError(null)
    setUnreadHighlightIds([])
    if (unreadHighlightTimer.current != null) {
      window.clearTimeout(unreadHighlightTimer.current)
      unreadHighlightTimer.current = null
    }
    setLoading(Boolean(token && threadId))
  }, [token, threadId])

  // `quiet` reloads (gateway-driven and post-reply reconciles) skip the loading
  // spinner and never clear the thread on transient errors, so live updates
  // never flicker the open conversation. Quiet refetch replaces the newest
  // window but keeps any older pages the operator already loaded.
  const fetchDetail = useCallback(
    async (quiet = false) => {
      if (!token || !threadId) {
        fetchGeneration.current += 1
        setRawDetail(null)
        setError(null)
        setLoading(false)
        return
      }
      const generation = ++fetchGeneration.current
      if (!quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        const result = await getThread(token, threadId, { limit: 80 })
        if (generation !== fetchGeneration.current) return
        const applyResult = (next: ThreadDetail | null) => {
          if (!next) {
            setRawDetail(null)
            return
          }
          if (quiet) {
            setRawDetail((prev) => {
              if (!prev || String(prev.thread.id) !== String(next.thread.id)) return next
              const freshIds = new Set(next.messages.map((m) => String(m.id)))
              const oldestFreshAt = next.messages[0]?.createdAt ?? next.messages[0]?.receivedAt
              const keepOlder = oldestFreshAt
                ? prev.messages.filter((m) => {
                    if (freshIds.has(String(m.id))) return false
                    const at = m.createdAt ?? m.receivedAt
                    return Boolean(at && at < oldestFreshAt)
                  })
                : []
              const eventIds = new Set(next.events.map((e) => String(e.id)))
              const keepOlderEvents = oldestFreshAt
                ? prev.events.filter((e) => {
                    if (eventIds.has(String(e.id))) return false
                    return Boolean(e.createdAt && e.createdAt < oldestFreshAt)
                  })
                : []
              const mergedMsgs = keepPendingLocals(prev.messages, [
                ...keepOlder,
                ...next.messages,
              ])
              return {
                ...next,
                messages: mergedMsgs,
                events: [...keepOlderEvents, ...next.events],
                hasOlder: keepOlder.length > 0 ? prev.hasOlder : next.hasOlder,
                oldestMessageId:
                  keepOlder[0] != null
                    ? String(keepOlder[0].id)
                    : next.oldestMessageId,
              }
            })
            return
          }
          setRawDetail(next)
        }
        // Auto-mark as read when a thread is opened. The server call is
        // fire-and-forget so the UI never blocks on it; the local state already
        // reflects the read status. If the request fails the next list poll
        // will reconcile.
        if (result && result.thread.hasUnread && !options?.skipMarkRead) {
          if (!quiet) {
            const ids = trailingUnreadInboundIds(result.messages)
            setUnreadHighlightIds(ids)
            if (unreadHighlightTimer.current != null) {
              window.clearTimeout(unreadHighlightTimer.current)
            }
            unreadHighlightTimer.current = window.setTimeout(() => {
              setUnreadHighlightIds([])
              unreadHighlightTimer.current = null
            }, 2600)
          }
          applyResult({ ...result, thread: { ...result.thread, hasUnread: false } })
          void markThreadRead(token, threadId).catch(() => {})
        } else {
          applyResult(result)
        }
      } catch (err) {
        if (generation !== fetchGeneration.current) return
        if (!quiet) {
          setError(err instanceof Error ? err.message : 'THREAD_LOAD_FAILED')
          setRawDetail(null)
        }
      } finally {
        if (!quiet && generation === fetchGeneration.current) setLoading(false)
      }
    },
    [token, threadId, options?.skipMarkRead],
  )

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  // Mirror the loaded detail so the gateway handler can dedupe without
  // resubscribing on every state change.
  const detailRef = useRef<ThreadDetail | null>(null)
  useEffect(() => {
    detailRef.current = rawDetail
  }, [rawDetail])

  // Live updates for the open thread, published on the `signal:{id}` topic.
  // `message` events carry the full serialized message and are appended
  // directly; `thread` events patch the row. Everything else falls back to a
  // debounced quiet refetch so triage bursts do not reload the newest 80
  // messages on every event. Skip high-frequency stream events — those only
  // drive the live agent turn.
  useEffect(() => {
    if (!token || !threadId) return
    let quietTimer: number | null = null
    const scheduleQuietRefetch = () => {
      if (quietTimer != null) window.clearTimeout(quietTimer)
      quietTimer = window.setTimeout(() => {
        quietTimer = null
        void fetchDetail(true)
      }, 400)
    }
    const unsub = onGatewayEvent(`signal:${threadId}`, (event) => {
      if (
        event.event === 'message.delta' ||
        event.event === 'agent.thinking' ||
        event.event === 'agent.step' ||
        event.event === 'agent.activity' ||
        event.event === 'agent.turn'
      ) {
        return
      }
      if (event.event === 'thread') {
        const threadRow = extractLiveThreadRow(event)
        if (threadRow && String(threadRow.id) === String(threadId)) {
          const before = detailRef.current?.thread.ticket
          const after = threadRow.ticket
          setRawDetail((prev) => {
            if (!prev || String(prev.thread.id) !== String(threadId)) return prev
            return { ...prev, thread: mergeThreadRow(prev.thread, threadRow) }
          })
          // A category or stage change also wrote a timeline event.
          if (
            after !== undefined &&
            `${before?.tagId}|${before?.status}|${before?.stage?.key}|${before?.projectId}` !==
              `${after?.tagId}|${after?.status}|${after?.stage?.key}|${after?.projectId}`
          ) {
            scheduleQuietRefetch()
          }
          return
        }
      }
      if (event.event === 'message') {
        const msg = extractLiveMessage(event)
        const current = detailRef.current
        // Decision cards need the options payload; when the event lacks it
        // the refetch pulls the full card.
        const missingDecision =
          msg?.kind === 'decision_request' && !(msg.payload && 'decision' in msg.payload)
        if (
          msg &&
          !missingDecision &&
          current &&
          String(current.thread.id) === String(threadId) &&
          String(msg.threadId) === String(threadId)
        ) {
          const threadRow = extractLiveThreadRow(event)
          const already = current.messages.some((m) => String(m.id) === String(msg.id))
          setRawDetail((prev) => {
            if (!prev || String(prev.thread.id) !== String(msg.threadId)) return prev
            const withLive = upsertLiveMessage(prev.messages, msg)
            return {
              ...prev,
              messages: dropMatchedLocals(withLive, msg),
              thread: {
                ...prev.thread,
                lastMessageAt: msg.receivedAt ?? msg.createdAt ?? prev.thread.lastMessageAt,
                status: threadRow?.status ?? prev.thread.status,
                // New messages: mirror the refetch path (auto-mark read).
                // Updates to an existing row (e.g. send_status) keep unread as-is.
                hasUnread: already ? prev.thread.hasUnread : false,
              },
            }
          })
          if (!already && threadRow?.hasUnread) {
            void markThreadRead(token, threadId).catch(() => {})
          }
          return
        }
      }
      scheduleQuietRefetch()
    })
    return () => {
      unsub()
      if (quietTimer != null) window.clearTimeout(quietTimer)
    }
  }, [token, threadId, fetchDetail])

  // Quiet reconcile after tab focus and gateway reconnect (same pattern as useThreads).
  useEffect(() => {
    if (!token || !threadId) return
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchDetail(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [token, threadId, fetchDetail])

  useEffect(() => {
    if (!token || !threadId) return
    let sawDisconnect = false
    const unsubscribe = onGatewayStatus((status: GatewayStatus) => {
      if (status === 'disconnected') {
        sawDisconnect = true
      } else if (status === 'connected' && sawDisconnect) {
        sawDisconnect = false
        void fetchDetail(true)
      }
    })
    return () => unsubscribe()
  }, [token, threadId, fetchDetail])

  // Derive isPinned client-side from the shared pinnedIds list. The detail
  // endpoint deliberately does NOT include is_pinned to keep its payload
  // simple; the dashboard joins state here.
  const detail = useMemo<ThreadDetail | null>(() => {
    if (!rawDetail) return null
    const isPinned = pinnedIds.some((id) => String(id) === String(rawDetail.thread.id))
    if (rawDetail.thread.isPinned === isPinned) return rawDetail
    return { ...rawDetail, thread: { ...rawDetail.thread, isPinned } }
  }, [rawDetail, pinnedIds])

  const patch = useCallback(
    async (input: PatchThreadInput) => {
      if (!token || !threadId) return
      setSaving(true)
      try {
        const updated = await patchThread(token, threadId, input)
        if (updated) {
          setRawDetail((prev) => (prev ? { ...prev, thread: updated } : prev))
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error('Could not update thread.')
      } finally {
        setSaving(false)
      }
    },
    [token, threadId],
  )

  const reply = useCallback(
    async (input: ReplyInput) => {
      if (!token || !threadId) return
      // Email replies: body only. The API appends the operator/mailbox
      // signature server-side. Never inject tenant logo or the Bokito mark —
      // that produced a huge unsolicited logo under every send.
      let bodyHtml = input.bodyHtml?.trim() ? input.bodyHtml : undefined
      if (!bodyHtml) {
        const signatureImageUrl = user?.signatureUrl?.trim()
        bodyHtml =
          input.format === 'email' && signatureImageUrl
            ? buildEmailReplyHtml(input.bodyText, signatureImageUrl)
            : buildPlainReplyHtml(input.bodyText)
      }
      const optimistic = buildOptimisticOutbound({
        threadId: String(threadId),
        bodyText: input.bodyText,
        bodyHtml,
        authorUserId: user?.id ?? null,
        attachments: input.attachments,
        extras: {
          format: input.format,
          cc: input.cc,
          bcc: input.bcc,
          channelAccountId: input.channelAccountId,
          to: input.to,
          mode: input.mode,
          sourceMessageId: input.sourceMessageId,
          subject: input.subject,
          quotedHtml: input.quotedHtml,
          sendAfterSeconds: input.sendAfterSeconds,
          action: input.action ?? 'send',
          snoozeMinutes: input.snoozeMinutes,
        },
      })
      // Show the bubble immediately; delivery can take seconds (WhatsApp / mail).
      setRawDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          messages: [...prev.messages, optimistic],
          thread: {
            ...prev.thread,
            lastMessageAt: optimistic.receivedAt ?? prev.thread.lastMessageAt,
          },
        }
      })
      try {
        const msg = await replyToThread(token, threadId, { ...input, bodyHtml })
        if (msg) {
          setRawDetail((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              messages: replaceLocalWithServer(prev.messages, String(optimistic.id), msg),
              thread: {
                ...prev.thread,
                lastMessageAt: msg.receivedAt ?? prev.thread.lastMessageAt,
                status:
                  input.action === 'send_and_close'
                    ? 'closed'
                    : input.action === 'send_and_pending'
                      ? 'pending'
                      : prev.thread.status,
              },
            }
          })
        } else {
          setRawDetail((prev) =>
            prev
              ? {
                  ...prev,
                  messages: patchLocalSendStatus(
                    prev.messages,
                    String(optimistic.id),
                    'failed:network',
                  ),
                }
              : prev,
          )
        }
        // Prefer gateway `message` events for the assistant follow-up. Avoid
        // a full quiet refetch on every send (was blocking the UI feel).
        return msg
      } catch (err) {
        setRawDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: patchLocalSendStatus(
                  prev.messages,
                  String(optimistic.id),
                  'failed:network',
                ),
              }
            : prev,
        )
        throw err instanceof Error ? err : new Error('Could not send message.')
      }
    },
    [token, threadId, user?.signatureUrl, user?.id],
  )

  /** Re-deliver a failed outbound bubble (optimistic or server `failed:*`). */
  const retryFailedSend = useCallback(
    async (messageId: string) => {
      if (!token || !threadId) return
      const current = detailRef.current
      const failed = current?.messages.find((m) => String(m.id) === String(messageId))
      if (!failed) return
      if (!(typeof failed.sendStatus === 'string' && failed.sendStatus.startsWith('failed'))) {
        return
      }
      const stashed = readOptimisticReply(failed)
      const bodyText = (stashed?.bodyText ?? failed.bodyText ?? '').trim()
      if (!bodyText && !(stashed?.attachments?.length || failed.attachments?.length)) return
      setRawDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: patchLocalSendStatus(prev.messages, String(messageId), 'sending'),
            }
          : prev,
      )
      try {
        const msg = await replyToThread(token, threadId, {
          bodyText: bodyText || ' ',
          bodyHtml: stashed?.bodyHtml ?? failed.bodyHtml ?? undefined,
          action: 'send',
          attachments: stashed?.attachments ?? (failed.attachments as ReplyInput['attachments']),
          format: stashed?.format,
          cc: stashed?.cc ?? failed.cc ?? undefined,
          bcc: stashed?.bcc ?? failed.bcc ?? undefined,
          channelAccountId: stashed?.channelAccountId,
          to: stashed?.to,
          mode: stashed?.mode ?? (failed.replyMode as ReplyInput['mode']),
          sourceMessageId: stashed?.sourceMessageId,
          subject: stashed?.subject ?? failed.subject,
          quotedHtml: stashed?.quotedHtml,
          sendAfterSeconds: stashed?.sendAfterSeconds,
        })
        if (msg) {
          setRawDetail((prev) =>
            prev
              ? {
                  ...prev,
                  messages: replaceLocalWithServer(prev.messages, String(messageId), msg),
                  thread: {
                    ...prev.thread,
                    lastMessageAt: msg.receivedAt ?? prev.thread.lastMessageAt,
                  },
                }
              : prev,
          )
        } else {
          setRawDetail((prev) =>
            prev
              ? {
                  ...prev,
                  messages: patchLocalSendStatus(prev.messages, String(messageId), 'failed:network'),
                }
              : prev,
          )
        }
      } catch {
        setRawDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: patchLocalSendStatus(prev.messages, String(messageId), 'failed:network'),
              }
            : prev,
        )
      }
    },
    [token, threadId],
  )

  const addNote = useCallback(
    async (bodyText: string, attachments?: ReplyInput['attachments']) => {
      if (!token || !threadId) return
      setSaving(true)
      try {
        const msg = await addNoteToThread(token, threadId, bodyText, attachments)
        if (msg) {
          setRawDetail((prev) => {
            if (!prev) return prev
            // Gateway may have already delivered this note while the HTTP
            // request was in flight — never append a duplicate.
            const already = prev.messages.some((m) => String(m.id) === String(msg.id))
            return already ? prev : { ...prev, messages: [...prev.messages, msg] }
          })
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error('Could not save note.')
      } finally {
        setSaving(false)
      }
    },
    [token, threadId],
  )

  // Edit an internal note in place; local timeline updates immediately.
  const updateNote = useCallback(
    async (messageId: string, bodyText: string) => {
      if (!token || !threadId) return
      const updated = await updateThreadNote(token, threadId, messageId, bodyText)
      if (updated) {
        setRawDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  String(m.id) === String(messageId) ? { ...m, ...updated } : m,
                ),
              }
            : prev,
        )
      }
    },
    [token, threadId],
  )

  // Remove an internal note from the thread timeline.
  const deleteNote = useCallback(
    async (messageId: string) => {
      if (!token || !threadId) return
      await deleteThreadNote(token, threadId, messageId)
      setRawDetail((prev) =>
        prev
          ? { ...prev, messages: prev.messages.filter((m) => String(m.id) !== String(messageId)) }
          : prev,
      )
    },
    [token, threadId],
  )

  // Manually mark the open thread as unread (mirrors HelpScout / Intercom).
  // Updates local state immediately, then persists to the server.
  const markUnread = useCallback(async () => {
    if (!token || !threadId) return
    setRawDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, hasUnread: true } } : prev))
    try {
      await markThreadUnread(token, threadId)
    } catch {
      setRawDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, hasUnread: false } } : prev))
      throw new Error('MARK_UNREAD_FAILED')
    }
  }, [token, threadId])

  // Server-side toggle of the pin state. The caller is responsible for
  // updating the shared `pinnedIds` list (via usePinnedIds) so that the
  // thread list and the detail view stay in sync. We return the next state
  // so the caller can do an optimistic addPin/removePin before awaiting.
  const togglePin = useCallback(
    async (currentPinned: boolean): Promise<boolean> => {
      if (!token || !threadId) return currentPinned
      const next = !currentPinned
      try {
        if (next) {
          await pinThread(token, threadId)
        } else {
          await unpinThread(token, threadId)
        }
        return next
      } catch {
        throw new Error(next ? 'PIN_FAILED' : 'UNPIN_FAILED')
      }
    },
    [token, threadId],
  )

  // Conversation AI handling. Take over = manual + assign to me; hand back =
  // clear the override (mode null), which also unassigns. Assignment changes
  // come back on the live thread row, so a quiet refetch follows those.
  const changeAiHandling = useCallback(
    async (
      mode: AiHandlingMode | null,
      opts: { assignToMe?: boolean; reason?: string } = {},
    ): Promise<AiHandling | null> => {
      if (!token || !threadId) return null
      const next = await setAiHandling(token, 'conversation', String(threadId), mode, opts)
      setRawDetail((prev) =>
        prev ? { ...prev, thread: { ...prev.thread, aiHandling: next } } : prev,
      )
      if (opts.assignToMe || mode === null) void fetchDetail(true)
      return next
    },
    [token, threadId, fetchDetail],
  )

  const loadOlder = useCallback(async () => {
    if (!token || !threadId || loadingOlder) return
    const cursor =
      rawDetail?.oldestMessageId ||
      (rawDetail?.messages[0] ? String(rawDetail.messages[0].id) : null)
    if (!cursor || !rawDetail?.hasOlder) return
    setLoadingOlder(true)
    const generation = fetchGeneration.current
    try {
      const page = await getThread(token, threadId, { limit: 80, before: cursor })
      if (generation !== fetchGeneration.current || !page) return
      setRawDetail((prev) => {
        if (!prev || String(prev.thread.id) !== String(threadId)) return prev
        const knownMsg = new Set(prev.messages.map((m) => String(m.id)))
        const knownEv = new Set(prev.events.map((e) => String(e.id)))
        const prependMsgs = page.messages.filter((m) => !knownMsg.has(String(m.id)))
        const prependEvs = page.events.filter((e) => !knownEv.has(String(e.id)))
        return {
          ...prev,
          messages: [...prependMsgs, ...prev.messages],
          events: [...prependEvs, ...prev.events],
          hasOlder: Boolean(page.hasOlder),
          oldestMessageId:
            prependMsgs[0] != null
              ? String(prependMsgs[0].id)
              : page.oldestMessageId ?? prev.oldestMessageId,
        }
      })
    } catch {
      // Leave hasOlder true so the operator can retry.
    } finally {
      if (generation === fetchGeneration.current) setLoadingOlder(false)
    }
  }, [token, threadId, loadingOlder, rawDetail?.hasOlder, rawDetail?.oldestMessageId, rawDetail?.messages])

  return {
    detail,
    loading,
    loadingOlder,
    hasOlder: Boolean(detail?.hasOlder),
    loadOlder,
    error,
    saving,
    unreadHighlightIds,
    refresh: fetchDetail,
    patch,
    reply,
    retryFailedSend,
    addNote,
    updateNote,
    deleteNote,
    markUnread,
    togglePin,
    changeAiHandling,
  }
}
