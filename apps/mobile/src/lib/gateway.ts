/**
 * Gateway WebSocket client — the mobile side of the control plane.
 *
 * Speaks the same typed protocol as the dashboard: `connect` handshake (via
 * query params), `sub`/`unsub` frames, pushed `event` frames (`message`,
 * `thread`, `agent.run`, `decision`, `notification`, `presence`).
 * Reconnects with backoff and re-subscribes automatically.
 */

import { gatewayUrl } from './config'
import { getAccessToken } from './api'

export type GatewayEvent = {
  event: string
  topics: string[]
  data: Record<string, unknown>
  ts?: string
}

export type GatewayHandler = (event: GatewayEvent) => void
export type GatewayStatus = 'connected' | 'connecting' | 'disconnected'
export type GatewayStatusHandler = (status: GatewayStatus) => void

const PING_INTERVAL_MS = 30_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

class GatewayClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<GatewayHandler>>()
  private sentTopics = new Set<string>()
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private closedByUser = false
  private statusHandlers = new Set<GatewayStatusHandler>()
  private status: GatewayStatus = 'disconnected'

  onStatus(handler: GatewayStatusHandler): () => void {
    this.statusHandlers.add(handler)
    handler(this.status)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  getStatus(): GatewayStatus {
    return this.status
  }

  private setStatus(next: GatewayStatus): void {
    if (this.status === next) return
    this.status = next
    for (const handler of this.statusHandlers) {
      try {
        handler(next)
      } catch {
        // status handler errors must not break the socket loop
      }
    }
  }

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

  disconnect() {
    this.closedByUser = true
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.sentTopics.clear()
    this.setStatus('disconnected')
  }

  reset() {
    // Called after login/logout so existing subscribers reconnect with the new token.
    this.disconnect()
    this.closedByUser = false
    if (this.handlers.size > 0) this.ensureConnected()
  }

  private ensureConnected() {
    if (this.closedByUser) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    const token = getAccessToken()
    if (!token) return

    this.setStatus('connecting')
    const ws = new WebSocket(gatewayUrl(token))
    this.ws = ws

    ws.onopen = () => {
      this.setStatus('connected')
      this.reconnectDelay = RECONNECT_MIN_MS
      this.sentTopics.clear()
      this.syncSubscriptions()
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, PING_INTERVAL_MS)
    }

    ws.onmessage = (msg) => {
      let frame: { type?: string } & GatewayEvent
      try {
        frame = JSON.parse(String(msg.data))
      } catch {
        return
      }
      if ((frame as { type?: string }).type !== 'event') return
      const seen = new Set<GatewayHandler>()
      for (const topic of frame.topics ?? []) {
        const set = this.handlers.get(topic)
        if (!set) continue
        for (const handler of set) {
          if (seen.has(handler)) continue
          seen.add(handler)
          handler(frame)
        }
      }
    }

    ws.onclose = () => {
      this.clearTimers()
      this.ws = null
      this.sentTopics.clear()
      this.setStatus('disconnected')
      if (this.closedByUser || this.handlers.size === 0) return
      this.reconnectTimer = setTimeout(() => this.ensureConnected(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  private syncSubscriptions() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const wanted = [...this.handlers.keys()].filter((topic) => !this.sentTopics.has(topic))
    if (wanted.length === 0) return
    this.ws.send(JSON.stringify({ type: 'sub', topics: wanted }))
    for (const topic of wanted) this.sentTopics.add(topic)
  }

  private clearTimers() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

export const gateway = new GatewayClient()

export function onGatewayEvent(topic: string, handler: GatewayHandler): () => void {
  return gateway.subscribe(topic, handler)
}

export function onGatewayStatus(handler: GatewayStatusHandler): () => void {
  return gateway.onStatus(handler)
}
