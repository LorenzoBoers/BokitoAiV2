import { useCallback, useEffect, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  listPinnedThreadIds,
  pinThread,
  unpinThread,
  type ThreadId,
} from '../lib/inbox-api'
import { applyLive, isLiveSeeded, listLive, removeLive, seedLive, useLiveList } from '../lib/live-store'

const TABLE = 'thread_pin'

type PinRow = { id: string; order: number }

let pinSeq = 0
let inflight: Promise<void> | null = null
let loadedFor: string | null | undefined

function byOrder(a: PinRow, b: PinRow) {
  return a.order - b.order
}

export function pinnedIdsNow(): ThreadId[] {
  return [...listLive<PinRow>(TABLE)].sort(byOrder).map((row) => row.id)
}

export function addPinLocal(threadId: ThreadId) {
  const id = String(threadId)
  applyLive<PinRow>(TABLE, id, (prev) => prev ?? { id, order: ++pinSeq })
}

export function removePinLocal(threadId: ThreadId) {
  removeLive(TABLE, String(threadId))
}

async function loadPins(token: string) {
  const ids = await listPinnedThreadIds(token)
  pinSeq = 0
  seedLive<PinRow>(
    TABLE,
    ids.map((id) => ({ id: String(id), order: ++pinSeq })),
    (row) => row.id,
  )
}

/**
 * Pin or unpin with an optimistic local update; rolls back and rethrows
 * (`PIN_FAILED` / `UNPIN_FAILED`) when the API refuses.
 */
export async function setThreadPinned(token: string, threadId: ThreadId, next: boolean) {
  if (next) addPinLocal(threadId)
  else removePinLocal(threadId)
  try {
    if (next) await pinThread(token, threadId)
    else await unpinThread(token, threadId)
  } catch {
    if (next) removePinLocal(threadId)
    else addPinLocal(threadId)
    throw new Error(next ? 'PIN_FAILED' : 'UNPIN_FAILED')
  }
}

/**
 * The current user's pinned thread ids, shared by every view (Communication
 * list, thread header, chat stack, floating window) through the live store.
 * `addPin` / `removePin` are optimistic local updates; the API call is fired
 * by the caller (or use `setThreadPinned`).
 */
export function usePinnedIds() {
  const { token } = useAuth()
  const rows = useLiveList<PinRow>(TABLE)
  const pinnedIds = useMemo(() => [...rows].sort(byOrder).map((row) => row.id), [rows])

  const refresh = useCallback(async () => {
    if (!token) {
      seedLive<PinRow>(TABLE, [], (row) => row.id)
      return
    }
    if (!inflight) {
      inflight = loadPins(token)
        .catch(() => {
          // A failed pin lookup is non-fatal: keep the previous list.
        })
        .finally(() => {
          inflight = null
        })
    }
    await inflight
  }, [token])

  useEffect(() => {
    if (loadedFor === token && isLiveSeeded(TABLE)) return
    loadedFor = token
    void refresh()
  }, [refresh, token])

  return {
    pinnedIds,
    loaded: isLiveSeeded(TABLE),
    refresh,
    addPin: addPinLocal,
    removePin: removePinLocal,
  }
}
