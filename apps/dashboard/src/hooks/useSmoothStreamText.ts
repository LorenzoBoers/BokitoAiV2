import { useEffect, useRef, useState } from 'react'

/**
 * Smooths chunky SSE text into a steady character reveal.
 *
 * Network chunks arrive in bursts of varying size; rendering them directly
 * makes the stream feel jumpy. This hook trails the incoming buffer and
 * catches up a fraction of the backlog every animation frame, so text flows
 * at a rate proportional to how far behind it is (fast when a large chunk
 * lands, gentle when the model trickles).
 */
export function useSmoothStreamText(target: string, active: boolean): string {
  const [visible, setVisible] = useState(target)
  const targetRef = useRef(target)
  targetRef.current = target

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
    setVisible((prev) => (target.startsWith(prev) ? prev : target))

    let raf = 0
    const tick = () => {
      const goal = targetRef.current
      setVisible((prev) => {
        if (prev.length >= goal.length) return goal.startsWith(prev) ? prev : goal
        const backlog = goal.length - prev.length
        // Catch up ~8% of the backlog per frame, minimum 2 chars (~120 cps).
        const step = Math.max(2, Math.ceil(backlog * 0.08))
        return goal.slice(0, prev.length + step)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, target])

  return active ? visible : target
}

export default useSmoothStreamText
