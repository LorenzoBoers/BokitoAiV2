import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listPinnedThreadIds } from '../lib/inbox-api'

/**
 * Tracks the set of thread IDs the current user has pinned. Used by the
 * inbox to decorate thread items with `isPinned` and to sort pinned items
 * to the top of every list view, without depending on backend-side
 * decoration of the thread payloads.
 *
 * Exposes `addPin` / `removePin` for optimistic local updates after the user
 * pins or unpins a thread; the corresponding API call is fired separately.
 */
export function usePinnedIds() {
  const { token } = useAuth()
  const [pinnedIds, setPinnedIds] = useState<number[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!token) {
      setPinnedIds([])
      setLoaded(true)
      return
    }
    try {
      const ids = await listPinnedThreadIds(token)
      setPinnedIds(ids)
    } catch {
      // A failed pin lookup is non-fatal: the inbox still works without
      // decoration. We just leave the previous list in place.
    } finally {
      setLoaded(true)
    }
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addPin = useCallback((threadId: number) => {
    setPinnedIds((prev) => (prev.includes(threadId) ? prev : [...prev, threadId]))
  }, [])

  const removePin = useCallback((threadId: number) => {
    setPinnedIds((prev) => prev.filter((id) => id !== threadId))
  }, [])

  return { pinnedIds, loaded, refresh, addPin, removePin }
}
