/**
 * Conversations that follow the operator after they leave them (the
 * temporary half of the chat stack). Only ids live here, per user and
 * workspace in localStorage; the API decides what each card shows.
 */
import { useSyncExternalStore } from 'react'

/** One following card: leaving another conversation replaces it. */
export const FOLLOW_LIMIT = 1
export const FOLLOW_TTL_MS = 30 * 60 * 1000
export const FOLLOW_RECENT_MS = 2 * 60 * 1000

export type FollowEntry = { id: string; at: number }

const KEY_PREFIX = 'bokito.chatStack.follow.'
const EMPTY: FollowEntry[] = []
const listeners = new Set<() => void>()
const cache = new Map<string, FollowEntry[]>()

function storageKey(scope: string) {
  return `${KEY_PREFIX}${scope}`
}

function parse(raw: string | null): FollowEntry[] {
  if (!raw) return EMPTY
  try {
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) return EMPTY
    return rows
      .filter((r) => r && typeof r.id === 'string' && typeof r.at === 'number')
      .map((r) => ({ id: r.id, at: r.at }))
  } catch {
    return EMPTY
  }
}

/** Drop expired entries and duplicates; newest first; at most FOLLOW_LIMIT. */
export function pruneFollows(entries: FollowEntry[], now: number): FollowEntry[] {
  const seen = new Set<string>()
  const out: FollowEntry[] = []
  for (const entry of [...entries].sort((a, b) => b.at - a.at)) {
    if (now - entry.at > FOLLOW_TTL_MS || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
    if (out.length >= FOLLOW_LIMIT) break
  }
  return out
}

export function addFollow(entries: FollowEntry[], id: string, now: number): FollowEntry[] {
  return pruneFollows([{ id, at: now }, ...entries.filter((e) => e.id !== id)], now)
}

export function removeFollow(entries: FollowEntry[], id: string): FollowEntry[] {
  return entries.filter((e) => e.id !== id)
}

/** Keep a followed conversation alive while something happens in it. */
export function touchFollow(entries: FollowEntry[], id: string, now: number): FollowEntry[] {
  if (!entries.some((e) => e.id === id)) return entries
  return entries.map((e) => (e.id === id ? { ...e, at: now } : e))
}

/**
 * Leaving a conversation keeps it at hand when an agent is still working in
 * it, it moved in the last two minutes, or the composer still holds text.
 */
export function shouldFollowOnLeave(input: {
  agentWorking: boolean
  hasDraft: boolean
  lastActivityAt: number | null
  now: number
}): boolean {
  if (input.agentWorking || input.hasDraft) return true
  if (input.lastActivityAt == null) return false
  return input.now - input.lastActivityAt <= FOLLOW_RECENT_MS
}

export function readFollows(scope: string | null): FollowEntry[] {
  if (!scope) return EMPTY
  const cached = cache.get(scope)
  if (cached) return cached
  let rows = EMPTY
  try {
    rows = parse(window.localStorage.getItem(storageKey(scope)))
  } catch {
    rows = EMPTY
  }
  const pruned = pruneFollows(rows, Date.now())
  cache.set(scope, pruned)
  return pruned
}

export function writeFollows(scope: string | null, next: FollowEntry[]) {
  if (!scope) return
  cache.set(scope, next)
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(next))
  } catch {
    // Private mode or full storage: the stack still works for this tab.
  }
  for (const listener of [...listeners]) listener()
}

export function updateFollows(scope: string | null, fn: (prev: FollowEntry[]) => FollowEntry[]) {
  if (!scope) return
  const prev = readFollows(scope)
  const next = fn(prev)
  if (next !== prev) writeFollows(scope, next)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(KEY_PREFIX)) return
    cache.delete(event.key.slice(KEY_PREFIX.length))
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useFollows(scope: string | null): FollowEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => readFollows(scope),
    () => EMPTY,
  )
}

export function __resetFollowsForTests() {
  cache.clear()
}
