import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { listCalendars, type AgendaCalendar } from '../lib/agenda-api'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

type AgendaCalendarContextValue = {
  calendars: AgendaCalendar[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const AgendaCalendarContext = createContext<AgendaCalendarContextValue | null>(null)

export function AgendaCalendarProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [calendars, setCalendars] = useState<AgendaCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) {
      setCalendars([])
      setLoading(false)
      setError(null)
      return
    }
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

  const value = useMemo(
    () => ({ calendars, loading, error, refresh }),
    [calendars, loading, error, refresh],
  )

  return <AgendaCalendarContext.Provider value={value}>{children}</AgendaCalendarContext.Provider>
}

export function useAgendaCalendars(): AgendaCalendarContextValue {
  const ctx = useContext(AgendaCalendarContext)
  if (ctx) return ctx

  throw new Error('useAgendaCalendars must be used within AgendaCalendarProvider')
}
