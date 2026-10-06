/**
 * One live entity store for the dashboard.
 *
 * Keyed tables (agent live state, members, notifications, ...) that REST
 * loaders seed and gateway events patch, plus a change bus for
 * `entity.changed` so list pages refetch on a push instead of a timer.
 * `useLiveBus` (mounted once in the shell) is the only gateway subscriber
 * that writes into the tables.
 */

import { useEffect, useRef, useState } from 'react'
import { onGatewayEvent, onGatewayStatus, type GatewayEvent } from './gateway'

export type EntityKind =
  | 'trigger'
  | 'ticket'
  | 'tag'
  | 'project'
  | 'agent'
  | 'module_source'
  | 'calendar'
  | 'trash'
  | 'workstream_run'
  | 'team'

export type EntityOp = 'created' | 'updated' | 'deleted'

export type EntityChange = {
  entity: EntityKind
  id: string | null
  op: EntityOp
  row: Record<string, unknown> | null
}

type Listener = () => void

const tables = new Map<string, Map<string, unknown>>()
const seeded = new Set<string>()
const listCache = new Map<string, unknown[]>()
const tableListeners = new Map<string, Set<Listener>>()
const changeHandlers = new Set<(change: EntityChange) => void>()
const reconnectHandlers = new Set<Listener>()

function tableOf<T>(table: string): Map<string, T> {
  let rows = tables.get(table)
  if (!rows) {
    rows = new Map()
    tables.set(table, rows)
  }
  return rows as Map<string, T>
}

function notifyTable(table: string) {
  listCache.delete(table)
  for (const listener of tableListeners.get(table) ?? []) listener()
}

export function getLive<T>(table: string, id: string | null | undefined): T | null {
  if (!id) return null
  return (tableOf<T>(table).get(id) as T | undefined) ?? null
}

/** Stable array identity until the table changes, so it is safe in effect deps. */
export function listLive<T>(table: string): T[] {
  let rows = listCache.get(table) as T[] | undefined
  if (!rows) {
    rows = [...tableOf<T>(table).values()]
    listCache.set(table, rows)
  }
  return rows
}

export function listLiveEntries<T>(table: string): [string, T][] {
  return [...tableOf<T>(table).entries()]
}

/** True once a REST load seeded the table (live patches alone do not count). */
export function isLiveSeeded(table: string): boolean {
  return seeded.has(table)
}

/** Replace (or merge into) a table from a REST load. */
export function seedLive<T>(
  table: string,
  rows: Iterable<T>,
  keyOf: (row: T) => string,
  { replace = true }: { replace?: boolean } = {},
) {
  const current = tableOf<T>(table)
  if (replace) current.clear()
  seeded.add(table)
  for (const row of rows) {
    const key = keyOf(row)
    if (key) current.set(key, row)
  }
  notifyTable(table)
}

/** Patch one row; `next` may derive from the previous row. Returns false when unchanged. */
export function applyLive<T>(table: string, id: string, next: T | ((prev: T | null) => T | null)): boolean {
  const current = tableOf<T>(table)
  const prev = (current.get(id) as T | undefined) ?? null
  const value = typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next
  if (value === prev) return false
  if (value === null) current.delete(id)
  else current.set(id, value)
  notifyTable(table)
  return true
}

export function removeLive(table: string, id: string) {
  const current = tableOf(table)
  if (!current.delete(id)) return
  notifyTable(table)
}

export function subscribeLive(table: string, listener: Listener): () => void {
  let set = tableListeners.get(table)
  if (!set) {
    set = new Set()
    tableListeners.set(table, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
  }
}

/** Re-render when any row of `table` changes. */
export function useLiveVersion(table: string): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeLive(table, () => setVersion((n) => n + 1)), [table])
  return version
}

export function useLiveEntity<T>(table: string, id: string | null | undefined): T | null {
  useLiveVersion(table)
  return getLive<T>(table, id)
}

export function useLiveList<T>(table: string): T[] {
  useLiveVersion(table)
  return listLive<T>(table)
}

/** Listen for `entity.changed` pushes. Returns an unsubscribe function. */
export function onEntityChange(
  entities: EntityKind | readonly EntityKind[],
  handler: (change: EntityChange) => void,
): () => void {
  const wanted = new Set<EntityKind>(typeof entities === 'string' ? [entities] : entities)
  const wrapped = (change: EntityChange) => {
    if (wanted.has(change.entity)) handler(change)
  }
  changeHandlers.add(wrapped)
  return () => {
    changeHandlers.delete(wrapped)
  }
}

