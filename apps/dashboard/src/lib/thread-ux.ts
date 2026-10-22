import { useEffect, useRef } from 'react'
import { appRoutes } from '../api/routes/app.routes'
import { apiPost } from './api'
import type { LiveTurn } from './agentActivity'

/**
 * Temporary probe. Reports when a live line appears, stays, or leaves,
 * so a rough moment in a thread can be read back later. No message text.
 */

type UxDetail = {
  stream_id?: string
  label_key?: string
  ms?: number
  streaming?: boolean
}

type UxEvent = { name: string; detail: UxDetail }

const HELD_MS = [8_000, 30_000]

export function useThreadUx(opts: {
  token: string | null
  signalId: string | null
  turns: LiveTurn[]
  streaming: boolean
}): void {
  const latest = useRef(opts)
  latest.current = opts
  const seen = useRef<Map<string, { label: string; at: number; held: number }>>(new Map())
  const pending = useRef<UxEvent[]>([])
  const streamOpen = useRef(false)

  useEffect(() => {
    seen.current.clear()
    pending.current = []
    streamOpen.current = false
    const queue = pending.current
    const flush = () => {
      if (!queue.length || !opts.token || !opts.signalId) return
      const events = queue.splice(0, 20)
      void apiPost(appRoutes.signals.threadUx(opts.signalId), { events }, opts.token).catch(() => {})
    }
    const push = (name: string, detail: UxDetail) => {
      queue.push({ name, detail })
      if (queue.length >= 8) flush()
    }
    const sample = () => {
      const { turns, streaming } = latest.current
      const now = Date.now()
      const active = new Map<string, string>()
      for (const turn of turns) {
        if (!turn.streamId || !turn.active) continue
        active.set(turn.streamId, turn.status?.labelKey || '')
      }
      const prev = seen.current
      for (const [id, label] of active) {
        const was = prev.get(id)
        if (!was) {
          prev.set(id, { label, at: now, held: 0 })
          push('live_shown', { stream_id: id, label_key: label })
          continue
        }
        if (was.label !== label) {
          was.label = label
          was.held = 0
          push('live_label', { stream_id: id, label_key: label, ms: now - was.at })
        }
        const age = now - was.at
        const nextHold = HELD_MS.find((mark) => age >= mark && was.held < mark)
        if (nextHold) {
          was.held = nextHold
          push('live_held', { stream_id: id, label_key: label, ms: age })
        }
      }
      for (const [id, was] of [...prev]) {
        if (active.has(id)) continue
        prev.delete(id)
        push('live_cleared', { stream_id: id, label_key: was.label, ms: now - was.at })
      }
      if (streaming && !streamOpen.current) {
        streamOpen.current = true
        push('stream_open', { streaming: true })
      } else if (!streaming && streamOpen.current) {
        streamOpen.current = false
        push('stream_close', { streaming: false })
      }
    }
    sample()
    const timer = window.setInterval(() => {
      sample()
      flush()
    }, 2000)
    return () => {
      window.clearInterval(timer)
      sample()
      flush()
    }
  }, [opts.signalId, opts.token])
}
