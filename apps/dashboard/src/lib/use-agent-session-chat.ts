/**
 * Inline agent meta-session chat for a customer thread.
 * Mirrors DirectChat (AgentChatView): single-flight, optimistic user bubble,
 * live deltas, AbortController + cooperative cancel.
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
  optimisticUser: ChatMessage | null
}

const idleStream = (): SessionStreamState => ({
  text: '',
  thinking: '',
  active: false,
  optimisticUser: null,
})

export function useAgentSessionChat(token: string | null) {
  const [stream, setStream] = useState<SessionStreamState>(idleStream)
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const stop = useCallback(async () => {
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

  const send = useCallback(
    async (
      sessionId: string,
      text: string,
      opts?: {
        onFinished?: () => void | Promise<void>
      },
    ) => {
      if (!token || !text.trim() || streamingRef.current) return false
      sessionIdRef.current = sessionId
      streamingRef.current = true
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }
      setStream({ text: '', thinking: '', active: true, optimisticUser: optimistic })
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
        setStream(idleStream())
        await opts?.onFinished?.()
      }
      return true
    },
    [token],
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
  const rows = [...(base ?? [])]
  if (stream.optimisticUser) {
    rows.push(stream.optimisticUser)
  }
  if (stream.active && (stream.text || stream.thinking)) {
    rows.push({
      id: 'local-stream',
      role: 'assistant',
      content: stream.text || (stream.thinking ? `_${stream.thinking}_` : '…'),
      created_at: new Date().toISOString(),
    })
  } else if (stream.active) {
    rows.push({
      id: 'local-stream',
      role: 'assistant',
      content: '…',
      created_at: new Date().toISOString(),
    })
  }
  return rows.length ? rows : base ?? undefined
}
