/**
 * Bokito bot-orb mark: shape + color catalog.
 * Original SVG paths (viewBox 0 0 64 64), Grok-like UX — not their asset pack.
 */

export const BOT_ORB_SHAPE_KEYS = [
  'blob',
  'pebble',
  'bean',
  'egg',
  'squircle',
  'tablet',
  'capsule',
  'cylinder',
  'hex',
  'gem',
  'crystal',
  'wedge',
  'shield',
  'dome',
  'arch',
  'cloud',
  'teardrop',
  'leaf',
  'square',
  'sparkle',
  'clover',
  'flower',
  'heart',
  'house',
  'star',
] as const

export type BotOrbShapeKey = (typeof BOT_ORB_SHAPE_KEYS)[number]

export type BotOrbShapeDef = {
  /** SVG path `d` in a 64×64 viewBox, filled as the body. */
  path: string
  /** Nudge the eye group vertically (SVG units). */
  faceY?: number
  /** Scale the eye group around the face center. */
  faceScale?: number
}

/** Soft round default — closest to a classic companion mark. */
export const DEFAULT_BOT_ORB_SHAPE: BotOrbShapeKey = 'blob'

/**
 * Body silhouettes. Paths are hand-authored for Bokito; tweak here later
 * without touching the face/animation layer.
 */
export const BOT_ORB_SHAPES: Record<BotOrbShapeKey, BotOrbShapeDef> = {
  blob: {
    path: 'M32 4C18 4 6 16.5 6 32s12 28 26 28 26-12.5 26-28S46 4 32 4Z',
  },
  pebble: {
    path: 'M32 6C20 6 10 17 9 29c-1 14 8 27 23 29 14 2 25-9 26-23 1-13-8-29-26-29Z',
    faceY: 1,
  },
  bean: {
    path: 'M18 14c-8 6-10 20-4 30 5 9 18 14 30 10 11-4 18-16 14-28-3-10-14-18-26-16-5 1-10 2-14 4Z',
    faceY: 2,
    faceScale: 0.92,
  },
  egg: {
    path: 'M32 5C22 5 14 18 14 32c0 12 8 27 18 27s18-15 18-27C50 18 42 5 32 5Z',
    faceY: 3,
    faceScale: 0.9,
  },
  squircle: {
    path: 'M18 6h28c7 0 12 5 12 12v28c0 7-5 12-12 12H18C11 58 6 53 6 46V18C6 11 11 6 18 6Z',
  },
  tablet: {
    path: 'M14 8h36c4 0 8 4 8 8v32c0 4-4 8-8 8H14c-4 0-8-4-8-8V16c0-4 4-8 8-8Z',
    faceScale: 0.95,
  },
  capsule: {
    path: 'M20 8h24c8 0 14 8 14 24s-6 24-14 24H20C12 56 6 48 6 32S12 8 20 8Z',
  },
  cylinder: {
    path: 'M12 18c0-7 9-12 20-12s20 5 20 12v28c0 7-9 12-20 12s-20-5-20-12V18Z',
    faceY: 1,
  },
  hex: {
    path: 'M32 5 54 18v28L32 59 10 46V18L32 5Z',
    faceScale: 0.92,
  },
  gem: {
    path: 'M32 6 52 22 44 56H20L12 22 32 6Z',
    faceY: 2,
    faceScale: 0.88,
  },
  crystal: {
    path: 'M32 4 50 20 46 44 32 60 18 44 14 20 32 4Z',
    faceScale: 0.88,
  },
  wedge: {
    path: 'M10 50 32 6l22 44c-6 6-16 9-22 9s-16-3-22-9Z',
    faceY: 4,
    faceScale: 0.85,
  },
  shield: {
    path: 'M32 6c10 4 20 4 24 6v22c0 14-10 24-24 28C18 58 8 48 8 34V12c4-2 14-2 24-6Z',
    faceY: 1,
    faceScale: 0.9,
  },
  dome: {
    path: 'M8 36c0-14 11-28 24-28s24 14 24 28v14H8V36Z',
    faceY: -2,
  },
  arch: {
    path: 'M10 56V30C10 16 20 6 32 6s22 10 22 24v26H10Z',
    faceY: -1,
  },
  cloud: {
    path: 'M20 40c-7 0-12-5-12-11 0-5 3-9 8-11 2-8 9-13 17-13 7 0 13 4 16 10 1 0 2-.2 3-.2 7 0 12 5 12 12S51 40 44 40H20Z',
    faceY: 2,
    faceScale: 0.88,
  },
  teardrop: {
    path: 'M32 6c14 14 22 24 22 34 0 12-10 18-22 18S10 52 10 40c0-10 8-20 22-34Z',
    faceY: 6,
    faceScale: 0.88,
  },
  leaf: {
    path: 'M32 8c14 6 22 18 22 30 0 10-8 18-18 20-2-12-8-22-18-30 6-10 10-16 14-20Z',
    faceY: 4,
    faceScale: 0.85,
  },
  square: {
    path: 'M10 10h44v44H10Z',
    faceScale: 0.95,
  },
  sparkle: {
    path: 'M32 4 38 24l20 6-20 6-6 20-6-20-20-6 20-6 6-20Z',
    faceScale: 0.72,
  },
  clover: {
    path: 'M32 30c-2-10 4-20 14-20s14 10 8 18c8-2 16 6 12 14s-14 8-18 2c2 8-6 16-14 12s-10-14-2-18c-8 2-16-6-12-14s14-8 18-2c-2-8 6-16 14-12 4 2 6 6 4 10Z',
    faceScale: 0.75,
  },
  flower: {
    path: 'M32 28c-1-9 6-16 14-14 6 2 8 10 4 16 8 1 12 10 6 16-4 5-12 4-16 0 1 8-7 14-14 10-6-3-6-12-2-16-8-1-12-10-6-16 4-5 12-4 16 0 0-8 7-14 14-10 4 2 5 7 4 12Z',
    faceY: 1,
    faceScale: 0.72,
  },
  heart: {
    path: 'M32 56C18 46 6 36 6 24 6 14 14 8 22 8c5 0 8 3 10 6 2-3 5-6 10-6 8 0 16 6 16 16 0 12-12 22-26 32Z',
    faceY: -2,
    faceScale: 0.85,
  },
  house: {
    path: 'M32 6 56 28v28H40V40H24v16H8V28L32 6Z',
    faceY: 4,
    faceScale: 0.8,
  },
  star: {
    path: 'M32 6 39 24h20l-16 12 6 20-17-12-17 12 6-20L5 24h20L32 6Z',
    faceY: 4,
    faceScale: 0.7,
  },
}

