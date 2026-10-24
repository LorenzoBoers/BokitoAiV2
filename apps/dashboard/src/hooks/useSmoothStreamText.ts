import { useEffect, useRef, useState } from 'react'
import {
  SMOOTH_STREAM,
  SMOOTH_STREAM_CPS,
  advanceSmoothStream,
  revealLimit,
  smoothStreamRate,
  streamRateJitter,
} from '@bokito/shared'
import { nextChipRevealLength } from '../lib/chatText'
import { publishLiveGlowPace } from '../lib/live-glow-pace'

export { SMOOTH_STREAM, SMOOTH_STREAM_CPS, revealLimit, smoothStreamRate, streamRateJitter }

/**
 * Smooths chunky SSE text into a per-frame reveal.
 *
 * One rAF loop for the life of the hook: growing `target` only fills the
 * buffer. Each frame shows at least one grapheme while text is waiting, and
 * never more than the frame cap, so a chunk cannot land at once and the
 * caret cannot sit still on text that has already arrived.
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
  const carryRef = useRef(0)
  const lastRef = useRef(0)
  const shownRef = useRef(0)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let cancelled = false
    lastRef.current = performance.now()

    const tick = (now: number) => {
      if (cancelled) return
      const frameDt = Math.min(Math.max(now - lastRef.current, 0), SMOOTH_STREAM.maxFrameMs)
      const result = advanceSmoothStream({
        goal: targetRef.current,
        prev: visibleRef.current,
        active: activeRef.current,
        holdLead: leadRef.current,
        nowMs: now,
        lastMs: lastRef.current,
        startedAtMs: startedAtRef.current,
        carry: carryRef.current,
        reduceMotion,
        capLength: nextChipRevealLength,
      })
      lastRef.current = result.lastMs
      startedAtRef.current = result.startedAtMs
      carryRef.current = result.carry
      const gained = result.visible.length - shownRef.current
      const behind = result.visible.length < targetRef.current.length
      if (!reduceMotion && (behind || gained > 0)) {
        const cps = frameDt > 0 ? (Math.max(0, gained) * 1000) / frameDt : 0
        publishLiveGlowPace(cps / SMOOTH_STREAM_CPS.cruiseCps)
      }
      shownRef.current = result.visible.length
      if (result.visible !== visibleRef.current) {
        visibleRef.current = result.visible
        setVisible(result.visible)
      }
      // After a reset, keep ticking so the new goal can start revealing.
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
