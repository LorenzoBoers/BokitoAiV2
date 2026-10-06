import type { SidebarSection } from './communication-sidebar-prefs'
import { folderScopeKey } from './inbox-folder-prefs'
import type { HubLeaf } from './messages-paths'

/** Query flag: land on this Communication folder, make it visible, flash it. */
export const NAV_REVEAL_PARAM = 'reveal'
export const NAV_REVEAL_MS = 2000

/** Append `?reveal=1` so the Communication rail unhides, scrolls, and flashes the folder. */
export function withNavReveal(path: string): string {
  const hashIndex = path.indexOf('#')
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : ''
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path
  const qIndex = withoutHash.indexOf('?')
  const pathname = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash
  const params = new URLSearchParams(qIndex >= 0 ? withoutHash.slice(qIndex + 1) : '')
  if (params.get(NAV_REVEAL_PARAM) === '1') return path
  params.set(NAV_REVEAL_PARAM, '1')
  const qs = params.toString()
  return `${pathname}?${qs}${hash}`
}

export function stripNavReveal(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete(NAV_REVEAL_PARAM)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function hasNavReveal(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get(NAV_REVEAL_PARAM) === '1'
}

/** Which Communication sidebar section holds this folder. */
export function sidebarSectionForLeaf(leaf: HubLeaf): SidebarSection | null {
  switch (leaf.type) {
    case 'project':
      return 'projects'
    case 'tag':
      return 'hashtags'
    case 'channel':
      return 'channels'
    case 'agent':
      return 'agents'
    case 'team':
      return 'teams'
    case 'inbox':
      return null
  }
}

export function navFolderSelector(scopeKey: string): string {
  return `[data-nav-folder="${cssEscape(scopeKey)}"]`
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Scroll the folder row into the Communication rail. Retries while the
 * section is unhiding / unfolding so the row exists and ends on-screen.
 */
export function scrollNavFolderIntoView(leaf: HubLeaf, onFound?: () => void): () => void {
  const scopeKey = folderScopeKey(leaf)
  let cancelled = false
  let attempts = 0

  const tick = () => {
    if (cancelled) return
    const el = document.querySelector(navFolderSelector(scopeKey))
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      requestAnimationFrame(() => {
        if (cancelled) return
        const rect = el.getBoundingClientRect()
        const scroller = el.closest('.overflow-y-auto')
        if (scroller instanceof HTMLElement) {
          const box = scroller.getBoundingClientRect()
          const above = rect.top < box.top + 8
          const below = rect.bottom > box.bottom - 8
          if (above || below) {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
          }
        }
        onFound?.()
      })
      return
    }
    attempts += 1
    if (attempts < 20) window.setTimeout(tick, 50)
  }

  tick()
  return () => {
    cancelled = true
  }
}
