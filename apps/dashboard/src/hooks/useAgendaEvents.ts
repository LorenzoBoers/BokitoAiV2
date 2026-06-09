import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listEvents, type AgendaEvent } from '../lib/agenda-api'
import { toIsoRange } from '../lib/agenda-dates'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

type UseAgendaEventsArgs = {
  start: Date
  end: Date
  calendarIds?: string[]
  pollMs?: number
}

export function useAgendaEvents({ start, end, calendarIds, pollMs = 30_000 }: UseAgendaEventsArgs) {
  const { token } = useAuth()
  const [events, setEvents] = useState<AgendaEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const startKey = start.toISOString()
  const endKey = end.toISOString()
  const calendarKey = (calendarIds ?? []).join(',')

  const refresh = useCallback(async () => {
    if (!token) {
      setEvents([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rangeStart = new Date(startKey)
      const rangeEnd = new Date(endKey)
      const { start: s, end: e } = toIsoRange(rangeStart, rangeEnd)
      const ids = calendarKey ? calendarKey.split(',').filter(Boolean) : undefined
      const rows = await listEvents({ start: s, end: e, calendarIds: ids }, token)
      setEvents(rows)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [token, startKey, endKey, calendarKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!token || pollMs <= 0) return
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs, token])

  return { events, loading, error, refresh }
}
