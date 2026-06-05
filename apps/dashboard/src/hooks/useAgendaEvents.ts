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

  const rangeKey = `${start.toISOString()}|${end.toISOString()}|${(calendarIds ?? []).join(',')}`

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const { start: s, end: e } = toIsoRange(start, end)
      const rows = await listEvents({ start: s, end: e, calendarIds }, token)
      setEvents(rows)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [token, start, end, calendarIds])

  useEffect(() => {
    void refresh()
  }, [refresh, rangeKey])

  useEffect(() => {
    if (!token || pollMs <= 0) return
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs, token, rangeKey])

  return { events, loading, error, refresh }
}
