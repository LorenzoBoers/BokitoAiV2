import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listEmailMessages, type EmailMessage } from '../lib/email-api'

type UseEmailMessagesInput = {
  connectionId: number | null
  search?: string
  filter?: 'all' | 'unread' | 'urgent'
  pollMs?: number
}

export function useEmailMessages({ connectionId, search, filter = 'all', pollMs = 30000 }: UseEmailMessagesInput) {
  const { token } = useAuth()
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMessages = useCallback(async () => {
    if (!token || !connectionId) {
      setMessages([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await listEmailMessages(token, {
        connectionId,
        page: 1,
        perPage: 100,
        search,
      })
      setMessages(result.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon berichten niet laden.')
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [token, connectionId, search, filter])

  useEffect(() => {
    void fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    if (!connectionId || !token) return
    const timer = window.setInterval(() => {
      void fetchMessages()
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [connectionId, token, pollMs, fetchMessages])

  const filteredMessages = useMemo(() => {
    if (filter === 'urgent') return messages.filter((item) => item.sentiment === 'urgent')
    if (filter === 'unread') return messages.filter((item) => !item.isRead)
    return messages
  }, [messages, filter])

  return {
    messages: filteredMessages,
    loading,
    error,
    refresh: fetchMessages,
  }
}
