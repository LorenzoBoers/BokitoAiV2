import { useCallback, useEffect, useRef, useState } from 'react'
import { onGatewayEvent } from '../lib/gateway'
import {
  applyTurnEvent,
  EMPTY_TURN,
  eventTargetsSignal,
  LIVE_TURN_STALE_MS,
  mergeTurns,
  type LiveTurn,
} from '../lib/agentActivity'

/** Flush batched events at most this often (avoids setState per token). */
const FLUSH_MS = 64
/** Drop a turn whose `end` never arrived (lost connection, crashed worker). */
const STALE_MS = LIVE_TURN_STALE_MS

const TURN_EVENTS = new Set([
  'agent.turn',
  'agent.activity',
  'agent.thinking',
  'message.delta',
  'thread.presence',
])

/**
 * Live agent turn on a thread from gateway events. A saved `message` in the
 * middle of a turn does not end it; only `agent.turn end` does. After the
 * end the turn stays (ended) until the caller sees the saved bubbles and
 * calls `reset`, so the live view hands off without a gap.
 */
export function useSignalStream(signalId: string | null, seed: LiveTurn | null = null) {
  const [turn, setTurn] = useState<LiveTurn>(EMPTY_TURN)
  const turnRef = useRef<LiveTurn>(EMPTY_TURN)
  const flushTimerRef = useRef<number | null>(null)
  const staleTimerRef = useRef<number | null>(null)
  const sealedRef = useRef<string | null>(null)
  const droppedSeedsRef = useRef<Set<string>>(new Set())
  const seedRef = useRef<LiveTurn | null>(seed)
  seedRef.current = seed

  const clearTimers = useCallback(() => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    if (staleTimerRef.current !== null) window.clearTimeout(staleTimerRef.current)
    flushTimerRef.current = null
    staleTimerRef.current = null
  }, [])

  const reset = useCallback(() => {
    sealedRef.current = turnRef.current.streamId
    clearTimers()
    turnRef.current = EMPTY_TURN
    setTurn(EMPTY_TURN)
  }, [clearTimers])

  useEffect(() => {
    sealedRef.current = null
    clearTimers()
    // Never carry the previous conversation's overlay. A stale seed from the
    // last thread used to paint that turn on the newly opened one.
    turnRef.current = EMPTY_TURN
    setTurn(EMPTY_TURN)
    if (!signalId) return

    const flush = () => {
      flushTimerRef.current = null
      setTurn(turnRef.current)
    }

    const unsub = onGatewayEvent(`signal:${signalId}`, (event) => {
      if (!TURN_EVENTS.has(event.event)) return
      const data = (event.data ?? {}) as Record<string, unknown>
      if (!eventTargetsSignal(data, signalId)) return
      const streamId = data.stream_id != null ? String(data.stream_id) : null
      if (streamId && streamId === sealedRef.current) return
      const next = applyTurnEvent(turnRef.current, event.event, data)
      if (next === turnRef.current) return
      turnRef.current = next
      if (staleTimerRef.current !== null) window.clearTimeout(staleTimerRef.current)
      staleTimerRef.current = window.setTimeout(() => {
        // A checkpoint seed must not pin Nadenken after the worker died.
        const id = turnRef.current.streamId
        if (id) droppedSeedsRef.current.add(id)
        sealedRef.current = id
        turnRef.current = EMPTY_TURN
        setTurn(EMPTY_TURN)
      }, next.ended ? 8_000 : STALE_MS)
      if (
        event.event === 'agent.turn' ||
        event.event === 'agent.activity' ||
        event.event === 'thread.presence'
      ) {
        // Structure changed: render now so order stays correct.
        if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
        flush()
      } else if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flush, FLUSH_MS)
      }
    })
    return () => {
      unsub()
      clearTimers()
    }
  }, [signalId, clearTimers])

  useEffect(() => {
    if (!signalId) return
    if (!seed?.streamId || !seed.active) return
    if (droppedSeedsRef.current.has(seed.streamId) || sealedRef.current === seed.streamId) return
    const current = turnRef.current
    if (current.streamId && current.streamId !== seed.streamId && current.active) return
    turnRef.current = mergeTurns(seed, current.streamId === seed.streamId ? current : EMPTY_TURN)
    setTurn(turnRef.current)
    if (staleTimerRef.current === null) {
      staleTimerRef.current = window.setTimeout(() => {
        const id = turnRef.current.streamId
        if (id) droppedSeedsRef.current.add(id)
        sealedRef.current = id
        turnRef.current = EMPTY_TURN
        setTurn(EMPTY_TURN)
      }, STALE_MS)
    }
  }, [seed, signalId])

  return { turn, streaming: turn.active, reset }
}
