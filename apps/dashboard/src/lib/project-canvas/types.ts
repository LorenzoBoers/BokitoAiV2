export const CANVAS_KINDS = [
  'dashboard',
  'document',
  'diagram',
  'drawing',
  'image',
  'code',
  'email',
  'sheet',
  'design',
] as const

export type CanvasKind = (typeof CANVAS_KINDS)[number]

export function canvasKindOf(kind: string | null | undefined): CanvasKind {
  return (CANVAS_KINDS as readonly string[]).includes(kind || '') ? (kind as CanvasKind) : 'dashboard'
}

export function canvasIsPending(row: { kind?: string | null; empty?: boolean; tree?: CanvasNode | null }): boolean {
  if (canvasKindOf(row.kind) !== 'dashboard') return Boolean(row.empty)
  return Boolean(row.empty || isEmptyCanvasTree(row.tree))
}

export const CANVAS_TYPES = [
  'Stack',
  'Grid',
  'Row',
  'Text',
  'Heading',
  'Callout',
  'Divider',
  'List',
  'Stat',
  'Table',
  'BarChart',
  'LineChart',
  'PieChart',
  'Card',
  'Badge',
] as const

export type CanvasType = (typeof CANVAS_TYPES)[number]

export type CanvasNode = {
  type: string
  props?: Record<string, unknown>
  children?: Array<CanvasNode | string>
}

export function isEmptyCanvasTree(tree: CanvasNode | null | undefined): boolean {
  if (!tree) return true
  const children = tree.children ?? []
  const props = tree.props ?? {}
  return tree.type === 'Stack' && children.length === 0 && Object.keys(props).length === 0
}

export function asString(value: unknown): string {
  if (value == null) return ''
  return String(value)
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter((item) => item.length > 0)
}
