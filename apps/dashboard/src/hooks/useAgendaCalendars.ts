import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listCalendars, type AgendaCalendar } from '../lib/agenda-api'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

export function useAgendaCalendars() {
  const { token } = useAuth()
  const [calendars, setCalendars] = useState<AgendaCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const rows = await listCalendars(token)
      setCalendars(rows)
    } catch (err) {
      setError(formatApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { calendars, loading, error, refresh }
}
