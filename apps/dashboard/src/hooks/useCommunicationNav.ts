import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useEntityRefresh } from '../lib/live-store'
import { getCommunicationNav, type CommunicationNav } from '../lib/signals-api'

const EMPTY: CommunicationNav = { ticketTags: [], tags: [], projects: [] }

/** Hashtag and project rows for the Communication rail, kept fresh by live pushes. */
export function useCommunicationNav(enabled = true) {
  const { token } = useAuth()
  const [nav, setNav] = useState<CommunicationNav>(EMPTY)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!token || !enabled) return
    try {
      setNav(await getCommunicationNav(token))
    } catch {
      /* keep the last rows */
    } finally {
      setLoaded(true)
    }
  }, [token, enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEntityRefresh(['ticket', 'tag', 'project'], () => void refresh(), {
    debounceMs: 1500,
    topic: 'threads',
    enabled: enabled && Boolean(token),
  })

  return { nav, loaded, refresh }
}
