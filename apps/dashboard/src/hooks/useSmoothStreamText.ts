import { useEffect, useRef, useState } from 'react'

/**
 * Frontend playback that follows the backend stream.
 *
 * Incoming chunks only fill a buffer. The view starts as soon as the first
 * characters arrive, grows at a constant cruise (slightly slower than a
 * typical model), and pauses when it catches the unpublished lead. When the
 * model stops, the leftover drains at the same cruise — never a dump.
 *
 * Token ≈ 4 characters (EN/NL mix).
 */
export const SMOOTH_STREAM = {
  charsPerToken: 4,
  /** Steady playback. Below a typical model so the view stays behind. */
  cruiseTps: 22,
  /** Floor for the post-stream drain of a short tail. */
  finishMinTps: 22,
  /** Ceiling when a large leftover remains after the model stops. */
  finishMaxTps: 40,
  /** Aim to empty a large leftover within this horizon once the turn ended. */
  finishHorizonMs: 2000,
  /** Stay at most this far behind a large live buffer. */
  leadChars: 18,
  /** Always keep at least this many live chars unpublished (the brake). */
  minBrakeChars: 2,
  /** Live lead is this fraction of the buffer, until `leadChars`. */
  leadRatio: 0.18,
  /** Brief wait so the first glyph is not a single-letter flash. */
  startDelayMs: 40,
  /** Frame gap cap: a background tab must not dump the buffer. */
  maxFrameMs: 50,
} as const

function tpsToCps(tps: number): number {
  return tps * SMOOTH_STREAM.charsPerToken
}

export const SMOOTH_STREAM_CPS = {
  cruiseCps: tpsToCps(SMOOTH_STREAM.cruiseTps),
  finishMinCps: tpsToCps(SMOOTH_STREAM.finishMinTps),
  finishMaxCps: tpsToCps(SMOOTH_STREAM.finishMaxTps),
  /** Alias used by older tests that called the live ceiling `maxCps`. */
  maxCps: tpsToCps(SMOOTH_STREAM.cruiseTps),
  minCps: tpsToCps(SMOOTH_STREAM.cruiseTps),
  finishCps: tpsToCps(SMOOTH_STREAM.finishMinTps),
} as const

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * How far the view may go. Live: stay a short lead behind the buffer so a
 * catch-up pauses instead of locking to network cadence. Finished: the
 * whole buffer is playable.
 */
export function revealLimit(bufferLength: number, holdLead: boolean): number {
  if (!holdLead || bufferLength <= 0) return bufferLength
  const tail = Math.min(
    SMOOTH_STREAM.leadChars,
    Math.max(SMOOTH_STREAM.minBrakeChars, Math.floor(bufferLength * SMOOTH_STREAM.leadRatio)),
  )
  // First glyphs must appear as soon as the backend starts — never wait
  // for a full lead of unpublished text.
  return bufferLength > 0 ? Math.max(1, bufferLength - tail) : 0
}

/**
 * Character rate for this frame. Live: constant cruise. Ended: drain the
 * leftover on a short horizon, still bounded so it never dumps.
 */
export function smoothStreamRate(backlog: number, active: boolean): number {
  const p = SMOOTH_STREAM
  if (active) return tpsToCps(p.cruiseTps)
  const finishMin = tpsToCps(p.finishMinTps)
  const finishMax = tpsToCps(p.finishMaxTps)
  return clamp((Math.max(backlog, 1) * 1000) / p.finishHorizonMs, finishMin, finishMax)
}

/**
 * Smooths chunky SSE text into a constant character reveal.
 *
 * One rAF loop for the life of the hook: growing `target` only fills the
 * buffer. The playhead never mirrors chunk size or timing. While `holdLead`
 * is set it pauses at the lead; when the stream ends it drains the rest.
 */
export function useSmoothStreamText(
  target: string,
  active: boolean,
  holdLead = active,
): string {
  const [visible, setVisible] = useState('')
  const targetRef = useRef(target)
  targetRef.current = target
  const activeRef = useRef(active)
  activeRef.current = active
  const leadRef = useRef(holdLead)
  leadRef.current = holdLead
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let cancelled = false
    let last = performance.now()
    let carry = 0

    const tick = (now: number) => {
      if (cancelled) return
      const goal = targetRef.current
      if (reduceMotion) {
        if (visibleRef.current !== goal) {
          visibleRef.current = goal
          setVisible(goal)
        }
        return
      }
      const dt = Math.min(Math.max(now - last, 0), SMOOTH_STREAM.maxFrameMs)
      last = now
      const live = activeRef.current
      const prev = visibleRef.current
      if (!goal.startsWith(prev) && prev.length > 0) {
        visibleRef.current = ''
        setVisible('')
        startedAtRef.current = now
        carry = 0
        raf = requestAnimationFrame(tick)
        return
      }
      if (startedAtRef.current == null && goal.length > 0) {
        startedAtRef.current = now
      }
      const cap = revealLimit(goal.length, leadRef.current)
      const backlog = cap - prev.length
      if (backlog <= 0) {
        // Caught the live lead (or finished): pause until the buffer grows
        // or the stream ends and releases the lead.
        raf = requestAnimationFrame(tick)
        return
      }
      const origin = startedAtRef.current
      if (origin != null && now - origin < SMOOTH_STREAM.startDelayMs) {
        raf = requestAnimationFrame(tick)
        return
      }
      const step = (smoothStreamRate(backlog, live) * dt) / 1000 + carry
      const chars = Math.floor(step)
      carry = step - chars
      if (chars > 0) {
        const next = goal.slice(0, prev.length + Math.min(chars, backlog))
        visibleRef.current = next
        setVisible(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [])

  return visible
}

export default useSmoothStreamText
