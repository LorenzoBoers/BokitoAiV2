/**
 * WebSocket client for `/api/ws`. Reconnects with backoff, re-subscribes, and
 * maps server events onto query invalidations.
 */
import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { WS_URL } from './api.config'
import { authStore } from './auth-store'

type Event = { topic?: string; event?: string; id?: string; op?: string; [k: string]: unknown }

export class Realtime {
  private ws: WebSocket | null = null
  private topics = new Set<string>(['conversations', 'decisions', 'notifications'])
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(e: Event) => void>()
  private stopped = false

  constructor(private token: () => string | null) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }

  on(fn: (e: Event) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  subscribe(topic: string) {
    this.topics.add(topic)
    this.send({ op: 'subscribe', topics: [topic] })
    return () => {
      this.topics.delete(topic)
      this.send({ op: 'unsubscribe', topics: [topic] })
    }
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data))
  }

  private connect() {
    const token = this.token()
    if (!token || this.stopped) return
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.send({ op: 'subscribe', topics: [...this.topics] })
    }
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(String(m.data)) as Event
        if (e.op === 'pong') return
        this.listeners.forEach((fn) => fn(e))
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => {
      this.ws = null
      if (this.stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }
}

export function applyEvent(qc: QueryClient, e: Event) {
  const topic = e.topic ?? ''
  if (topic === 'conversations') {
    void qc.invalidateQueries({ queryKey: ['conversations'] })
    if (e.id) {
      void qc.invalidateQueries({ queryKey: ['conversation', e.id] })
      void qc.invalidateQueries({ queryKey: ['thread', e.id] })
    }
  } else if (topic.startsWith('conversation:')) {
    const id = topic.slice('conversation:'.length)
    void qc.invalidateQueries({ queryKey: ['thread', id] })
    void qc.invalidateQueries({ queryKey: ['conversation', id] })
    void qc.invalidateQueries({ queryKey: ['conversations'] })
  } else if (topic === 'decisions') {
    void qc.invalidateQueries({ queryKey: ['decisions'] })
    void qc.invalidateQueries({ queryKey: ['thread'] })
  } else if (topic.startsWith('run:')) {
    void qc.invalidateQueries({ queryKey: ['run', topic.slice(4)] })
    void qc.invalidateQueries({ queryKey: ['runs'] })
  } else if (topic === 'notifications') {
    void qc.invalidateQueries({ queryKey: ['decisions'] })
  }
}

let shared: Realtime | null = null

export function realtime(): Realtime {
  if (!shared) shared = new Realtime(() => authStore.token)
  return shared
}

/** Mount once inside the authenticated shell. */
export function useRealtime() {
  const qc = useQueryClient()
  useEffect(() => {
    const rt = realtime()
    const off = rt.on((e) => applyEvent(qc, e))
    rt.start()
    const unsub = authStore.subscribe(() => {
      rt.stop()
      if (authStore.token) rt.start()
    })
    return () => {
      off()
      unsub()
      rt.stop()
    }
  }, [qc])
}

export function useTopic(topic: string | undefined) {
  useEffect(() => {
    if (!topic) return
    return realtime().subscribe(topic)
  }, [topic])
}
