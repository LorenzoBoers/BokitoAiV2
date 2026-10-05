import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

const STORED = 'data-bokito-tip'
const LAYER = 'data-bokito-tip-layer'
const DERIVED_LABEL = 'data-bokito-tip-label'

type TipState = {
  text: string
  x: number
  y: number
  place: 'top' | 'bottom'
}

/** Raw JSON / array dumps are never useful as hover labels. */
function isRawDump(text: string): boolean {
  const trimmed = text.trim()
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )
}

/** Move native `title` aside so the browser never draws its own tooltip. */
function disarmTitle(el: Element): string | null {
  const existing = el.getAttribute(STORED)?.trim()
  const title = el.getAttribute('title')?.trim()
  if (title) {
    // Still strip dumps so the native tip never appears; just don't show ours.
    if (isRawDump(title)) {
      el.removeAttribute('title')
      return null
    }
    el.setAttribute(STORED, title)
    el.removeAttribute('title')
    // `title` was the accessible name of icon-only controls; keep one.
    const derived = el.hasAttribute(DERIVED_LABEL)
    if (
      derived ||
      (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim())
    ) {
      el.setAttribute('aria-label', title)
      el.setAttribute(DERIVED_LABEL, '')
    }
    return title
  }
  if (existing && isRawDump(existing)) return null
  return existing || null
}

function disarmTree(root: ParentNode) {
  if (root instanceof Element && root.hasAttribute('title')) {
    disarmTitle(root)
  }
  root.querySelectorAll?.('[title]').forEach((el) => {
    disarmTitle(el)
  })
}

function findTitled(from: EventTarget | null): Element | null {
  if (!(from instanceof Element)) return null
  if (from.closest(`[${LAYER}]`)) return null
  return from.closest(`[${STORED}], [title]`)
}

/**
 * App-wide bridge: any native `title` (current or future) becomes a styled
 * Bokito tooltip. Mount once near the app root — no per-button wiring needed.
 *
 * Prefer `<Tip>` when you need side/align control; `title="…"` still works
 * and is upgraded automatically.
 */
export function NativeTitleTooltipBridge() {
  const [tip, setTip] = useState<TipState | null>(null)

  useEffect(() => {
    let active: Element | null = null
    let hideTimer: number | null = null

    const clearHide = () => {
      if (hideTimer != null) {
        window.clearTimeout(hideTimer)
        hideTimer = null
      }
    }

    const hide = () => {
      clearHide()
      active = null
      setTip(null)
    }

    const scheduleHide = () => {
      clearHide()
      hideTimer = window.setTimeout(hide, 40)
    }

    const placeFor = (el: Element, text: string) => {
      const rect = el.getBoundingClientRect()
      const gap = 8
      const preferTop = rect.top >= 40
      setTip({
        text,
        x: rect.left + rect.width / 2,
        y: preferTop ? rect.top - gap : rect.bottom + gap,
        place: preferTop ? 'top' : 'bottom',
      })
    }

    const showFor = (el: Element) => {
      const text = disarmTitle(el)
      if (!text) return
      clearHide()
      active = el
      placeFor(el, text)
    }

    const onPointerOver = (event: PointerEvent) => {
      const el = findTitled(event.target)
      if (!el) return
      if (el === active) {
        clearHide()
        return
      }
      showFor(el)
    }

    const onPointerOut = (event: PointerEvent) => {
      if (!active) return
      const next = event.relatedTarget
      if (next instanceof Node && active.contains(next)) return
      if (next instanceof Element && next.closest(`[${LAYER}]`)) return
      scheduleHide()
    }

    const onFocusIn = (event: FocusEvent) => {
      const el = findTitled(event.target)
      if (el) showFor(el)
    }

    const onFocusOut = () => scheduleHide()

    const onScroll = () => {
      if (active) hide()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    // Strip titles as soon as they appear (incl. React re-renders) so the
    // browser never gets a chance to show its delayed native tip.
    disarmTree(document.body)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'title') {
          const el = mutation.target
          if (el instanceof Element && el.hasAttribute('title')) {
            disarmTitle(el)
          }
          continue
        }
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element || node instanceof DocumentFragment) {
              disarmTree(node)
            }
          })
        }
      }
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['title'],
      childList: true,
      subtree: true,
    })

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      clearHide()
      observer.disconnect()
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  if (!tip || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-bokito-tip-layer=""
      role="tooltip"
      className={cn(
        'pointer-events-none fixed z-[200] max-w-64 -translate-x-1/2 rounded-md border border-border/60 bg-bg-elevated px-2.5 py-1.5 text-xs font-medium text-text-primary shadow-overlay animate-fade-in',
        tip.place === 'top' ? '-translate-y-full' : undefined,
      )}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
