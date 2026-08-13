import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { listSignalMembers } from '../lib/signals-api'
import type { InboxMember } from '../lib/inbox-api'

// Simple module-level cache: member lists are small and change rarely, and
// several composers/selectors can mount at once.
let cache: InboxMember[] | null = null
let inflight: Promise<InboxMember[]> | null = null

export function invalidateMembersCache() {
  cache = null
  inflight = null
}

/** Workspace members for assignment, mentions and avatars. */
export function useMembers(): { members: InboxMember[]; loading: boolean } {
  const { token } = useAuth()
  const [members, setMembers] = useState<InboxMember[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

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
