import { useEffect, useRef, useState } from 'react'

/**
 * Pacing for the live reveal. Rates are characters per second; the reveal is
 * driven by wall-clock time, so 60 Hz and 144 Hz screens show the same speed.
 */
export const SMOOTH_STREAM = {
  /** Floor while the model trickles: the tail never crawls slower than this. */
  minCps: 60,
  /** Ceiling under normal load: a burst still reads as typing, not a paste. */
  maxCps: 320,
  /** Aim to drain the backlog within this horizon (rate = backlog / horizon). */
  drainMs: 450,
  /** Above this backlog the ceiling lifts so the view does not fall seconds behind. */
  burstBacklog: 600,
  /** A large backlog (reconnect replay, long tool output) drains within this. */
  burstDrainMs: 1500,
  /** The stream ended with text still queued: finish quickly, but do not snap. */
  finishCps: 1400,
  /** Frame gap cap: after a background tab wakes up, do not dump the whole buffer. */
  maxFrameMs: 100,
} as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Rate for the current frame. Proportional to the backlog (fast after a big
 * chunk, gentle at the tail), bounded by min/max, with a lifted ceiling for
 * very large backlogs and a fast finish once the stream has ended.
 */
export function smoothStreamRate(backlog: number, active: boolean): number {
  const p = SMOOTH_STREAM
  if (!active) return Math.max(p.finishCps, (backlog * 1000) / p.drainMs)
  let rate = clamp((backlog * 1000) / p.drainMs, p.minCps, p.maxCps)
  if (backlog > p.burstBacklog) {
    rate = Math.max(rate, (backlog * 1000) / p.burstDrainMs)
  }
  return rate
}

/**
 * Smooths chunky SSE text into a steady character reveal.
 *
 * Network chunks arrive in bursts of varying size; rendering them directly
 * makes the stream feel jumpy. This hook trails the incoming buffer and
 * reveals it at a time-based rate proportional to the backlog (see
 * `smoothStreamRate`): a large chunk flows out quickly but capped, a trickle
 * eases out at the floor. Fractional characters carry over between frames so
 * low rates still advance evenly.
 *
 * When the stream ends with text still queued, the reveal finishes at a high
 * rate instead of snapping, so the last sentence lands without a jump.
 *
 * The RAF loop stops when caught up and only restarts when `target` grows.
 */
export function useSmoothStreamText(target: string, active: boolean): string {
  const [visible, setVisible] = useState(target)
  const targetRef = useRef(target)
  targetRef.current = target
  const activeRef = useRef(active)
  activeRef.current = active
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    // User prefers reduced motion: show everything at once.
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setVisible(target)
      return
    }

    // Stream reset (new message): snap instead of "deleting" characters.
    if (!target.startsWith(visibleRef.current)) {
      setVisible(target)
      visibleRef.current = target
    }

    // Already caught up — wait for the next target growth (effect re-runs).
    if (visibleRef.current.length >= target.length) return

    // Inactive without an in-progress reveal (fresh mount): no animation.
    if (!active && visibleRef.current.length === 0) {
      setVisible(target)
      visibleRef.current = target
      return
    }

    let raf = 0
    let cancelled = false
    let last = performance.now()
    let carry = 0
    const tick = (now: number) => {
      if (cancelled) return
      const dt = Math.min(Math.max(now - last, 0), SMOOTH_STREAM.maxFrameMs)
      last = now
      const goal = targetRef.current
      const prev = visibleRef.current
      if (!goal.startsWith(prev)) {
        visibleRef.current = goal
        setVisible(goal)
        return
      }
      const backlog = goal.length - prev.length
      if (backlog <= 0) return // Caught up: stop until `target` grows again.
      const step = (smoothStreamRate(backlog, activeRef.current) * dt) / 1000 + carry
      const chars = Math.floor(step)
      carry = step - chars
      if (chars > 0) {
        const next = goal.slice(0, prev.length + Math.min(chars, backlog))
        visibleRef.current = next
        setVisible(next)
        if (next.length >= goal.length) return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [active, target])

  // Inactive and nothing left to reveal: mirror the target directly so a
  // saved message never lags one render behind.
  const draining = visible.length < target.length && target.startsWith(visible)
  return active || draining ? visible : target
}

export default useSmoothStreamText
