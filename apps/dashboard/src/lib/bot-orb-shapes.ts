/**
 * Bokito bot-orb mark: shape + color catalog.
 * Original SVG paths (viewBox 0 0 64 64), Grok-like UX — not their asset pack.
 */

export const BOT_ORB_SHAPE_KEYS = [
  'bokito',
  'blob',
  'square',
  'pebble',
  'egg',
  'squircle',
  'capsule',
  'hex',
  'crystal',
  'wedge',
  'triangle',
  'triangledown',
  'shield',
  'dome',
  'arch',
  'teardrop',
  'heart',
  'claude',
  'cursor',
] as const

export type BotOrbShapeKey = (typeof BOT_ORB_SHAPE_KEYS)[number]

/** Coding-agent bodies. Shown only when the API env flag is on. */
export const CODING_AGENT_SHAPE_KEYS = ['claude', 'cursor'] as const satisfies readonly BotOrbShapeKey[]

/** Retired silhouettes still stored on agents → map to a live key. */
const RETIRED_BOT_ORB_SHAPES: Record<string, BotOrbShapeKey> = {
  monkey: 'bokito',
  chimp: 'bokito',
  ape: 'bokito',
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
  /**
   * Optional darker detail on top of the body (e.g. nostrils) — after `path`,
   * before the animated eyes. Prefer `detailLeft` / `detailRight` when the
   * marks should parallax independently with gaze.
   */
  detailPath?: string
  detailLeft?: string
  detailRight?: string
  /** Nudge the eye group vertically (SVG units). */
  faceY?: number
  /** Scale the eye group around the face center. */
  faceScale?: number
}

/** Brand ape mark is the default companion silhouette. */
export const DEFAULT_BOT_ORB_SHAPE: BotOrbShapeKey = 'bokito'

/**
 * Body silhouettes. Paths are hand-authored for Bokito; tweak here later
 * without touching the face/animation layer.
 */
