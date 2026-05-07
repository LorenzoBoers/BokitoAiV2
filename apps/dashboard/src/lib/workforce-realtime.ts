import { XANO_BASE_URL } from './xano'
import { API_GROUP_WORKFORCE } from './api.config'
import type { WorkforceGraphEvent } from './workforce-api'

type EventHandler = (event: WorkforceGraphEvent) => void
type StatusHandler = (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void

const MAX_RECONNECT_ATTEMPTS = 8

function isGraphEvent(value: unknown): value is WorkforceGraphEvent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.event_type === 'string'
}

export interface WorkforceRealtimeDebugEvent {
  phase: 'connect' | 'open' | 'close' | 'error' | 'give_up'
  attempt: number
  url: string
  usedToken: true
  closeCode?: number
  closeReason?: string
}

function realtimeDisabledByEnv(): boolean {
  const v = import.meta.env.VITE_DISABLE_WORKFORCE_REALTIME
  return v === 'true' || v === '1'
}

function realtimeCanonical(): string {
  const canonical = import.meta.env.VITE_WORKFORCE_REALTIME_CANONICAL
  if (typeof canonical === 'string' && canonical.trim()) return canonical.trim()
  return API_GROUP_WORKFORCE
}

export class WorkforceRealtimeClient {
  private channel: string
  private token: string
  private onEvent: EventHandler
  private onStatus?: StatusHandler
  private onDebug?: (event: WorkforceRealtimeDebugEvent) => void
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private stopped = false
  private wsUrl: string

  constructor(options: {
    channel: string
    token: string
    onEvent: EventHandler
    onStatus?: StatusHandler
    onDebug?: (event: WorkforceRealtimeDebugEvent) => void
  }) {
    this.channel = options.channel
    this.token = options.token
    this.onEvent = options.onEvent
    this.onStatus = options.onStatus
    this.onDebug = options.onDebug
    const base = XANO_BASE_URL.replace(/^http/, 'ws').replace(/\/$/, '')
    this.wsUrl = `${base}/rt/${realtimeCanonical()}`
  }

  private emitDebug(event: WorkforceRealtimeDebugEvent) {
    this.onDebug?.(event)
  }

  connect() {
    if (this.destroyed || this.stopped) return
    if (realtimeDisabledByEnv()) {
      this.stopped = true
      this.onStatus?.('disconnected')
      return
    }

    this.onStatus?.(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    const url = this.wsUrl
    this.emitDebug({
      phase: 'connect',
      attempt: this.reconnectAttempts,
      url,
      usedToken: true,
    })
    this.ws = new WebSocket(url, [this.token])

    this.ws.onopen = () => {
      this.ws?.send(
        JSON.stringify({
          action: 'join',
          options: { channel: this.channel },
          payload: { history: false, presence: false },
        }),
      )
      this.reconnectAttempts = 0
      this.emitDebug({
        phase: 'open',
        attempt: this.reconnectAttempts,
        url,
        usedToken: true,
      })
      this.onStatus?.('connected')
    }

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as unknown
        if (!data || typeof data !== 'object') return
        const frame = data as {
          action?: string
          payload?: unknown
        }
        const p = frame.payload
        if (isGraphEvent(p)) this.onEvent(p)
      } catch {
        // Ignore malformed payloads to keep the stream alive.
      }
    }

    this.ws.onclose = (evt) => {
      this.emitDebug({
        phase: 'close',
        attempt: this.reconnectAttempts,
        url,
        usedToken: true,
        closeCode: evt.code,
        closeReason: evt.reason,
      })
      if (this.destroyed) {
        this.onStatus?.('disconnected')
        return
      }
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.emitDebug({
        phase: 'error',
        attempt: this.reconnectAttempts,
        url,
        usedToken: true,
      })
      this.ws?.close()
    }
  }

  updateChannel(channel: string) {
    this.channel = channel
    this.ws?.close()
  }

  private scheduleReconnect() {
    if (this.destroyed) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.stopped = true
      this.emitDebug({
        phase: 'give_up',
        attempt: this.reconnectAttempts,
        url: this.wsUrl,
        usedToken: true,
      })
      this.onStatus?.('disconnected')
      return
    }
    this.reconnectAttempts += 1
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  destroy() {
    this.destroyed = true
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.onStatus?.('disconnected')
  }
}
