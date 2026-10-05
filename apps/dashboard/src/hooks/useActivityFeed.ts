import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { bokitoGetCockpitActivity, type CockpitActivityEvent } from '../lib/bokito-api'
import { onGatewayEvent, type GatewayEvent } from '../lib/gateway'

export type ActivityEntry = {
  id: string
  kind: string
  eventType: string
  message: string
  actorName: string | null
  createdAt: string
  live: boolean
  runId: string | null
  agentId: string | null
  signalId: string | null
  resourceType: string | null
  resourceId: string | null
}

function activityEntryFromEvent(ev: CockpitActivityEvent, idx = 0): ActivityEntry {
  return {
    id: ev.id ?? `hist-${ev.created_at}-${idx}`,
    kind: ev.kind,
    eventType: ev.event_type,
    message: ev.message || '',
    actorName: ev.actor_name ?? null,
    createdAt: ev.created_at,
    live: false,
    runId: ev.run_id ?? null,
    agentId: ev.agent_id ?? null,
    signalId: ev.signal_id ?? null,
    resourceType: ev.resource_type ?? null,
    resourceId: ev.resource_id ?? null,
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function activityEntryFromGateway(event: GatewayEvent): ActivityEntry {
  const data = event.data
  return {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: event.event || 'event',
    eventType: str(data.event_type) ?? str(data.status) ?? event.event,
    message: str(data.message) ?? str(data.subject) ?? '',
    actorName: str(data.agent_name),
    createdAt: event.ts ?? new Date().toISOString(),
    live: true,
    runId: str(data.run_id),
    agentId: str(data.agent_id),
    signalId: str(data.signal_id),
    resourceType: null,
    resourceId: null,
  }
}

const MAX_ENTRIES = 1000

/** Oldest-first activity history with paging and live run/decision events. */
export function useActivityFeed(pageSize = 150) {
  const { token } = useAuth()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setFailed(false)
    try {
      const rows = await bokitoGetCockpitActivity(token, pageSize)
      setEntries(rows.map(activityEntryFromEvent).reverse())
      setHasMore(rows.length >= pageSize)
    } catch {
      setEntries([])
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [token, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const loadOlder = useCallback(async () => {
    if (!token || loadingOlder || !hasMore) return
    const oldest = entries.find((e) => !e.live)
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const rows = await bokitoGetCockpitActivity(token, pageSize, oldest.createdAt)
      if (rows.length < pageSize) setHasMore(false)
      if (rows.length) {
        const older = rows.map(activityEntryFromEvent).reverse()
        setEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          return [...older.filter((e) => !seen.has(e.id)), ...prev]
        })
      }
    } catch {
      setHasMore(false)
    } finally {
      setLoadingOlder(false)
    }
  }, [token, loadingOlder, hasMore, entries, pageSize])

  useEffect(() => {
    if (!token) return
    const push = (event: GatewayEvent) => {
      setEntries((prev) => {
        const next = [...prev, activityEntryFromGateway(event)]
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
      })
    }
    const unsubs = [onGatewayEvent('runs', push), onGatewayEvent('decisions', push)]
    return () => unsubs.forEach((u) => u())
  }, [token])

  return { entries, loading, loadingOlder, hasMore, failed, load, loadOlder }
}
