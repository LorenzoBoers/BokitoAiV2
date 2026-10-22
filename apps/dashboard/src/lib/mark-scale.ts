/**
 * One size ladder for every face: people, agents, contacts, teams.
 * Steps are multiples of 4 so a row of mixed marks shares one box and one gap.
 *
 * 16 inline · 20 menu · 24 compact row · 32 directory / default
 * 40–48 cards · 64–128 hero and dialog
 */

export const MARK_SCALE = [16, 20, 24, 32, 40, 48, 64, 80, 96, 128] as const

export type MarkSize = (typeof MARK_SCALE)[number]

const SCALE: readonly number[] = MARK_SCALE

/** Nearest ladder step. Ties go up so a mark does not shrink under its box. */
export function snapMarkSize(size: number): MarkSize {
  if (!Number.isFinite(size) || size <= SCALE[0]) return SCALE[0] as MarkSize
  const last = SCALE[SCALE.length - 1]
  if (size >= last) return last as MarkSize
  let best = SCALE[0]
  let bestDist = Math.abs(size - best)
  for (const step of SCALE) {
    const dist = Math.abs(size - step)
    if (dist < bestDist || (dist === bestDist && step > best)) {
      best = step
      bestDist = dist
    }
  }
  return best as MarkSize
}

/** Presence corner diameter for a mark step. Integers only. */
export function markDotSize(size: number): number {
  const step = snapMarkSize(size)
  if (step <= 16) return 6
  if (step <= 32) return 8
  if (step <= 48) return 10
  return 12
}
