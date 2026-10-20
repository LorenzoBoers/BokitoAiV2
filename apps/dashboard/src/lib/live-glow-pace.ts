/**
 * Stream pace for the live-agent glow: the reveal rate divided by the mean
 * cruise (1 = normal typing). The seat glow brightens with it.
 */
type PaceListener = (pace: number) => void

let pace = 0
let publishedAt = 0
const listeners = new Set<PaceListener>()

/** Latest reveal pace (chars/sec ÷ cruise). Listeners stay outside React. */
export function publishLiveGlowPace(next: number): void {
  pace = Number.isFinite(next) ? Math.max(0, next) : 0
  publishedAt = typeof performance !== 'undefined' ? performance.now() : 0
  for (const listener of listeners) listener(pace)
}

export function subscribeLiveGlowPace(listener: PaceListener): () => void {
  const fresh =
    typeof performance !== 'undefined' && performance.now() - publishedAt < 240 ? pace : 0
  listener(fresh)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
