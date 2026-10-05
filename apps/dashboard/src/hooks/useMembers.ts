import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import type { GatewayEvent } from '../lib/gateway'
import { applyLive, isLiveSeeded, seedLive, useLiveList } from '../lib/live-store'
import { listSignalMembers } from '../lib/signals-api'
import type { InboxMember } from '../lib/inbox-api'

const TABLE = 'member'

let inflight: Promise<InboxMember[]> | null = null

/** `presence` events for people; fed by the shell live bus. */
export function ingestMemberPresence(event: GatewayEvent) {
  if (event.event !== 'presence') return
  const data = (event.data ?? {}) as { user_id?: string | null; status?: string }
  if (!data.user_id) return
  const status: InboxMember['presence'] =
    data.status === 'available' || data.status === 'away' ? data.status : 'offline'
  applyLive<InboxMember>(TABLE, data.user_id, (prev) =>
    prev && prev.presence !== status ? { ...prev, presence: status } : prev,
  )
}

/** Workspace members for assignment, mentions and avatars, with live availability. */
export function useMembers(): { members: InboxMember[]; loading: boolean } {
  const { token } = useAuth()
  const members = useLiveList<InboxMember>(TABLE)
  const [loading, setLoading] = useState(!isLiveSeeded(TABLE))

  useEffect(() => {
    if (!token) return
    if (isLiveSeeded(TABLE)) {
      setLoading(false)
      return
    }
    let cancelled = false
    inflight ??= listSignalMembers(token).then((rows) => {
      seedLive(TABLE, rows, (m) => m.uuid)
      return rows
    })
    inflight
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
