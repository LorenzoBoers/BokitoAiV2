import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getGateway } from '../lib/gateway'
import { LIVE_TURN_STALE_MS } from '../lib/agentActivity'
import {
  applyThreadEvent,
  beginSync,
  dropTurn,
  EMPTY_LOG,
  orderedTurns,
  type ThreadLogState,
  type ThreadLogTurn,
} from '../lib/thread-log'

/** Flush token events at most this often (avoids setState per token). */
const FLUSH_MS = 64
/** An ended turn whose bubbles never arrive leaves the screen after this. */
const ENDED_HOLD_MS = 10_000

const STRUCTURE_EVENTS = new Set(['agent.turn', 'agent.activity', 'message.start', 'floor', 'log.synced'])

/**
 * Live turns of one conversation from the ordered event log.
 *
 * On every (re)connect the hook sends `sync` with its cursor: the server
 * replays what was missed, or sends the open turns when there is no cursor.
 * A gap (`prev_id` is not the cursor) asks for a replay; a replay that cannot
 * cover the gap calls `onRefetch` so the caller reloads saved messages.
 */
export function useThreadLog(signalId: string | null, onRefetch?: () => void) {
  const [log, setLog] = useState<ThreadLogState>(EMPTY_LOG)
  const logRef = useRef<ThreadLogState>(EMPTY_LOG)
  const flushRef = useRef<number | null>(null)
  const staleRef = useRef<number | null>(null)
  const endedRef = useRef<Map<string, number>>(new Map())
  const refetchRef = useRef(onRefetch)
  refetchRef.current = onRefetch

  const commit = useCallback((next: ThreadLogState, now: boolean) => {
    logRef.current = next
    if (now) {
      if (flushRef.current !== null) window.clearTimeout(flushRef.current)
      flushRef.current = null
      setLog(next)
      return
    }
    if (flushRef.current === null) {
      flushRef.current = window.setTimeout(() => {
        flushRef.current = null
        setLog(logRef.current)
      }, FLUSH_MS)
    }
  }, [])

  const dismiss = useCallback(
    (streamId: string) => {
      const next = dropTurn(logRef.current, streamId)
      if (next !== logRef.current) commit(next, true)
    },
    [commit],
  )

  useEffect(() => {
    logRef.current = EMPTY_LOG
    setLog(EMPTY_LOG)
    for (const timer of endedRef.current.values()) window.clearTimeout(timer)
    endedRef.current.clear()
    if (!signalId) return
    const topic = `signal:${signalId}`
    const gateway = getGateway()

    const requestSync = () => {
      const next = beginSync(logRef.current)
      commit(next, true)
      gateway.sync(topic, next.cursor)
    }

    const armStale = () => {
      if (staleRef.current !== null) window.clearTimeout(staleRef.current)
      staleRef.current = null
      if (!orderedTurns(logRef.current).some((turn) => turn.active)) return
      // Quiet for a long time: ask the server which turns are still open.
      staleRef.current = window.setTimeout(() => {
        staleRef.current = null
        logRef.current = { ...logRef.current, cursor: null }
        requestSync()
      }, LIVE_TURN_STALE_MS)
    }

    const holdEnded = () => {
      for (const turn of orderedTurns(logRef.current)) {
        if (!turn.ended || endedRef.current.has(turn.streamId)) continue
        const id = turn.streamId
        endedRef.current.set(
          id,
          window.setTimeout(() => {
            endedRef.current.delete(id)
            dismiss(id)
          }, ENDED_HOLD_MS),
        )
      }
    }

    const unsub = gateway.subscribe(topic, (event) => {
      const data = (event.data ?? {}) as Record<string, unknown>
      if (data.signal_id != null && String(data.signal_id) !== String(signalId)) return
      const { state, effect } = applyThreadEvent(logRef.current, { event: event.event, data })
      if (state === logRef.current && effect === 'none') return
      commit(state, STRUCTURE_EVENTS.has(event.event) || effect !== 'none')
      if (effect === 'resync') gateway.sync(topic, state.cursor)
      if (effect === 'refetch') {
        refetchRef.current?.()
        logRef.current = { ...logRef.current, cursor: null }
        requestSync()
      }
      armStale()
      holdEnded()
    }, requestSync)

    return () => {
      unsub()
      if (flushRef.current !== null) window.clearTimeout(flushRef.current)
      if (staleRef.current !== null) window.clearTimeout(staleRef.current)
      flushRef.current = null
      staleRef.current = null
      for (const timer of endedRef.current.values()) window.clearTimeout(timer)
      endedRef.current.clear()
    }
  }, [signalId, commit, dismiss])

  const turns = useMemo<ThreadLogTurn[]>(() => orderedTurns(log), [log])
  return {
    turns,
    floor: log.floor,
    floorSeen: log.floorSeen,
    dismiss,
  }
}