export const BOT_ORB_SHAPES: Record<BotOrbShapeKey, BotOrbShapeDef> = {
  /**
   * Brand mark from bokitov2.svg — ears + head + chin; nostrils as detail.
   * Static gray eyes from the source are dropped; BotOrbAvatar draws live eyes.
   */
  bokito: {
    underPath:
      'M3.023 22.273C3.861 29.342 8.728 34.576 13.893 33.963C19.059 33.351 22.567 27.125 21.729 20.056C20.892 12.988 16.025 7.754 10.859 8.366C5.694 8.978 2.186 15.205 3.023 22.273ZM61.005 22.273C60.167 29.342 55.300 34.576 50.135 33.963C44.969 33.351 41.461 27.125 42.299 20.056C43.137 12.988 48.003 7.754 53.169 8.366C58.334 8.978 61.843 15.205 61.005 22.273Z',
    shadePath:
      'M7.607 24.271C8.285 29.985 12.219 34.216 16.394 33.721C20.570 33.226 23.406 28.192 22.729 22.478C22.052 16.764 18.117 12.533 13.942 13.028C9.766 13.523 6.930 18.556 7.607 24.271ZM56.421 24.271C55.744 29.985 51.809 34.216 47.634 33.721C43.458 33.226 40.622 28.192 41.299 22.478C41.977 16.764 45.911 12.533 50.086 13.028C54.262 13.523 57.098 18.556 56.421 24.271Z',
    path:
      'M51.993 29.846C51.993 42.322 43.069 52.435 32.059 52.435C21.050 52.435 12.125 42.322 12.125 29.846C12.125 17.371 21.050 7.257 32.059 7.257C43.069 7.257 51.993 17.371 51.993 29.846ZM51.292 42.318C51.292 50.284 42.659 56.743 32.009 56.743C21.359 56.743 12.726 50.284 12.726 42.318C12.726 34.351 21.359 27.893 32.009 27.893C42.659 27.893 51.292 34.351 51.292 42.318Z',
    detailLeft:
      'M31.037 36.191L29.331 33.765C28.881 33.124 27.903 33.224 27.592 33.943L27.236 34.766C27.132 35.008 27.232 35.290 27.466 35.410L30.397 36.924C30.862 37.164 31.338 36.620 31.037 36.191Z',
    detailRight:
      'M33.132 36.191L34.837 33.765C35.287 33.124 36.265 33.224 36.576 33.943L36.932 34.766C37.037 35.008 36.936 35.290 36.702 35.410L33.771 36.924C33.306 37.164 32.831 36.620 33.132 36.191Z',
    faceY: -5.5,
    faceScale: 0.92,
  },
  blob: {
    path: 'M32 5C19 5 7 17 7 32s12 27 25 27 25-12 25-27S45 5 32 5Z',
  },
  /** Square with short corners so the face still sits inside the body. */
  square: {
    path: 'M18 10h28a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8Z',
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
  /** Point-up triangle — convex rounded corners (from driehoek staand.svg). */
  triangle: {
    path:
      'M25.130 11.980C28.168 6.718 35.762 6.718 38.799 11.980L57.361 44.129C60.398 49.390 56.601 55.966 50.526 55.966H13.404C7.328 55.966 3.532 49.390 6.569 44.129L25.130 11.980Z',
    faceY: 8,
    faceScale: 0.82,
  },
  /** Point-down triangle — convex rounded corners (from driehoek ondersteboven.svg). */
  triangledown: {
    path:
      'M38.799 52.020C35.762 57.282 28.168 57.282 25.130 52.020L6.569 19.871C3.532 14.610 7.328 8.034 13.404 8.034L50.526 8.034C56.601 8.034 60.398 14.610 57.361 19.871L38.799 52.020Z',
    faceY: -6,
    faceScale: 0.82,
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
   * Claude body: torso, side bar, and four legs. Traced from the supplied
   * SVG into this viewBox. The source eye slots are the live face.
   */
  claude: {
    path:
      'M13.731 12.509H50.147A3.666 3.666 0 0 1 53.813 16.175V41.104A3.666 3.666 0 0 1 50.147 44.77H13.731A3.666 3.666 0 0 1 10.065 41.104V16.175A3.666 3.666 0 0 1 13.731 12.509ZM5.666 28.64H58.334A3.666 3.666 0 0 1 62 32.305V33.405A3.666 3.666 0 0 1 58.334 37.071H5.666A3.666 3.666 0 0 1 2 33.405V32.305A3.666 3.666 0 0 1 5.666 28.64ZM15.686 32.183H15.686A1.955 1.955 0 0 1 17.642 34.138V49.536A1.955 1.955 0 0 1 15.686 51.491H15.686A1.955 1.955 0 0 1 13.731 49.536V34.138A1.955 1.955 0 0 1 15.686 32.183ZM23.018 32.183H23.018A1.955 1.955 0 0 1 24.974 34.138V49.536A1.955 1.955 0 0 1 23.018 51.491H23.018A1.955 1.955 0 0 1 21.063 49.536V34.138A1.955 1.955 0 0 1 23.018 32.183ZM41.165 32.183H41.165A1.894 1.894 0 0 1 43.059 34.077V49.597A1.894 1.894 0 0 1 41.165 51.491H41.165A1.894 1.894 0 0 1 39.271 49.597V34.077A1.894 1.894 0 0 1 41.165 32.183ZM48.558 32.183H48.558A1.955 1.955 0 0 1 50.513 34.138V49.536A1.955 1.955 0 0 1 48.558 51.491H48.558A1.955 1.955 0 0 1 46.603 49.536V34.138A1.955 1.955 0 0 1 48.558 32.183Z',
    faceY: -2.276,
    faceScale: 0.976,
  },
  /**
   * Cursor body: hexagon plus the arrow mark as a darker detail.
   * Live eyes sit where the source SVG drew them.
   */
  cursor: {
    path:
      'M28.155 3.032C30.534 1.656 33.466 1.656 35.845 3.032L55.124 14.181C57.504 15.557 58.97 18.1 58.97 20.852V43.148C58.97 45.9 57.504 48.443 55.124 49.82L35.845 60.968C33.466 62.344 30.534 62.344 28.155 60.968L8.876 49.82C6.496 48.443 5.03 45.9 5.03 43.148V20.852C5.03 18.1 6.496 15.557 8.876 14.181L28.155 3.032Z',
    detailPath:
      'M52.959 18.384H10.72C9.05 18.384 8.467 20.605 9.921 21.428L29.983 32.78C30.493 33.069 30.808 33.611 30.808 34.197V56.972C30.808 58.651 33.038 59.23 33.853 57.763L54.379 20.803C54.981 19.718 54.198 18.384 52.959 18.384Z',
    faceY: -0.044,
    faceScale: 1.21,
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
/** Curated catalog values, plus arbitrary brand hex via resolve. */
export type BotOrbColorValue = (typeof BOT_ORB_COLORS)[number]['value'] | (string & {})

export const DEFAULT_BOT_ORB_COLOR: BotOrbColorValue = '#9159fe'

/** Quick-access ids in the identity dialog (plus workspace brand as `accent`). */
export const BOT_ORB_QUICK_COLOR_IDS = ['violet', 'gray'] as const

const COLOR_VALUES = new Set<string>(BOT_ORB_COLORS.map((row) => row.value))
const HEX_RE = /^#[0-9a-f]{6}$/

export function isBotOrbHex(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim().toLowerCase())
}

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
  if (HEX_RE.test(hex)) return hex
  const byId = BOT_ORB_COLORS.find((row) => row.id === hex)
  return byId?.value ?? DEFAULT_BOT_ORB_COLOR
}

/** Catalog swatches that sit behind the identity-dialog “more colors” fold. */
export function botOrbMoreColors() {
  const quick = new Set<string>(BOT_ORB_QUICK_COLOR_IDS)
  return BOT_ORB_COLORS.filter((row) => !quick.has(row.id))
}

export function botOrbShapeDef(shape: string | null | undefined): BotOrbShapeDef {
  return BOT_ORB_SHAPES[resolveBotOrbShape(shape)]
}

