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

// Slow fallback poll; live updates arrive over the gateway WS.
const POLL_MS = 120_000
const GATEWAY_DEBOUNCE_MS = 1_500

export type NavBadgeCounts = {
  inboxUnread: number
  inboxByQueue: { my: number; unassigned: number; all: number }
  agentsAttention: number
}

const EMPTY_COUNTS: NavBadgeCounts = {
  inboxUnread: 0,
  inboxByQueue: { my: 0, unassigned: 0, all: 0 },
  agentsAttention: 0,
}

function mapBadgeCounts(payload: Awaited<ReturnType<typeof fetchSignalBadgeCounts>>): NavBadgeCounts {
  return {
    inboxUnread: payload.inbox_unread,
    inboxByQueue: {
      my: payload.inbox_by_queue.my,
      unassigned: payload.inbox_by_queue.unassigned,
      all: payload.inbox_by_queue.all,
    },
    agentsAttention: payload.agents_attention,
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }, POLL_MS)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [token, refresh])

  // Live updates: any thread/message/decision event refreshes the badges (debounced).
  useEffect(() => {
    if (!token) return
    let debounceTimer: number | null = null
    const trigger = () => {
      if (debounceTimer !== null) return
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void refresh()
      }, GATEWAY_DEBOUNCE_MS)
    }
    const unsubThreads = onGatewayEvent('threads', trigger)
    const unsubDecisions = onGatewayEvent('decisions', trigger)
    return () => {
      unsubThreads()
      unsubDecisions()
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
