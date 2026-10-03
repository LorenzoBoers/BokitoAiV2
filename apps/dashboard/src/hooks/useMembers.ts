import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent } from '../lib/gateway'
import { listSignalMembers } from '../lib/signals-api'
import type { InboxMember } from '../lib/inbox-api'

// Simple module-level cache: member lists are small and change rarely, and
// several composers/selectors can mount at once.
let cache: InboxMember[] | null = null
let inflight: Promise<InboxMember[]> | null = null
const listeners = new Set<(rows: InboxMember[]) => void>()

export function invalidateMembersCache() {
  cache = null
  inflight = null
}

/** Apply a gateway presence event to the cached members and every mounted hook. */
export function applyPresence(userId: string, status: InboxMember['presence']) {
  if (!cache) return
  cache = cache.map((m) => (m.uuid === userId ? { ...m, presence: status } : m))
  for (const listener of listeners) listener(cache)
}

/** Workspace members for assignment, mentions and avatars, with live availability. */
export function useMembers(): { members: InboxMember[]; loading: boolean } {
  const { token } = useAuth()
  const [members, setMembers] = useState<InboxMember[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    listeners.add(setMembers)
    return () => {
      listeners.delete(setMembers)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    return onGatewayEvent('presence', (event) => {
      const data = (event.data ?? {}) as { user_id?: string | null; status?: string }
      if (!data.user_id) return
      const status = data.status === 'available' || data.status === 'away' ? data.status : 'offline'
      applyPresence(data.user_id, status)
    })
  }, [token])

  useEffect(() => {
    if (!token) return
    if (cache) {
      setMembers(cache)
      setLoading(false)
      return
    }
    let cancelled = false
    inflight ??= listSignalMembers(token).then((rows) => {
      cache = rows
      return rows
    })
    inflight
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch(() => {
        inflight = null
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return { members, loading }
}
