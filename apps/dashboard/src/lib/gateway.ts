/**
 * Gateway WebSocket client — the dashboard side of the control plane.
 *
 * One connection to `/api/ws`; components subscribe to topics
 * (`threads`, `decisions`, `notifications`, `runs`, `run:<id>`, `signal:<id>`)
 * and receive typed events (`message`, `thread`, `agent.run`, `decision`,
 * `notification`, `presence`, `health`). Reconnects with backoff and
 * re-subscribes automatically.
 */

import { resolveAccessToken } from './api'

export type GatewayEvent = {
  event: string
  topics: string[]
  data: Record<string, unknown>
  ts?: string
}

export type GatewayHandler = (event: GatewayEvent) => void

const PING_INTERVAL_MS = 30_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

function gatewayUrl(token: string): string {
  const wsOrigin = window.location.origin.replace(/^http/, 'ws')
  const params = new URLSearchParams({ access_token: token, device: 'dashboard' })
  return `${wsOrigin}/api/ws?${params.toString()}`
}

class GatewayClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<GatewayHandler>>()
  private sentTopics = new Set<string>()
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: number | null = null
  private pingTimer: number | null = null
  private closedByUser = false

  subscribe(topic: string, handler: GatewayHandler): () => void {
    let set = this.handlers.get(topic)
    if (!set) {
      set = new Set()
      this.handlers.set(topic, set)
    }
    set.add(handler)
    this.ensureConnected()
    this.syncSubscriptions()
    return () => {
      const current = this.handlers.get(topic)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) {
        this.handlers.delete(topic)
        if (this.ws?.readyState === WebSocket.OPEN && this.sentTopics.has(topic)) {
          this.ws.send(JSON.stringify({ type: 'unsub', topics: [topic] }))
          this.sentTopics.delete(topic)
        }
      }
    }
  }

  /** Drop the connection (e.g. on logout). Subscriptions stay registered. */
  disconnect(): void {
    this.closedByUser = true
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.sentTopics.clear()
  }

  private ensureConnected(): void {
    this.closedByUser = false
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    const token = resolveAccessToken() ?? ''
    if (!token) {
      this.scheduleReconnect()
      return
    }
    try {
      this.ws = new WebSocket(gatewayUrl(token))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.sentTopics.clear()
    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS
      this.syncSubscriptions()
      this.startPing()
    }
    this.ws.onmessage = (raw) => {
      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(String(raw.data))
      } catch {
        return
      }
      if (frame.type !== 'event') return
      const event: GatewayEvent = {
        event: String(frame.event ?? ''),
        topics: Array.isArray(frame.topics) ? frame.topics.map(String) : [],
        data: (frame.data && typeof frame.data === 'object' ? frame.data : {}) as Record<string, unknown>,
        ts: typeof frame.ts === 'string' ? frame.ts : undefined,
      }
      const seen = new Set<GatewayHandler>()
      for (const topic of event.topics) {
        const set = this.handlers.get(topic)
        if (!set) continue
        for (const handler of set) {
          if (seen.has(handler)) continue
          seen.add(handler)
          try {
            handler(event)
          } catch {
            // handler errors must not break the socket loop
          }
        }
      }
    }
    this.ws.onclose = () => {
      this.clearTimers()
      this.ws = null
      this.sentTopics.clear()
      if (!this.closedByUser && this.handlers.size > 0) this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private syncSubscriptions(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const pending = [...this.handlers.keys()].filter((t) => !this.sentTopics.has(t))
    if (pending.length === 0) return
    this.ws.send(JSON.stringify({ type: 'sub', topics: pending }))
    for (const topic of pending) this.sentTopics.add(topic)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.handlers.size > 0) this.ensureConnected()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }

  private startPing(): void {
    if (this.pingTimer !== null) return
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, PING_INTERVAL_MS)
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

let singleton: GatewayClient | null = null

export function getGateway(): GatewayClient {
  if (!singleton) singleton = new GatewayClient()
  return singleton
}

/** Subscribe to a gateway topic. Returns an unsubscribe function. */
export function onGatewayEvent(topic: string, handler: GatewayHandler): () => void {
  return getGateway().subscribe(topic, handler)
}
