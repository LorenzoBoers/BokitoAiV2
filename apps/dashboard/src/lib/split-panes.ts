/** Persist and clamp widths for resizable split panes. */

export type SplitPaneSpec = {
  id: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  flex?: boolean
}

export type SplitWidths = Record<string, number>

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function readSplitWidths(storageKey: string): SplitWidths {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: SplitWidths = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export function writeSplitWidths(storageKey: string, widths: SplitWidths): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(widths))
  } catch {
    // Private mode / quota — ignore.
  }
}

export function resolveWidths(specs: SplitPaneSpec[], stored: SplitWidths): SplitWidths {
  const next: SplitWidths = {}
  for (const spec of specs) {
    if (spec.flex) continue
    next[spec.id] = clamp(stored[spec.id] ?? spec.defaultWidth, spec.minWidth, spec.maxWidth)
  }
  return next
}

/** Shrink fixed panes so the flex pane keeps at least `minFlex` in `container`. */
export function fitWidths(
  specs: SplitPaneSpec[],
  widths: SplitWidths,
  container: number,
  minFlex: number,
): SplitWidths {
  if (container <= 0) return widths
  const fixed = specs.filter((spec) => !spec.flex)
  const flexCount = specs.filter((spec) => spec.flex).length
  const reservedFlex = flexCount > 0 ? minFlex : 0
  const used = fixed.reduce((sum, spec) => sum + (widths[spec.id] ?? spec.defaultWidth), 0)
  const overflow = used + reservedFlex - container
  if (overflow <= 0) return widths

  const slack = fixed.reduce((sum, spec) => {
    const current = widths[spec.id] ?? spec.defaultWidth
    return sum + Math.max(0, current - spec.minWidth)
  }, 0)
  if (slack <= 0) {
    const next: SplitWidths = { ...widths }
    for (const spec of fixed) next[spec.id] = spec.minWidth
    return next
  }

  const take = Math.min(overflow, slack)
  const next: SplitWidths = { ...widths }
  for (const spec of fixed) {
    const current = widths[spec.id] ?? spec.defaultWidth
    const room = current - spec.minWidth
    if (room <= 0) continue
    next[spec.id] = Math.round(current - take * (room / slack))
  }
  return next
}

export function applyDrag(
  specs: SplitPaneSpec[],
  widths: SplitWidths,
  paneId: string,
  nextWidth: number,
  container: number,
  minFlex: number,
): SplitWidths {
  const spec = specs.find((item) => item.id === paneId)
  if (!spec || spec.flex) return widths
  const proposed = {
    ...widths,
    [paneId]: clamp(nextWidth, spec.minWidth, spec.maxWidth),
  }
  return fitWidths(specs, proposed, container, minFlex)
}
