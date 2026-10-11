import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import type { GatewayEvent } from '../lib/gateway'
import { applyLive, isLiveSeeded, seedLive, useLiveList } from '../lib/live-store'
import { listSignalMembers } from '../lib/signals-api'
import type { InboxMember } from '../lib/inbox-api'

const TABLE = 'member'

let inflight: Promise<InboxMember[]> | null = null
/** Latest status by user id, including events that arrived before the member list. */
const livePresence = new Map<string, NonNullable<InboxMember['presence']>>()

function asPresence(status: string | undefined): NonNullable<InboxMember['presence']> {
  return status === 'available' || status === 'away' ? status : 'offline'
}

function withLivePresence(rows: InboxMember[]): InboxMember[] {
  return rows.map((row) => {
    const live = livePresence.get(row.uuid)
    return live && live !== row.presence ? { ...row, presence: live } : row
  })
}

/** `presence` events for people; fed by the shell live bus. */
export function ingestMemberPresence(event: GatewayEvent) {
  if (event.event !== 'presence') return
  const data = (event.data ?? {}) as { user_id?: string | null; status?: string }
  if (!data.user_id) return
  const status = asPresence(data.status)
  livePresence.set(data.user_id, status)
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
    if (!token) {
      livePresence.clear()
      inflight = null
      return
    }
    if (isLiveSeeded(TABLE)) {
      setLoading(false)
      return
    }
    let cancelled = false
    inflight ??= listSignalMembers(token).then((rows) => {
      seedLive(TABLE, withLivePresence(rows), (m) => m.uuid)
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
