import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent } from '../lib/gateway'
import { extractLiveMessage, extractLiveThreadRow } from '../lib/thread-live'
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
  takeoverThread,
  releaseThread,
  type ThreadDetail,
  type PatchThreadInput,
  type ReplyInput,
  type ThreadId,
} from '../lib/inbox-api'

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

export function useThreadDetail(threadId: ThreadId | null, pinnedIds: ThreadId[] = []) {
  const { token, user } = useAuth()
  const [rawDetail, setRawDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Bumps whenever the open thread changes (or a new fetch starts) so in-flight
  // responses for a previous thread cannot overwrite the current detail pane.
  const fetchGeneration = useRef(0)

  // Drop the previous conversation before paint when the route thread changes,
  // otherwise one frame still renders the old detail under the new URL.
  useLayoutEffect(() => {
    fetchGeneration.current += 1
    setRawDetail(null)
    setError(null)
    setLoading(Boolean(token && threadId))
  }, [token, threadId])

  // `quiet` reloads (gateway-driven and post-reply reconciles) skip the loading
  // spinner and never clear the thread on transient errors, so live updates
  // never flicker the open conversation.
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
        const result = await getThread(token, threadId)
        if (generation !== fetchGeneration.current) return
        // Auto-mark as read when a thread is opened. The server call is
        // fire-and-forget so the UI never blocks on it; the local state already
        // reflects the read status. If the request fails the next list poll
        // (every 30s) will reconcile.
        if (result && result.thread.hasUnread) {
          setRawDetail({ ...result, thread: { ...result.thread, hasUnread: false } })
          void markThreadRead(token, threadId).catch(() => {})
        } else {
          setRawDetail(result)
        }
      } catch (err) {
        if (generation !== fetchGeneration.current) return
        if (!quiet) {
          setError(err instanceof Error ? err.message : 'Thread could not be loaded.')
          setRawDetail(null)
        }
      } finally {
        if (!quiet && generation === fetchGeneration.current) setLoading(false)
      }
    },
    [token, threadId],
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
  // directly; everything else (decision resolution, thread triage, old
  // payload shapes) falls back to a quiet refetch. Skip high-frequency
  // stream events — those only drive the live ThinkingTrace.
  useEffect(() => {
    if (!token || !threadId) return
    const unsub = onGatewayEvent(`signal:${threadId}`, (event) => {
      if (
        event.event === 'message.delta' ||
        event.event === 'agent.thinking' ||
        event.event === 'agent.step'
      ) {
        return
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
          if (current.messages.some((m) => String(m.id) === String(msg.id))) return
          const threadRow = extractLiveThreadRow(event)
          setRawDetail((prev) => {
            if (!prev || String(prev.thread.id) !== String(msg.threadId)) return prev
            if (prev.messages.some((m) => String(m.id) === String(msg.id))) return prev
            return {
              ...prev,
              messages: [...prev.messages, msg],
              thread: {
                ...prev.thread,
                lastMessageAt: msg.receivedAt ?? msg.createdAt ?? prev.thread.lastMessageAt,
                status: threadRow?.status ?? prev.thread.status,
                // The thread is on screen: mirror the refetch path, which
                // auto-marks unread threads as read on load.
                hasUnread: false,
              },
            }
          })
          if (threadRow?.hasUnread) {
            void markThreadRead(token, threadId).catch(() => {})
          }
          return
        }
      }
      void fetchDetail(true)
    })
    return () => unsub()
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
      setSaving(true)
      try {
        const useEmailFormat = input.format === 'email'
        let bodyHtml = input.bodyHtml?.trim() ? input.bodyHtml : undefined
        if (!bodyHtml) {
          if (useEmailFormat) {
            const signatureImageUrl =
              user?.signatureUrl?.trim() ||
              user?.tenant?.logo?.trim() ||
              '/bokito-logo.svg'
            bodyHtml = buildEmailReplyHtml(input.bodyText, signatureImageUrl)
          } else {
            bodyHtml = buildPlainReplyHtml(input.bodyText)
          }
        }
        const msg = await replyToThread(token, threadId, { ...input, bodyHtml })
        if (msg) {
          setRawDetail((prev) => {
            if (!prev) return prev
            // Gateway may have already quiet-refreshed this message while the
            // reply HTTP was in flight — never append a duplicate.
            const already = prev.messages.some((m) => String(m.id) === String(msg.id))
            return {
              ...prev,
              messages: already ? prev.messages : [...prev.messages, msg],
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
        }
        // Agent threads generate a reply synchronously inside the reply
        // request; pull authoritative state so the assistant message shows.
        // The gateway event for the assistant fires while `saving` is still
        // true, so a quiet reload here guarantees it appears.
        void fetchDetail(true)
        return msg
      } catch (err) {
        throw err instanceof Error ? err : new Error('Could not send message.')
      } finally {
        setSaving(false)
      }
    },
    [token, threadId, user?.signatureUrl, user?.tenant?.logo, fetchDetail],
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

  // Human takeover: pause/resume the AI on this thread. Updates local state
  // optimistically, then persists. A widget visitor sees staff replies live via
  // the gateway; while paused the AI stops auto-replying.
  const toggleTakeover = useCallback(
    async (currentPaused: boolean): Promise<boolean> => {
      if (!token || !threadId) return currentPaused
      const next = !currentPaused
      setRawDetail((prev) =>
        prev ? { ...prev, thread: { ...prev.thread, aiPaused: next } } : prev,
      )
      try {
        const result = next
          ? await takeoverThread(token, threadId)
          : await releaseThread(token, threadId)
        setRawDetail((prev) =>
          prev ? { ...prev, thread: { ...prev.thread, aiPaused: result } } : prev,
        )
        return result
      } catch {
        setRawDetail((prev) =>
          prev ? { ...prev, thread: { ...prev.thread, aiPaused: currentPaused } } : prev,
        )
        throw new Error(next ? 'TAKEOVER_FAILED' : 'RESUME_FAILED')
      }
    },
    [token, threadId],
  )

  return { detail, loading, error, saving, refresh: fetchDetail, patch, reply, addNote, updateNote, deleteNote, markUnread, togglePin, toggleTakeover }
}