/** Fires once the gateway reconnects, so a loader can reconcile what it missed. */
export function onLiveReconnect(handler: Listener): () => void {
  reconnectHandlers.add(handler)
  return () => {
    reconnectHandlers.delete(handler)
  }
}

/**
 * Run `refresh` when one of `entities` changes (debounced) and after a
 * gateway reconnect. `match` narrows to the rows the caller shows; `topic`
 * adds one more gateway topic (for example `runs` or `run:<id>`) whose
 * events pass `topicMatch`.
 */
export function useEntityRefresh(
  entities: readonly EntityKind[],
  refresh: () => void,
  {
    debounceMs = 400,
    match,
    topic,
    topicMatch,
    enabled = true,
  }: {
    debounceMs?: number
    match?: (change: EntityChange) => boolean
    topic?: string
    topicMatch?: (event: GatewayEvent) => boolean
    enabled?: boolean
  } = {},
) {
  const refreshRef = useRef(refresh)
  const matchRef = useRef(match)
  const topicMatchRef = useRef(topicMatch)
  refreshRef.current = refresh
  matchRef.current = match
  topicMatchRef.current = topicMatch
  const key = entities.join(',')
  useEffect(() => {
    if (!enabled) return
    let timer: number | null = null
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        refreshRef.current()
      }, debounceMs)
    }
    const offChange = key
      ? onEntityChange(key.split(',') as EntityKind[], (change) => {
          if (matchRef.current && !matchRef.current(change)) return
          schedule()
        })
      : () => {}
    const offTopic = topic
      ? onGatewayEvent(topic, (event) => {
          if (topicMatchRef.current && !topicMatchRef.current(event)) return
          schedule()
        })
      : () => {}
    const offReconnect = onLiveReconnect(schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      offChange()
      offTopic()
      offReconnect()
    }
  }, [key, debounceMs, topic, enabled])
}
export function emitEntityChange(change: EntityChange) {
  for (const handler of [...changeHandlers]) {
    try {
      handler(change)
    } catch {
      // one listener must not break the others
    }
  }
}

function entityChangeFrom(event: GatewayEvent): EntityChange | null {
  if (event.event !== 'entity.changed') return null
  const data = event.data ?? {}
  const entity = typeof data.entity === 'string' ? (data.entity as EntityKind) : null
  if (!entity) return null
  const op = data.op === 'created' || data.op === 'deleted' ? data.op : 'updated'
  return {
    entity,
    id: typeof data.id === 'string' && data.id ? data.id : null,
    op,
    row: data.row && typeof data.row === 'object' ? (data.row as Record<string, unknown>) : null,
  }
}

export type GatewayIngest = (event: GatewayEvent) => void

export type LiveBusConfig = {
  /** Table owners: how each topic patches their rows. */
  ingest: Partial<Record<'presence' | 'agents' | 'notifications', GatewayIngest[]>>
  /** Live rows fall back to REST truth while the socket is down. */
  onDisconnect?: () => void
}

/** The shell's single gateway subscriber that feeds the store. */
export function useLiveBus(enabled: boolean, config: LiveBusConfig) {
  const configRef = useRef(config)
  configRef.current = config
  useEffect(() => {
    if (!enabled) return
    const offEntities = onGatewayEvent('entities', (event) => {
      const change = entityChangeFrom(event)
      if (change) emitEntityChange(change)
    })
    const offTopics = (['presence', 'agents', 'notifications'] as const).map((topic) =>
      onGatewayEvent(topic, (event) => {
        for (const ingest of configRef.current.ingest[topic] ?? []) {
          try {
            ingest(event)
          } catch {
            // a malformed frame must not stop the bus
          }
        }
      }),
    )
    let wasDisconnected = false
    const offStatus = onGatewayStatus((status) => {
      if (status === 'disconnected') {
        wasDisconnected = true
        configRef.current.onDisconnect?.()
        return
      }
      if (status === 'connected' && wasDisconnected) {
        wasDisconnected = false
        for (const handler of [...reconnectHandlers]) handler()
      }
    })
    return () => {
      offEntities()
      for (const off of offTopics) off()
      offStatus()
    }
  }, [enabled])
}

export function __resetLiveStoreForTests() {
  tables.clear()
  seeded.clear()
  listCache.clear()
}