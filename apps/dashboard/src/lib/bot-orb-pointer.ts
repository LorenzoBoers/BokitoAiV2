/** Shared pointer bus for bot-orb proximity gaze (one window listener). */

type PointerListener = (clientX: number, clientY: number) => void

const listeners = new Set<PointerListener>()
let attached = false

function onPointerMove(e: PointerEvent) {
  for (const listener of listeners) listener(e.clientX, e.clientY)
}

export function subscribeBotOrbPointer(listener: PointerListener): () => void {
  listeners.add(listener)
  if (!attached && typeof window !== 'undefined') {
    attached = true
    window.addEventListener('pointermove', onPointerMove, { passive: true })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && attached && typeof window !== 'undefined') {
      attached = false
      window.removeEventListener('pointermove', onPointerMove)
    }
  }
}

/** Distance from a point to the nearest edge of a rect (0 when inside). */
export function distanceToRect(clientX: number, clientY: number, rect: DOMRect): number {
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right)
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom)
  return Math.hypot(dx, dy)
}
