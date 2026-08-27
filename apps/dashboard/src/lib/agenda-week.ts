export function clampWeekOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0
  return Math.max(-52, Math.min(52, Math.trunc(offset)))
}

export function parseWeekOffset(value: string | null): number {
  if (!value) return 0
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < -52 || n > 52) return 0
  return n
}

export function weekOffsetParam(offset: number): string | null {
  return offset === 0 ? null : String(offset)
}
