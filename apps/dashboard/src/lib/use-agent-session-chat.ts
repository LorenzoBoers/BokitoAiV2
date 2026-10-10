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

export type SessionStreamState = {
  text: string
  thinking: string
  active: boolean
  optimisticUsers: ChatMessage[]
}

type PendingPart = {
  text: string
  attachments?: unknown[]
}

const SETTLE_MS = 400
/** Flush batched text deltas at most this often (avoids setState per chunk). */
const FLUSH_MS = 64

const idleStream = (): SessionStreamState => ({
  text: '',
  thinking: '',
  active: false,
  optimisticUsers: [],
})

/** @deprecated Prefer useAiChatStream — kept as alias for existing imports. */
export function useAgentSessionChat(token: string | null) {
  return useAiChatStream(token)
}

export function useAiChatStream(token: string | null) {
  const [stream, setStream] = useState<SessionStreamState>(idleStream)
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pendingPartsRef = useRef<PendingPart[]>([])
  const flushTimerRef = useRef<number | null>(null)
  const onFinishedRef = useRef<(() => void | Promise<void>) | undefined>(undefined)
  const runStreamRef = useRef<
    (sessionId: string, text: string, attachments?: unknown[]) => Promise<void>
  >(async () => {})

  // Batched SSE text — mirrored into React on a timer, not per token.
  const pendingDeltaRef = useRef({ text: '', thinking: '' })
  const deltaFlushTimerRef = useRef<number | null>(null)
  const committedStreamRef = useRef({ text: '', thinking: '' })

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
    pendingDeltaRef.current = { text: '', thinking: '' }
  }

  const flushDeltasNow = useCallback(() => {
    deltaFlushTimerRef.current = null
    const pending = pendingDeltaRef.current
    if (!pending.text && !pending.thinking) return
    pendingDeltaRef.current = { text: '', thinking: '' }
    committedStreamRef.current = {
      text: committedStreamRef.current.text + pending.text,
      thinking: committedStreamRef.current.thinking + pending.thinking,
    }
    const { text, thinking } = committedStreamRef.current
    setStream((prev) => ({ ...prev, text, thinking, active: true }))
  }, [])

  const scheduleDeltaFlush = useCallback(() => {
    if (deltaFlushTimerRef.current != null) return
    deltaFlushTimerRef.current = window.setTimeout(flushDeltasNow, FLUSH_MS)
  }, [flushDeltasNow])

  const stop = useCallback(async () => {
    clearFlushTimer()
    clearDeltaFlush()
    pendingPartsRef.current = []
    const sessionId = sessionIdRef.current
    abortRef.current?.abort()
    abortRef.current = null
    if (token && sessionId) {
      try {
        await bokitoCancelConversation(token, sessionId)
      } catch {
        // Best-effort; client abort already dropped the SSE body.
      }
    }
  }, [token])

  const takePending = (): { text: string; attachments?: unknown[] } | null => {
    const parts = pendingPartsRef.current
    if (!parts.length) return null
    pendingPartsRef.current = []
    const text = parts
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join('\n\n')
    const attachments = [...parts].reverse().find((p) => p.attachments?.length)?.attachments
    if (!text && !attachments?.length) return null
    return { text: text || ' ', attachments }
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
      void runStreamRef.current(sessionId, next.text, next.attachments)
    }, SETTLE_MS)
  }, [])

  const runStream = useCallback(
    async (sessionId: string, text: string, attachments?: unknown[]) => {
      if (!token || (!text.trim() && !attachments?.length)) return
      sessionIdRef.current = sessionId
      streamingRef.current = true
      clearDeltaFlush()
      committedStreamRef.current = { text: '', thinking: '' }
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
            pendingDeltaRef.current.text += delta
            scheduleDeltaFlush()
          },
          controller.signal,
          (thinkingDelta) => {
            pendingDeltaRef.current.thinking += thinkingDelta
            scheduleDeltaFlush()
          },
          attachments?.length ? { attachments } : undefined,
        )
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          throw err
        }
      } finally {
        flushDeltasNow()
        streamingRef.current = false
        abortRef.current = null
        setStream((prev) => ({
          text: '',
          thinking: '',
          active: pendingPartsRef.current.length > 0,
          optimisticUsers: prev.optimisticUsers,
        }))
        committedStreamRef.current = { text: '', thinking: '' }
        await onFinishedRef.current?.()
        if (pendingPartsRef.current.length) {
          scheduleFlush(sessionId)
        } else {
          setStream((prev) => ({ ...prev, active: false, optimisticUsers: [] }))
        }
      }
    },
    [token, scheduleFlush, scheduleDeltaFlush, flushDeltasNow],
  )
  runStreamRef.current = runStream

  // Abort in-flight SSE and settle timers when the host thread unmounts.
  useEffect(() => {
    return () => {
      clearFlushTimer()
      clearDeltaFlush()
      pendingPartsRef.current = []
      abortRef.current?.abort()
      abortRef.current = null
      streamingRef.current = false
    }
  }, [])

  const send = useCallback(
    async (
      sessionId: string,
      text: string,
      opts?: {
        onFinished?: () => void | Promise<void>
        attachments?: unknown[]
      },
    ) => {
      const trimmed = text.trim()
      const attachments = opts?.attachments?.length ? opts.attachments : undefined
      if (!token || (!trimmed && !attachments?.length)) return false
      onFinishedRef.current = opts?.onFinished
      sessionIdRef.current = sessionId
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        content: trimmed || ' ',
        created_at: new Date().toISOString(),
        attachments: attachments ?? undefined,
      }
      setStream((prev) => ({
        ...prev,
        optimisticUsers: [...prev.optimisticUsers, optimistic],
        active: true,
      }))

      pendingPartsRef.current.push({ text: trimmed || ' ', attachments })

      if (streamingRef.current) {
        abortRef.current?.abort()
        void bokitoCancelConversation(token, sessionId).catch(() => {})
        scheduleFlush(sessionId)
        return true
      }

      clearFlushTimer()
      const next = takePending()
      if (!next) return false
      await runStream(sessionId, next.text, next.attachments)
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