import { useEffect, useRef } from 'react'
import { workspaceRoutes } from '../api/routes'
import { apiGet, apiPost } from './api'

/**
 * When the tenant flag is on, record focus, keys, animation, and bubble size.
 * No message text. Rows live 48 hours.
 */

type DebugFlag = { enabled: boolean; features: string[] }
type DebugEvent = { name: string; detail: Record<string, string | number | boolean> }

const flagCache = new Map<string, DebugFlag>()

async function loadFlag(token: string): Promise<DebugFlag> {
  const cached = flagCache.get(token)
  if (cached) return cached
  try {
    const flag = await apiGet<DebugFlag>(workspaceRoutes.debugDom(), token)
    const next = {
      enabled: Boolean(flag?.enabled),
      features: Array.isArray(flag?.features) ? flag.features : [],
    }
    flagCache.set(token, next)
    return next
  } catch {
    const off = { enabled: false, features: [] }
    flagCache.set(token, off)
    return off
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function useDebugDom(opts: {
  token: string | null
  signalId: string | null
  feature: 'communication' | 'canvas'
}): void {
  const latest = useRef(opts)
  latest.current = opts

  useEffect(() => {
    const token = opts.token
    const signalId = opts.signalId
    if (!token || !signalId) return
    let stop = false
    const pending: DebugEvent[] = []
    const cleanups: Array<() => void> = []

    const push = (name: string, detail: DebugEvent['detail']) => {
      if (pending.length >= 20) pending.shift()
      pending.push({ name, detail })
    }

    const flush = () => {
      const current = latest.current
      if (!pending.length || !current.token || !current.signalId) return
      const batch = pending.splice(0, 20)
      void apiPost(workspaceRoutes.debugDomEvents(), {
        feature: current.feature,
        signal_id: current.signalId,
        events: batch,
      }, current.token).catch(() => undefined)
    }

    void loadFlag(token).then((flag) => {
      if (stop || !flag.enabled || !flag.features.includes(opts.feature)) return

      const onFocus = (event: FocusEvent) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const id = target.id === 'inbox-reply-composer' ? target.id : ''
        push('focus', {
          tag: target.tagName.toLowerCase(),
          ...(id ? { id } : {}),
          role: target.getAttribute('role') || '',
        })
      }

      const onKey = (event: KeyboardEvent) => {
        if (isTypingTarget(event.target)) return
        if (event.key.length > 20) return
        push('key', { key: event.key, typing: false })
      }

      const onAnim = (event: AnimationEvent) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const cls = target.className
        if (typeof cls !== 'string') return
        if (!/bubble|chat-bubble/.test(cls)) return
        push('anim', {
          name: event.animationName || '',
          cls: cls.slice(0, 80),
          action: event.type === 'animationend' ? 'end' : 'start',
        })
      }

      document.addEventListener('focusin', onFocus)
      document.addEventListener('keydown', onKey)
      document.addEventListener('animationstart', onAnim)
      document.addEventListener('animationend', onAnim)
      cleanups.push(() => {
        document.removeEventListener('focusin', onFocus)
        document.removeEventListener('keydown', onKey)
        document.removeEventListener('animationstart', onAnim)
        document.removeEventListener('animationend', onAnim)
      })

      const seen = new Set<Element>()
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const box = entry.contentRect
          const el = entry.target
          const cls = el instanceof HTMLElement ? el.className : ''
          push('resize', {
            w: Math.round(box.width),
            h: Math.round(box.height),
            cls: typeof cls === 'string' ? cls.slice(0, 80) : '',
          })
        }
      })
      const watch = () => {
        document.querySelectorAll('.bubble-grow, .chat-bubble-agent').forEach((node) => {
          if (seen.has(node)) return
          seen.add(node)
          observer.observe(node)
        })
      }
      watch()
      const mutations = new MutationObserver(() => watch())
      mutations.observe(document.body, { childList: true, subtree: true })
      cleanups.push(() => {
        mutations.disconnect()
        observer.disconnect()
      })
    })

    const timer = window.setInterval(flush, 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
      flush()
      cleanups.forEach((fn) => fn())
    }
  }, [opts.token, opts.signalId, opts.feature])
}
