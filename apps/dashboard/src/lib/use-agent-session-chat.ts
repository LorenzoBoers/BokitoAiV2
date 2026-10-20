/**
 * AI chat stream for assistant threads and inline AI conversations.
 * Mid-stream Send aborts the current reply, buffers new texts, then starts
 * one turn with the joined buffer after a short settle.
 *
 * SSE deltas are batched (same cadence as useSignalStream) so React does not
 * re-render on every token.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  bokitoCancelConversation,
  bokitoStreamMessage,
  type ChatMessage,
} from './signals-api'
import { rememberAskListKey } from './session-timeline'

export type SessionStreamState = {
  text: string
  thinking: string
  /** Server speech bubbles. Empty when the stream only sent chunks. */
  parts: string[]
  active: boolean
  optimisticUsers: ChatMessage[]
}

type PendingPart = {
  text: string
  attachments?: unknown[]
  continuePending?: boolean
}

const SETTLE_MS = 400
/** Flush batched text deltas at most this often (avoids setState per chunk). */
const FLUSH_MS = 64

const idleStream = (): SessionStreamState => ({
  text: '',
  thinking: '',
  parts: [],
  active: false,
  optimisticUsers: [],
})

/** @deprecated Prefer useAiChatStream — kept as alias for existing imports. */
export function useAgentSessionChat(token: string | null, conversationId: string | null = null) {
  return useAiChatStream(token, conversationId)
}

