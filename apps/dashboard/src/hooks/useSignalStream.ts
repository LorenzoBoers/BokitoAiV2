import { useCallback, useEffect, useRef, useState } from 'react'
import { onGatewayEvent } from '../lib/gateway'

export type AgentStep = {
  id: string
  stepType: string
  name: string
  payload: Record<string, unknown>
}

export type SignalStreamState = {
  streamText: string
  thinkingText: string
  streaming: boolean
  steps: AgentStep[]
}

const EMPTY: SignalStreamState = {
  streamText: '',
  thinkingText: '',
  streaming: false,
  steps: [],
}

/** Flush batched text deltas at most this often (avoids setState per chunk). */
const FLUSH_MS = 64

type Pending = {
  streamText: string
  thinkingText: string
  streaming: boolean
  steps: AgentStep[] | null
  resetTexts: boolean
}

/** Subscribe to gateway message.delta, agent.thinking, and agent.step for a thread. */
export function useSignalStream(signalId: string | null) {
  const [state, setState] = useState<SignalStreamState>(EMPTY)
  // After the final `message` event, ignore late deltas/steps from the same
  // stream_id so the live ThinkingTrace cannot stick after the reply lands.
  const sealedStreamIdRef = useRef<string | null>(null)
  const activeStreamIdRef = useRef<string | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  // Mirror of committed state so flush can merge without reading setState.
  const committedRef = useRef<SignalStreamState>(EMPTY)

  const clearFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    pendingRef.current = null
  }, [])

  const flushNow = useCallback(() => {
    flushTimerRef.current = null
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    const prev = committedRef.current
    const next: SignalStreamState = {
      streamText: pending.resetTexts
        ? pending.streamText
        : prev.streamText + pending.streamText,
      thinkingText: pending.resetTexts
        ? pending.thinkingText
        : prev.thinkingText + pending.thinkingText,
      streaming: pending.streaming,
      steps: pending.steps ?? prev.steps,
    }
    committedRef.current = next
    setState(next)
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = window.setTimeout(flushNow, FLUSH_MS)
  }, [flushNow])

  const reset = useCallback(() => {
    sealedStreamIdRef.current = activeStreamIdRef.current
    activeStreamIdRef.current = null
    clearFlush()
    committedRef.current = EMPTY
    setState(EMPTY)
  }, [clearFlush])

  useEffect(() => {
    if (!signalId) {
      sealedStreamIdRef.current = null
      activeStreamIdRef.current = null
      clearFlush()
      committedRef.current = EMPTY
      setState(EMPTY)
      return
    }

    const acceptStreamEvent = (streamIdRaw: unknown): boolean => {
      const sid = streamIdRaw != null && String(streamIdRaw) ? String(streamIdRaw) : null
      if (sid && sealedStreamIdRef.current && sid === sealedStreamIdRef.current) {
        return false
      }
      if (sid && sid !== activeStreamIdRef.current) {
        // New agent turn — unseal and start fresh.
        sealedStreamIdRef.current = null
        activeStreamIdRef.current = sid
        return true
      }
      if (sealedStreamIdRef.current && !sid) {
        return false
      }
      if (sid) activeStreamIdRef.current = sid
      return true
    }

    const ensurePending = (): Pending => {
      if (!pendingRef.current) {
        pendingRef.current = {
          streamText: '',
          thinkingText: '',
          streaming: true,
          steps: null,
          resetTexts: false,
        }
      }
      return pendingRef.current
    }

    const unsub = onGatewayEvent(`signal:${signalId}`, (event) => {
      if (event.event === 'message.delta') {
        if (!acceptStreamEvent(event.data.stream_id)) return
        const delta = String(event.data.delta ?? '')
        if (!delta) return
        const pending = ensurePending()
        pending.streaming = true
        pending.streamText += delta
        scheduleFlush()
      } else if (event.event === 'agent.thinking') {
        if (!acceptStreamEvent(event.data.stream_id)) return
        const delta = String(event.data.delta ?? '')
        if (!delta) return
        const pending = ensurePending()
        pending.streaming = true
        pending.thinkingText += delta
        scheduleFlush()
      } else if (event.event === 'agent.step') {
        const sid = event.data.stream_id != null ? String(event.data.stream_id) : null
        const isNewStream = Boolean(
          sid && sid !== activeStreamIdRef.current && sid !== sealedStreamIdRef.current,
        )
        if (!acceptStreamEvent(event.data.stream_id)) return
        const stepType = String(event.data.step_type ?? '')
        const name = String(event.data.name ?? '')
        const payload = (event.data.payload as Record<string, unknown>) ?? {}
        // Steps change structure — flush text first so order stays correct,
        // then apply the step immediately.
        flushNow()
        const prev = committedRef.current
        const next: SignalStreamState = {
          streamText: isNewStream ? '' : prev.streamText,
          thinkingText: isNewStream ? '' : prev.thinkingText,
          streaming: true,
          steps: [
            ...(isNewStream ? [] : prev.steps),
            {
              id: `${stepType}-${name}-${isNewStream ? 0 : prev.steps.length}`,
              stepType,
              name,
              payload,
            },
          ],
        }
        committedRef.current = next
        setState(next)
      } else if (event.event === 'message') {
        // Seal the active stream so late tool/think events cannot reopen the bubble.
        // Use a sentinel when no stream was active yet (e.g. user message publish)
        // so stray events without a stream_id are ignored until a new stream starts.
        sealedStreamIdRef.current = activeStreamIdRef.current ?? '__sealed__'
        activeStreamIdRef.current = null
        clearFlush()
        committedRef.current = EMPTY
        setState(EMPTY)
      }
    })
    return () => {
      unsub()
      sealedStreamIdRef.current = null
      activeStreamIdRef.current = null
      clearFlush()
      committedRef.current = EMPTY
      setState(EMPTY)
    }
  }, [signalId, clearFlush, flushNow, scheduleFlush])

  return { ...state, reset }
}
