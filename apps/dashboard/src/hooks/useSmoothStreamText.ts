import { useEffect, useRef, useState } from 'react'

/**
 * Smooths chunky SSE text into a steady character reveal.
 *
 * Network chunks arrive in bursts of varying size; rendering them directly
 * makes the stream feel jumpy. This hook trails the incoming buffer and
 * catches up a fraction of the backlog every animation frame, so text flows
 * at a rate proportional to how far behind it is (fast when a large chunk
 * lands, gentle when the model trickles).
 *
 * The RAF loop stops when caught up — it only restarts when `target` grows
 * again. An earlier version ran forever while `active`, burning CPU/GC.
 */
export function useSmoothStreamText(target: string, active: boolean): string {
  const [visible, setVisible] = useState(target)
  const targetRef = useRef(target)
  targetRef.current = target
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    // Not streaming (or user prefers reduced motion): show everything at once.
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!active || reduceMotion) {
      setVisible(target)
      return
    }

    // Stream reset (new message): snap back instead of "deleting" characters.
    if (!target.startsWith(visibleRef.current)) {
      setVisible(target)
      visibleRef.current = target
    }

    // Already caught up — wait for the next target growth (effect re-runs).
    if (visibleRef.current.length >= target.length && target.startsWith(visibleRef.current)) {
      return
    }

    let raf = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const goal = targetRef.current
      const prev = visibleRef.current
      if (prev.length >= goal.length) {
        if (!goal.startsWith(prev)) {
          visibleRef.current = goal
          setVisible(goal)
        }
        // Caught up: stop scheduling until `target` grows again.
        return
      }
      const backlog = goal.length - prev.length
      // Catch up ~8% of the backlog per frame, minimum 2 chars (~120 cps).
      const step = Math.max(2, Math.ceil(backlog * 0.08))
      const next = goal.slice(0, prev.length + step)
      visibleRef.current = next
      setVisible(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [active, target])

  return active ? visible : target
}

export default useSmoothStreamText
