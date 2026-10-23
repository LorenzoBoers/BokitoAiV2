import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import type { GatewayEvent } from '../lib/gateway'
import { applyLive, isLiveSeeded, seedLive, useLiveList } from '../lib/live-store'
import { overlaySelfPresence } from '../lib/presence'
import { listSignalMembers } from '../lib/signals-api'
import type { InboxMember } from '../lib/inbox-api'

const TABLE = 'member'

let inflight: Promise<InboxMember[]> | null = null
/** Latest status by user id, including events that arrived before the member list. */
const livePresence = new Map<string, NonNullable<InboxMember['presence']>>()
let selfUserId: string | null = null
let selfLive = false

export function setSelfPresenceContext(userId: string | null) {
  selfUserId = userId
}

export function setSelfPresenceLive(live: boolean) {
  selfLive = live
}

function asPresence(status: string | undefined): NonNullable<InboxMember['presence']> {
  if (status === 'available' || status === 'away' || status === 'unavailable') return status
  return 'offline'
}

function resolvePresence(
  userId: string | undefined,
  status: string | undefined,
): NonNullable<InboxMember['presence']> {
  return overlaySelfPresence(userId, asPresence(status), selfUserId, selfLive)
}

function withLivePresence(rows: InboxMember[]): InboxMember[] {
  return rows.map((row) => {
    const live = livePresence.get(row.uuid)
    const next = resolvePresence(row.uuid, live ?? row.presence)
    return next !== row.presence ? { ...row, presence: next } : row
  })
}

/** `presence` events for people; fed by the shell live bus. */
export function ingestMemberPresence(event: GatewayEvent) {
  if (event.event !== 'presence') return
  const data = (event.data ?? {}) as { user_id?: string | null; status?: string }
  if (!data.user_id) return
  const status = resolvePresence(data.user_id, data.status)
  livePresence.set(data.user_id, status)
  applyLive<InboxMember>(TABLE, data.user_id, (prev) =>
    prev && prev.presence !== status ? { ...prev, presence: status } : prev,
  )
}

export function __resetMemberPresenceForTests() {
  livePresence.clear()
  inflight = null
  selfUserId = null
  selfLive = false
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
