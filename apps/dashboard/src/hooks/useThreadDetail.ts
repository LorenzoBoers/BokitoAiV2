import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  getThread,
  patchThread,
  replyToThread,
  addNoteToThread,
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
      setDetail(result)
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

  return { detail, loading, error, saving, refresh: fetchDetail, patch, reply, addNote }
}
