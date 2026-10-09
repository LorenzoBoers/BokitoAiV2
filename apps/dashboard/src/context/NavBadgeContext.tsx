import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { fetchSignalBadgeCounts } from '../lib/signals-api'
import { onGatewayEvent } from '../lib/gateway'
import { onLiveReconnect } from '../lib/live-store'

const GATEWAY_DEBOUNCE_MS = 1_500

export type NavBadgeCounts = {
  inboxUnread: number
  /** forYou: what waits on you now; the other queues count unread. */
  inboxByQueue: { forYou: number; forYouUnread: number; unassigned: number; all: number }
  /** Pinned team id -> open work waiting on that team. */
  byTeam: Record<string, number>
  agentsAttention: number
  noReplySuggestions: number
  /** Overdue look-ats and due check-ups on conversations assigned to you. */
  agendaDue: number
}

const EMPTY_COUNTS: NavBadgeCounts = {
  inboxUnread: 0,
  inboxByQueue: { forYou: 0, forYouUnread: 0, unassigned: 0, all: 0 },
  byTeam: {},
  agentsAttention: 0,
  noReplySuggestions: 0,
  agendaDue: 0,
}

function mapBadgeCounts(payload: Awaited<ReturnType<typeof fetchSignalBadgeCounts>>): NavBadgeCounts {
  return {
    inboxUnread: payload.inbox_unread,
    inboxByQueue: {
      forYou: payload.inbox_by_queue.for_you,
      forYouUnread: payload.inbox_by_queue.for_you_unread,
      unassigned: payload.inbox_by_queue.unassigned,
      all: payload.inbox_by_queue.all,
    },
    byTeam: payload.by_team,
    agentsAttention: payload.agents_attention,
    noReplySuggestions: payload.no_reply_suggestions,
    agendaDue: payload.agenda_due,
  }
}

async function fetchNavBadgeCounts(token: string): Promise<NavBadgeCounts> {
  const payload = await fetchSignalBadgeCounts(token)
  return mapBadgeCounts(payload)
}

type NavBadgeContextValue = {
  counts: NavBadgeCounts
  loading: boolean
  refresh: () => Promise<void>
}

const NavBadgeContext = createContext<NavBadgeContextValue | null>(null)

export function NavBadgeProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [counts, setCounts] = useState<NavBadgeCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!token) {
      setCounts(EMPTY_COUNTS)
      return
    }
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    try {
      const next = await fetchNavBadgeCounts(token)
      if (fetchIdRef.current === fetchId) {
        setCounts(next)
      }
    } catch {
      if (fetchIdRef.current === fetchId) {
        setCounts(EMPTY_COUNTS)
      }
    } finally {
      if (fetchIdRef.current === fetchId) {
        setLoading(false)
      }
    }
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!token) return

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    const offReconnect = onLiveReconnect(() => void refresh())
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      offReconnect()
    }
  }, [token, refresh])

  // Thread, message and decision events refresh the badges (debounced).
  useEffect(() => {
    if (!token) return
    let debounceTimer: number | null = null
    const scheduleHttpRefresh = () => {
      if (debounceTimer !== null) return
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void refresh()
      }, GATEWAY_DEBOUNCE_MS)
    }
    const unsubThreads = onGatewayEvent('threads', scheduleHttpRefresh)
    const unsubDecisions = onGatewayEvent('decisions', scheduleHttpRefresh)
    const unsubNotifications = onGatewayEvent('notifications', scheduleHttpRefresh)
    return () => {
      unsubThreads()
      unsubDecisions()
      unsubNotifications()
      if (debounceTimer !== null) window.clearTimeout(debounceTimer)
    }
  }, [token, refresh])

  const value = useMemo(
    () => ({
      counts,
      loading,
      refresh,
    }),
    [counts, loading, refresh],
  )

  return <NavBadgeContext.Provider value={value}>{children}</NavBadgeContext.Provider>
}

export function useNavBadges(): NavBadgeContextValue {
  const ctx = useContext(NavBadgeContext)
  if (!ctx) {
    throw new Error('useNavBadges must be used within NavBadgeProvider')
  }
  return ctx
}

/** Safe when provider is absent (returns empty counts, no-op refresh). */
export function useOptionalNavBadges(): NavBadgeContextValue {
  const ctx = useContext(NavBadgeContext)
  return (
    ctx ?? {
      counts: EMPTY_COUNTS,
      loading: false,
      refresh: async () => {},
    }
  )
}
