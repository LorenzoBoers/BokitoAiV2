import { useEffect, useMemo, useState } from 'react'

/** Ignore reveal times further out than this — a skewed clock must not hide history. */
export const REVEAL_HOLD_MAX_MS = 15_000

export function messageHeldForReveal(
  revealAt: string | null | undefined,
  now: number,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion || !revealAt) return false
  const at = Date.parse(revealAt)
  if (Number.isNaN(at) || at <= now) return false
  if (at - now > REVEAL_HOLD_MAX_MS) return false
  return true
}

export function nextRevealAt(
  stamps: Array<string | null | undefined>,
  now: number,
): number | null {
  let soon: number | null = null
  for (const stamp of stamps) {
    if (!messageHeldForReveal(stamp, now, false)) continue
    const at = Date.parse(stamp as string)
    if (soon == null || at < soon) soon = at
  }
  return soon
}

/** Ticks when the next paced bubble is allowed on screen. */
export function useRevealClock(stamps: Array<string | null | undefined>): number {
  const [now, setNow] = useState(() => Date.now())
  const next = useMemo(() => nextRevealAt(stamps, now), [stamps, now])
  useEffect(() => {
    if (next == null) return
    const delay = Math.max(0, next - Date.now()) + 30
    const id = window.setTimeout(() => setNow(Date.now()), delay)
    return () => window.clearTimeout(id)
  }, [next])
  return now
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
