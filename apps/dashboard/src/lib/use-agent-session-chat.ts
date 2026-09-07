/**
 * Inline agent meta-session chat for a customer thread.
 * Mid-stream Send aborts the current reply, buffers new texts, then starts
 * one turn with the joined buffer after a short settle.
 */
import { useCallback, useRef, useState } from 'react'
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

const SETTLE_MS = 400

const idleStream = (): SessionStreamState => ({
  text: '',
  thinking: '',
  active: false,
  optimisticUsers: [],
})

export function useAgentSessionChat(token: string | null) {
  const [stream, setStream] = useState<SessionStreamState>(idleStream)
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pendingPartsRef = useRef<string[]>([])
  const flushTimerRef = useRef<number | null>(null)
  const onFinishedRef = useRef<(() => void | Promise<void>) | undefined>(undefined)
  const runStreamRef = useRef<(sessionId: string, text: string) => Promise<void>>(async () => {})

  const clearFlushTimer = () => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }

  const stop = useCallback(async () => {
    clearFlushTimer()
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

  const scheduleFlush = useCallback((sessionId: string) => {
    clearFlushTimer()
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      if (streamingRef.current) {
        scheduleFlush(sessionId)
        return
      }
      const parts = pendingPartsRef.current.map((p) => p.trim()).filter(Boolean)
      if (!parts.length) return
      pendingPartsRef.current = []
      void runStreamRef.current(sessionId, parts.join('\n\n'))
    }, SETTLE_MS)
  }, [])

  const runStream = useCallback(
    async (sessionId: string, text: string) => {
      if (!token || !text.trim()) return
      sessionIdRef.current = sessionId
      streamingRef.current = true
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
          text,
          (delta) => {
            setStream((prev) => ({ ...prev, text: prev.text + delta, active: true }))
          },
          controller.signal,
          (thinkingDelta) => {
            setStream((prev) => ({
              ...prev,
              thinking: prev.thinking + thinkingDelta,
              active: true,
            }))
          },
        )
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          throw err
        }
      } finally {
        streamingRef.current = false
        abortRef.current = null
        setStream((prev) => ({
          text: '',
          thinking: '',
          active: pendingPartsRef.current.length > 0,
          optimisticUsers: prev.optimisticUsers,
        }))
        await onFinishedRef.current?.()
        if (pendingPartsRef.current.length) {
          scheduleFlush(sessionId)
        } else {
          setStream((prev) => ({ ...prev, active: false, optimisticUsers: [] }))
        }
      }
    },
    [token, scheduleFlush],
  )
  runStreamRef.current = runStream

  const send = useCallback(
    async (
      sessionId: string,
      text: string,
      opts?: {
        onFinished?: () => void | Promise<void>
      },
    ) => {
      if (!token || !text.trim()) return false
      onFinishedRef.current = opts?.onFinished
      sessionIdRef.current = sessionId
      const trimmed = text.trim()
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
      }
      setStream((prev) => ({
        ...prev,
        optimisticUsers: [...prev.optimisticUsers, optimistic],
        active: true,
      }))

      pendingPartsRef.current.push(trimmed)

      if (streamingRef.current) {
        abortRef.current?.abort()
        void bokitoCancelConversation(token, sessionId).catch(() => {})
        scheduleFlush(sessionId)
        return true
      }

      clearFlushTimer()
      const parts = pendingPartsRef.current.map((p) => p.trim()).filter(Boolean)
      pendingPartsRef.current = []
      await runStream(sessionId, parts.join('\n\n'))
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

/** Merge persisted transcript with the in-flight optimistic + stream bubbles. */
export function mergeSessionLiveMessages(
  base: ChatMessage[] | null | undefined,
  stream: SessionStreamState,
): ChatMessage[] | undefined {
  const withUsers = [...(base ?? [])]
  for (const user of stream.optimisticUsers) {
    if (!withUsers.some((r) => r.id === user.id)) withUsers.push(user)
  }
  if (stream.active && (stream.text || stream.thinking)) {
    withUsers.push({
      id: 'local-stream',
      role: 'assistant',
      content: stream.text || (stream.thinking ? `_${stream.thinking}_` : '…'),
      created_at: new Date().toISOString(),
    })
  } else if (stream.active) {
    withUsers.push({
      id: 'local-stream',
      role: 'assistant',
      content: '…',
      created_at: new Date().toISOString(),
    })
  }
  return withUsers.length ? withUsers : base ?? undefined
}
