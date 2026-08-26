/** Height presets and persistence for auto-growing message composers. */

export type ComposerGrowMode = 'chat' | 'email' | 'note'

export const COMPOSER_GROW: Record<ComposerGrowMode, { min: number; max: number }> = {
  chat: { min: 52, max: 280 },
  email: { min: 132, max: 440 },
  note: { min: 72, max: 280 },
}

export function composerFloorKey(mode: ComposerGrowMode): string {
  return `bokito.composer.floor.${mode}`
}

export function clampComposerFloor(mode: ComposerGrowMode, value: number): number {
  const { min, max } = COMPOSER_GROW[mode]
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function readComposerFloor(mode: ComposerGrowMode): number | null {
  try {
    const raw = localStorage.getItem(composerFloorKey(mode))
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return clampComposerFloor(mode, parsed)
  } catch {
    return null
  }
}

export function writeComposerFloor(mode: ComposerGrowMode, value: number | null): void {
  try {
    const key = composerFloorKey(mode)
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(clampComposerFloor(mode, value)))
  } catch {
    // Private mode / quota.
  }
}
