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
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listThreads } from '../lib/inbox-api'
import { onGatewayEvent } from '../lib/gateway'

// Slow fallback poll; live updates arrive over the gateway WS.
const POLL_MS = 120_000
const GATEWAY_DEBOUNCE_MS = 1_500
const PER_PAGE = 50

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

function countUnread(items: { hasUnread: boolean }[]): number {
  return items.filter((t) => t.hasUnread).length
}

type NavBadgeContextValue = {
  counts: NavBadgeCounts
  loading: boolean
  refresh: () => Promise<void>
}

const NavBadgeContext = createContext<NavBadgeContextValue | null>(null)

async function fetchNavBadgeCounts(token: string, isAdmin: boolean): Promise<NavBadgeCounts> {
  const [mine, unassigned, all, agentsAttention] = await Promise.all([
    listThreads(token, { view: 'mine', perPage: PER_PAGE }),
    listThreads(token, { view: 'unassigned', perPage: PER_PAGE }),
    listThreads(token, { view: 'all_open', perPage: PER_PAGE }),
    isAdmin
      ? listThreads(token, { view: 'awaiting_decision', perPage: PER_PAGE }).then(
          (result) => result.items.length,
        )
      : Promise.resolve(0),
  ])

  const myUnread = countUnread(mine.items)
  const unassignedUnread = countUnread(unassigned.items)
  const allUnread = countUnread(all.items)

  const unreadIds = new Set<string>()
  for (const thread of mine.items) {
    if (thread.hasUnread) unreadIds.add(String(thread.id))
  }
  for (const thread of unassigned.items) {
    if (thread.hasUnread) unreadIds.add(String(thread.id))
  }

  return {
    inboxUnread: unreadIds.size,
    inboxByQueue: {
      my: myUnread,
      unassigned: unassignedUnread,
      all: allUnread,
    },
    agentsAttention,
  }
}

export function NavBadgeProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
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
      const next = await fetchNavBadgeCounts(token, isAdmin)
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
  }, [token, isAdmin])

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
