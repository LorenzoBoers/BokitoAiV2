import { useEffect, useRef, useState } from 'react'
import { nextChipRevealLength } from '../lib/chatText'

/**
 * Frontend playback that follows the backend stream.
 *
 * Incoming chunks only fill a buffer. The view starts as soon as the first
 * characters arrive, grows at a cruise (slightly slower than a typical model),
 * breathes with a deterministic jitter so it feels typed rather than metered,
 * and pauses when it catches the unpublished lead. When the model stops, the
 * leftover drains on a short horizon — never a dump.
 *
 * Token ≈ 4 characters (EN/NL mix).
 */
export const SMOOTH_STREAM = {
  charsPerToken: 4,
  /** Mean live playback. Below a typical model so the view stays behind. */
  cruiseTps: 30,
  /** Floor for the post-stream drain of a short tail. */
  finishMinTps: 28,
  /** Ceiling when a large leftover remains after the model stops. */
  finishMaxTps: 52,
  /** Aim to empty a large leftover within this horizon once the turn ended. */
  finishHorizonMs: 1600,
  /** Stay at most this far behind a large live buffer. */
  leadChars: 16,
  /** Always keep at least this many live chars unpublished (the brake). */
  minBrakeChars: 2,
  /** Live lead is this fraction of the buffer, until `leadChars`. */
  leadRatio: 0.16,
  /** Brief wait so the first glyph is not a single-letter flash. */
  startDelayMs: 28,
  /** Frame gap cap: a background tab must not dump the buffer. */
  maxFrameMs: 50,
  /**
   * Peak relative swing around the mean cruise (±). Two sines keep it
   * irregular without RNG (tests stay stable).
   */
  jitterAmp: 0.32,
} as const

function tpsToCps(tps: number): number {
  return tps * SMOOTH_STREAM.charsPerToken
}

export const SMOOTH_STREAM_CPS = {
  cruiseCps: tpsToCps(SMOOTH_STREAM.cruiseTps),
  finishMinCps: tpsToCps(SMOOTH_STREAM.finishMinTps),
  finishMaxCps: tpsToCps(SMOOTH_STREAM.finishMaxTps),
  /** Live per-frame ceiling including jitter (tests). */
  cruiseMaxCps: tpsToCps(SMOOTH_STREAM.cruiseTps) * (1 + SMOOTH_STREAM.jitterAmp),
  /** Alias used by older tests that called the live ceiling `maxCps`. */
  maxCps: tpsToCps(SMOOTH_STREAM.cruiseTps) * (1 + SMOOTH_STREAM.jitterAmp),
  minCps: tpsToCps(SMOOTH_STREAM.cruiseTps) * (1 - SMOOTH_STREAM.jitterAmp),
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
 * Relative speed multiplier for this frame. Overlapping sines breathe the
 * rate so bursts and dips feel typed, not metronomic.
 */
export function streamRateJitter(nowMs: number): number {
  const amp = SMOOTH_STREAM.jitterAmp
  if (amp <= 0) return 1
  const wave =
    1 +
    amp * Math.sin(nowMs * 0.0053) +
    amp * 0.55 * Math.sin(nowMs * 0.0121 + 1.37)
  return clamp(wave, 1 - amp, 1 + amp)
}

/**
 * Character rate for this frame. Live: mean cruise (caller applies jitter).
 * Ended: drain the leftover on a short horizon, still bounded so it never dumps.
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
      const baseRate = smoothStreamRate(backlog, live) * streamRateJitter(now)
      // Soft pause after sentence / clause breaks — typed, not sprayed.
      const trail = prev[prev.length - 1]
      const pause =
        trail === '.' || trail === '!' || trail === '?' || trail === '\n'
          ? 0.42
          : trail === ',' || trail === ';' || trail === ':'
            ? 0.72
            : 1
      const step = (baseRate * pause * dt) / 1000 + carry
      const chars = Math.floor(step)
      carry = step - chars
      if (chars > 0) {
        const hardCap = prev.length + backlog
        const cruiseEnd = prev.length + Math.min(chars, backlog)
        // While live, hold incomplete chip markup; when the turn ended, drain
        // abandoned half-tokens as plain text. Complete chips always pop once.
        const capped = nextChipRevealLength(goal, prev.length, cruiseEnd, hardCap, live)
        if (capped > prev.length) {
          const next = goal.slice(0, capped)
          visibleRef.current = next
          setVisible(next)
        }
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