/** Grok-like named swatches (our hex values, 6-digit). */
export const BOT_ORB_COLORS = [
  { id: 'black', value: '#111827' },
  { id: 'brown', value: '#936439' },
  { id: 'red', value: '#ff263c' },
  { id: 'orange', value: '#ff6700' },
  { id: 'yellow', value: '#ff9800' },
  { id: 'green', value: '#00c972' },
  { id: 'cyan', value: '#00bca6' },
  { id: 'blue', value: '#1084fe' },
  { id: 'violet', value: '#9159fe' },
  { id: 'magenta', value: '#ff309b' },
  { id: 'gray', value: '#777777' },
] as const

export type BotOrbColorId = (typeof BOT_ORB_COLORS)[number]['id']
export type BotOrbColorValue = (typeof BOT_ORB_COLORS)[number]['value']

export const DEFAULT_BOT_ORB_COLOR: BotOrbColorValue = '#9159fe'

const COLOR_VALUES = new Set<string>(BOT_ORB_COLORS.map((row) => row.value))

export function resolveBotOrbShape(value: string | null | undefined): BotOrbShapeKey {
  const key = (value ?? '').trim().toLowerCase()
  return (BOT_ORB_SHAPE_KEYS as readonly string[]).includes(key)
    ? (key as BotOrbShapeKey)
    : DEFAULT_BOT_ORB_SHAPE
}

export function resolveBotOrbColor(value: string | null | undefined): BotOrbColorValue {
  const hex = (value ?? '').trim().toLowerCase()
  if (COLOR_VALUES.has(hex)) return hex as BotOrbColorValue
  const byId = BOT_ORB_COLORS.find((row) => row.id === hex)
  return byId?.value ?? DEFAULT_BOT_ORB_COLOR
}

export function botOrbShapeDef(shape: string | null | undefined): BotOrbShapeDef {
  return BOT_ORB_SHAPES[resolveBotOrbShape(shape)]
}