export function useAiChatStream(token: string | null, conversationId: string | null = null) {
  const [stream, setStream] = useState<SessionStreamState>(idleStream)
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pendingPartsRef = useRef<PendingPart[]>([])
  const flushTimerRef = useRef<number | null>(null)
  const onFinishedRef = useRef<(() => void | Promise<void>) | undefined>(undefined)
  const runStreamRef = useRef<
    (
      sessionId: string,
      text: string,
      attachments?: unknown[],
      continuePending?: boolean,
    ) => Promise<void>
  >(async () => {})

  // Batched SSE text — mirrored into React on a timer, not per token.
  const pendingDeltaRef = useRef({ text: '', thinking: '', replaceText: false, parts: [] as string[] })
  const deltaFlushTimerRef = useRef<number | null>(null)
  const committedStreamRef = useRef({ text: '', thinking: '', parts: [] as string[] })

  const clearFlushTimer = () => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }

  const clearDeltaFlush = () => {
    if (deltaFlushTimerRef.current != null) {
      window.clearTimeout(deltaFlushTimerRef.current)
      deltaFlushTimerRef.current = null
    }
    pendingDeltaRef.current = { text: '', thinking: '', replaceText: false, parts: [] }
  }

  const flushDeltasNow = useCallback(() => {
    deltaFlushTimerRef.current = null
    // Stop / abort must win over a late batched flush — otherwise Stop and
    // “Nadenken” linger after the operator cancels.
    if (!streamingRef.current) {
      pendingDeltaRef.current = { text: '', thinking: '', replaceText: false, parts: [] }
      return
    }
    const pending = pendingDeltaRef.current
    if (!pending.text && !pending.thinking) return
    pendingDeltaRef.current = { text: '', thinking: '', replaceText: false, parts: [] }
    committedStreamRef.current = {
      text: pending.replaceText ? pending.text : committedStreamRef.current.text + pending.text,
      thinking: committedStreamRef.current.thinking + pending.thinking,
      parts: pending.replaceText ? pending.parts : committedStreamRef.current.parts,
    }
    const { text, thinking, parts } = committedStreamRef.current
    setStream((prev) => ({ ...prev, text, thinking, parts, active: true }))
  }, [])

  const scheduleDeltaFlush = useCallback(() => {
    if (!streamingRef.current) return
    if (deltaFlushTimerRef.current != null) return
    deltaFlushTimerRef.current = window.setTimeout(flushDeltasNow, FLUSH_MS)
  }, [flushDeltasNow])

  const stop = useCallback(async () => {
    clearFlushTimer()
    clearDeltaFlush()
    pendingPartsRef.current = []
    const sessionId = sessionIdRef.current
    // Mark idle before abort so any in-flight delta callback / timer cannot
    // revive `active` after this return.
    streamingRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
    // Clear busy immediately so Stop / “Nadenken” do not linger while the
    // cancel request is in flight (or if the SSE finally never settles).
    committedStreamRef.current = { text: '', thinking: '', parts: [] }
    pendingDeltaRef.current = { text: '', thinking: '', replaceText: false, parts: [] }
    setStream((prev) => ({
      ...prev,
      text: '',
      thinking: '',
      active: false,
      optimisticUsers: [],
    }))
    if (token && sessionId) {
      try {
        await bokitoCancelConversation(token, sessionId)
      } catch {
        // Best-effort; client abort already dropped the SSE body.
      }
    }
    // Drop anything that arrived between abort and cancel settling.
    clearDeltaFlush()
    committedStreamRef.current = { text: '', thinking: '', parts: [] }
    setStream((prev) => ({
      ...prev,
      text: '',
      thinking: '',
      active: false,
      optimisticUsers: [],
    }))
  }, [token])
  const takePending = (): {
    text: string
    attachments?: unknown[]
    continuePending?: boolean
  } | null => {
    const parts = pendingPartsRef.current
    if (!parts.length) return null
    pendingPartsRef.current = []
    const continuePending = parts.some((p) => p.continuePending)
    const text = parts
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join('\n\n')
    const attachments = [...parts].reverse().find((p) => p.attachments?.length)?.attachments
    if (!continuePending && !text && !attachments?.length) return null
    return { text: text || ' ', attachments, continuePending }
  }

  const scheduleFlush = useCallback((sessionId: string) => {
    clearFlushTimer()
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      if (streamingRef.current) {
        scheduleFlush(sessionId)
        return
      }
      const next = takePending()
      if (!next) return
      void runStreamRef.current(
        sessionId,
        next.text,
        next.attachments,
        next.continuePending,
      )
    }, SETTLE_MS)
  }, [])

  const runStream = useCallback(
    async (
      sessionId: string,
      text: string,
      attachments?: unknown[],
      continuePending?: boolean,
    ) => {
      if (!token || (!continuePending && !text.trim() && !attachments?.length)) return
      sessionIdRef.current = sessionId
      streamingRef.current = true
      clearDeltaFlush()
      committedStreamRef.current = { text: '', thinking: '', parts: [] }
      setStream((prev) => ({
        ...prev,
        text: '',
        thinking: '',
        active: true,
      }))
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await bokitoStreamMessage(
          token,
          sessionId,
          text.trim() || ' ',
          (delta) => {
            if (pendingDeltaRef.current.replaceText) return
            pendingDeltaRef.current.text += delta
            scheduleDeltaFlush()
          },
          controller.signal,
          (thinkingDelta) => {
            pendingDeltaRef.current.thinking += thinkingDelta
            scheduleDeltaFlush()
          },
          {
            ...(attachments?.length ? { attachments } : {}),
            ...(continuePending ? { continuePending: true } : {}),
            onParts: (parts) => {
              const bubbles = parts.filter((part) => part.trim())
              pendingDeltaRef.current.text = bubbles.join('\n\n')
              pendingDeltaRef.current.parts = bubbles
              pendingDeltaRef.current.replaceText = true
              scheduleDeltaFlush()
            },
          },
        )
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          throw err
        }
      } finally {
        const aborted = !streamingRef.current || abortRef.current !== controller
        if (!aborted) {
          flushDeltasNow()
        } else {
          clearDeltaFlush()
          committedStreamRef.current = { text: '', thinking: '', parts: [] }
        }
        streamingRef.current = false
        abortRef.current = null
        const keepOptimistic = !aborted && pendingPartsRef.current.length > 0
        setStream((prev) => ({
          text: '',
          thinking: '',
          parts: [],
          active: keepOptimistic,
          // Drop before the transcript refresh so the persisted bubble
          // does not sit next to the local one.
          optimisticUsers: keepOptimistic ? prev.optimisticUsers : [],
        }))
        committedStreamRef.current = { text: '', thinking: '', parts: [] }
        await onFinishedRef.current?.()
        if (!aborted && pendingPartsRef.current.length) {
          scheduleFlush(sessionId)
        } else {
          pendingPartsRef.current = []
          setStream((prev) => ({ ...prev, active: false, optimisticUsers: [] }))
        }
      }
    },
    [token, scheduleFlush, scheduleDeltaFlush, flushDeltasNow],
  )
  runStreamRef.current = runStream

  // Drop the previous conversation's SSE when the open thread changes.
  // The server turn on that other thread keeps running; this view must not.
  useEffect(() => {
    clearFlushTimer()
    clearDeltaFlush()
    pendingPartsRef.current = []
    abortRef.current?.abort()
    abortRef.current = null
    streamingRef.current = false
    sessionIdRef.current = null
    committedStreamRef.current = { text: '', thinking: '', parts: [] }
    setStream(idleStream())
    return () => {
      clearFlushTimer()
      clearDeltaFlush()
      pendingPartsRef.current = []
      abortRef.current?.abort()
      abortRef.current = null
      streamingRef.current = false
    }
  }, [conversationId])

  const send = useCallback(
    async (
      sessionId: string,
      text: string,
      opts?: {
        onFinished?: () => void | Promise<void>
        attachments?: unknown[]
        /** Kick the agent on an opener already stored with the thread. */
        continuePending?: boolean
      },
    ) => {
      const trimmed = text.trim()
      const attachments = opts?.attachments?.length ? opts.attachments : undefined
      const continuePending = Boolean(opts?.continuePending)
      if (!token || (!continuePending && !trimmed && !attachments?.length)) return false
      onFinishedRef.current = opts?.onFinished
      sessionIdRef.current = sessionId
      // Opener is already on the server when continuePending; skip the phantom bubble.
      if (!continuePending) {
        const optimistic: ChatMessage = {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: 'user',
          content: trimmed || ' ',
          created_at: new Date().toISOString(),
          attachments: attachments ?? undefined,
        }
        if (trimmed) rememberAskListKey(trimmed, optimistic.id)
        setStream((prev) => ({
          ...prev,
          optimisticUsers: [...prev.optimisticUsers, optimistic],
          active: true,
        }))
      } else {
        setStream((prev) => ({ ...prev, active: true }))
      }

      pendingPartsRef.current.push({
        text: trimmed || ' ',
        attachments,
        continuePending,
      })

      if (streamingRef.current) {
        abortRef.current?.abort()
        void bokitoCancelConversation(token, sessionId).catch(() => {})
        scheduleFlush(sessionId)
        return true
      }

      clearFlushTimer()
      const next = takePending()
      if (!next) return false
      await runStream(
        sessionId,
        next.text,
        next.attachments,
        next.continuePending,
      )
      return true
    },
    [token, scheduleFlush, runStream],
  )

  return {
    stream,
    agentStreaming: stream.active,
    send,
    stop,
    streamingRef,
  }
}