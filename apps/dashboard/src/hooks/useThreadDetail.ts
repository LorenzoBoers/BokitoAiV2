import { useCallback, useEffect, useState } from 'react'
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
} from '../lib/inbox-api'

export function useThreadDetail(threadId: number | null) {
  const { token } = useAuth()
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!token || !threadId) {
      setDetail(null)
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
        setDetail({ ...result, thread: { ...result.thread, hasUnread: false } })
        void markThreadRead(token, threadId).catch(() => {})
      } else {
        setDetail(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thread kon niet worden geladen.')
    } finally {
      setLoading(false)
    }
  }, [token, threadId])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  const patch = useCallback(
    async (input: PatchThreadInput) => {
      if (!token || !threadId) return
      setSaving(true)
      try {
        const updated = await patchThread(token, threadId, input)
        if (updated) {
          setDetail((prev) => (prev ? { ...prev, thread: updated } : prev))
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
        const msg = await replyToThread(token, threadId, input)
        if (msg) {
          setDetail((prev) =>
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
    [token, threadId],
  )

  const addNote = useCallback(
    async (bodyText: string) => {
      if (!token || !threadId) return
      setSaving(true)
      try {
        const msg = await addNoteToThread(token, threadId, bodyText)
        if (msg) {
          setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, msg] } : prev))
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
    setDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, hasUnread: true } } : prev))
    try {
      await markThreadUnread(token, threadId)
    } catch {
      setDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, hasUnread: false } } : prev))
      throw new Error('Kon thread niet als ongelezen markeren.')
    }
  }, [token, threadId])

  // Toggle pin state with optimistic update + rollback on failure.
  const togglePin = useCallback(async () => {
    if (!token || !threadId) return
    const current = detail?.thread.isPinned ?? false
    const next = !current
    setDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, isPinned: next } } : prev))
    try {
      if (next) {
        await pinThread(token, threadId)
      } else {
        await unpinThread(token, threadId)
      }
    } catch {
      setDetail((prev) => (prev ? { ...prev, thread: { ...prev.thread, isPinned: current } } : prev))
      throw new Error(next ? 'Kon thread niet pinnen.' : 'Kon pin niet verwijderen.')
    }
  }, [token, threadId, detail])

  return { detail, loading, error, saving, refresh: fetchDetail, patch, reply, addNote, markUnread, togglePin }
}
