import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  getThread,
  patchThread,
  replyToThread,
  addNoteToThread,
  markThreadRead,
  markThreadUnread,
  pinThread,
  unpinThread,
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

function buildReplyHtml(bodyText: string, signatureImageUrl: string): string {
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

  const fetchDetail = useCallback(async () => {
    if (!token || !threadId) {
      setRawDetail(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await getThread(token, threadId)
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
      setError(err instanceof Error ? err.message : 'Thread kon niet worden geladen.')
      setRawDetail(null)
    } finally {
      setLoading(false)
    }
  }, [token, threadId])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

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
        const signatureImageUrl =
          user?.signatureUrl?.trim() ||
          user?.tenant?.logo?.trim() ||
          '/bokito-logo.svg'
        const bodyHtml =
          input.bodyHtml && input.bodyHtml.trim()
            ? input.bodyHtml
            : buildReplyHtml(input.bodyText, signatureImageUrl)
        const msg = await replyToThread(token, threadId, { ...input, bodyHtml })
        if (msg) {
          setRawDetail((prev) =>
            prev
              ? {
                  ...prev,
                  messages: [...prev.messages, msg],
                  thread: {
                    ...prev.thread,
                    lastMessageAt: msg.receivedAt,
                    status: input.action === 'send_and_close' ? 'closed' : input.action === 'send_and_pending' ? 'pending' : prev.thread.status,
                  },
                }
              : prev,
          )
        }
      } finally {
        setSaving(false)
      }
    },
    [token, threadId, user?.signatureUrl, user?.tenant?.logo],
  )

  const addNote = useCallback(
    async (bodyText: string) => {
      if (!token || !threadId) return
      setSaving(true)
      try {
        const msg = await addNoteToThread(token, threadId, bodyText)
        if (msg) {
          setRawDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, msg] } : prev))
        }
      } finally {
        setSaving(false)
      }
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
      throw new Error('Kon thread niet als ongelezen markeren.')
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
        throw new Error(next ? 'Kon thread niet pinnen.' : 'Kon pin niet verwijderen.')
      }
    },
    [token, threadId],
  )

  return { detail, loading, error, saving, refresh: fetchDetail, patch, reply, addNote, markUnread, togglePin }
}
