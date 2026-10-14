/**
 * Bokito bot-orb mark: shape + color catalog.
 * Original SVG paths (viewBox 0 0 64 64), Grok-like UX — not their asset pack.
 */

export const BOT_ORB_SHAPE_KEYS = [
  'monkey',
  'blob',
  'pebble',
  'egg',
  'squircle',
  'capsule',
  'hex',
  'crystal',
  'wedge',
  'shield',
  'dome',
  'arch',
  'teardrop',
  'heart',
] as const

export type BotOrbShapeKey = (typeof BOT_ORB_SHAPE_KEYS)[number]

/** Retired silhouettes still stored on agents → map to a live key. */
const RETIRED_BOT_ORB_SHAPES: Record<string, BotOrbShapeKey> = {
  chimp: 'monkey',
  ape: 'monkey',
  bean: 'blob',
}

export type BotOrbShapeDef = {
  /** SVG path `d` in a 64×64 viewBox, filled as the body (top paint layer). */
  path: string
  /**
   * Optional under-layer (e.g. ears) drawn before `path` in the same fill.
   * Keeps overlaps solid — do not merge under + body into one compound path
   * when they overlap, or evenodd/clip can punch holes.
   */
  underPath?: string
  /** Optional darker overlays (e.g. inner-ear shades), drawn between under and body. */
  shadePath?: string
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
    path: 'M32 5C19 5 7 17 7 32s12 27 25 27 25-12 25-27S45 5 32 5Z',
  },
  pebble: {
    path: 'M32 7C21 7 11 17 10 29c-1 13 7 26 22 27 13 1 24-8 25-21 1-12-7-28-25-28Z',
    faceY: 1,
  },
  egg: {
    path: 'M32 6C23 6 15 18 15 32c0 11 7 26 17 26s17-15 17-26C49 18 41 6 32 6Z',
    faceY: 3,
    faceScale: 0.9,
  },
  /** Superellipse-ish; large corner radii, no hard square feel. */
  squircle: {
    path:
      'M20 7h24c9 0 13 4 13 13v24c0 9-4 13-13 13H20c-9 0-13-4-13-13V20c0-9 4-13 13-13Z',
  },
  capsule: {
    path: 'M20 8h24c9 0 14 8 14 24s-5 24-14 24H20C11 56 6 48 6 32S11 8 20 8Z',
  },
  /** Soft hexagon — curve-only, reads hex without sharp tips. */
  hex: {
    path:
      'M32 9C37 9 42 12 46 17C50 22 53 28 53 34C53 40 50 46 46 51C42 56 37 59 32 59C27 59 22 56 18 51C14 46 11 40 11 34C11 28 14 22 18 17C22 12 27 9 32 9Z',
    faceScale: 0.92,
  },
  /** Soft crystal — blunt leaf / rounded diamond. */
  crystal: {
    path:
      'M32 8C37 8 43 14 47 22C51 30 52 38 49 46C46 53 40 58 32 58C24 58 18 53 15 46C12 38 13 30 17 22C21 14 27 8 32 8Z',
    faceScale: 0.88,
  },
  /** Soft wedge / gumdrop. */
  wedge: {
    path:
      'M32 10C38 10 44 18 48 30C52 42 51 51 45 55C40 58 36 59 32 59C28 59 24 58 19 55C13 51 12 42 16 30C20 18 26 10 32 10Z',
    faceY: 5,
    faceScale: 0.85,
  },
  shield: {
    path:
      'M32 8C39 11 47 12 52 15C55 17 56 20 56 24V34C56 45 47 54 32 58C17 54 8 45 8 34V24C8 20 9 17 12 15C17 12 25 11 32 8Z',
    faceY: 1,
    faceScale: 0.9,
  },
  /** Soft dome — continuous curves, no square base corners. */
  dome: {
    path:
      'M12 34C12 20 20 10 32 10C44 10 52 20 52 34C52 48 46 56 36 58C34 58.5 30 58.5 28 58C18 56 12 48 12 34Z',
    faceY: -2,
  },
  arch: {
    path:
      'M13 48C13 20 20 9 32 9C44 9 51 20 51 48C51 56 44 59 32 59C20 59 13 56 13 48Z',
    faceY: -1,
  },
  /** Soft teardrop — blunt tip, round bowl. */
  teardrop: {
    path:
      'M32 9C37 15 45 25 49 35C53 45 51 54 42 57C38 59 34 60 32 60C30 60 26 59 22 57C13 54 11 45 15 35C19 25 27 15 32 9Z',
    faceY: 6,
    faceScale: 0.88,
  },
  heart: {
    path:
      'M32 50C23 43 12 35 12 26C12 20 16.5 15.5 23 15.5C27 15.5 30 17.5 32 20.5C34 17.5 37 15.5 41 15.5C47.5 15.5 52 20 52 26C52 35 41 43 32 50Z',
    faceY: -2,
    faceScale: 0.85,
  },
  /**
   * Monkey: Vector.svg — outer ears, inner-ear shades, then head+muzzle on top.
   * Eyes clip to `path` (face) only so ear overlaps never punch holes in the mask.
   */
  monkey: {
    underPath:
      'M58.64 25.41C57.77 32.80 52.68 38.26 47.29 37.62C41.89 36.98 38.23 30.48 39.11 23.10C39.98 15.72 45.06 10.25 50.46 10.89C55.85 11.53 59.52 18.03 58.64 25.41ZM5.37 25.41C6.25 32.80 11.33 38.26 16.72 37.62C22.12 36.98 25.78 30.48 24.91 23.10C24.03 15.72 18.95 10.25 13.55 10.89C8.16 11.53 4.50 18.03 5.37 25.41Z',
    shadePath:
      'M54.59 27.53C53.89 33.50 49.78 37.92 45.42 37.40C41.06 36.88 38.10 31.63 38.80 25.66C39.51 19.69 43.62 15.27 47.98 15.79C52.34 16.31 55.30 21.56 54.59 27.53ZM10.16 27.50C10.86 33.47 14.97 37.89 19.33 37.37C23.70 36.85 26.66 31.59 25.95 25.63C25.24 19.66 21.13 15.24 16.77 15.76C12.41 16.28 9.45 21.53 10.16 27.50Z',
    path:
      'M49.17 31.00C49.17 41.75 41.48 50.46 32.00 50.46C22.52 50.46 14.83 41.75 14.83 31.00C14.83 20.25 22.52 11.54 32.00 11.54C41.48 11.54 49.17 20.25 49.17 31.00ZM48.57 41.74C48.57 48.60 41.13 54.17 31.96 54.17C22.78 54.17 15.35 48.60 15.35 41.74C15.35 34.88 22.78 29.32 31.96 29.32C41.13 29.32 48.57 34.88 48.57 41.74Z',
    faceY: -3,
    faceScale: 0.85,
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
  const mapped = RETIRED_BOT_ORB_SHAPES[key] ?? key
  return (BOT_ORB_SHAPE_KEYS as readonly string[]).includes(mapped)
    ? (mapped as BotOrbShapeKey)
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

