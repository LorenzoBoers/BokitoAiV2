import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import { isBotOrbBusyLoop, isBotOrbOneShot, oneShotDurationMs, type BotOrbOneShot } from '../../lib/bot-orb-motion'
import {
  BotOrbRig,
  GAZE_MAX_X,
  GAZE_MAX_Y,
  playLoop,
  playShot,
  restingFace,
  type Gaze,
  type RigFrame,
} from '../../lib/bot-orb-rig'
import {
  botOrbShapeDef,
  resolveBotOrbColor,
  resolveBotOrbShape,
  type BotOrbShapeKey,
} from '../../lib/bot-orb-shapes'
import { distanceToRect, subscribeBotOrbPointer } from '../../lib/bot-orb-pointer'
import { snapMarkSize } from '../../lib/mark-scale'
import { cn } from '../../lib/utils'

export type BotOrbMode = 'live' | 'static'
type BotOrbSpawnStyle = 'full' | 'quick'

/** Keys already played this session — seat remounts must not re-rise. */
const playedBotOrbSpawnKeys = new Set<string>()

const FULL_SPAWN_MS = 1550
const QUICK_SPAWN_MS = 480

function spawnStyleFromKey(spawnKey: string): BotOrbSpawnStyle {
  return spawnKey.startsWith('quick-') ? 'quick' : 'full'
}

type Props = {
  color: string
  shape?: string | null
  size?: number
  className?: string
  /** Face mood: idle / busy loops / one-shots. */
  motion?: BotOrbMotion
  /** Replay one-shot when this changes. */
  pulseId?: string | null
  /** Base loop after a one-shot settles (defaults to idle). */
  baseMotion?: BotOrbMotion
  /**
   * Presentation: `live` animates; `static` freezes the face (footprints,
   * thread list, facepiles). Defaults to live unless `paused`.
   */
  mode?: BotOrbMode
  /**
   * Alias for `mode="static"`. Prefer `mode` for new call sites.
   * @deprecated Use `mode="static"`.
   */
  paused?: boolean
  /**
   * When this changes while live, play a one-shot entrance.
   * Prefix `quick-` = grow in place; anything else (incl. `full-` / preview) = ground rise.
   */
  spawnKey?: string | null
  /**
   * Surface-colored silhouette outline for overlapping facepiles (matches
   * the user AvatarStack ring cutout).
   */
  stackOutline?: boolean
  /** Hide from AT when a parent already labels the control. */
  decorative?: boolean
  label?: string
}

function resolveBotOrbPaused(
  mode: BotOrbMode | undefined,
  paused: boolean | undefined,
): boolean {
  if (mode === 'static') return true
  if (mode === 'live') return false
  return Boolean(paused)
}

/** Chrome around the body is always the AI color, independent of the body color. */
const BOT_ORB_ORBIT_COLOR = 'var(--bot-orb-glow)'
/** Badge edge is theme-tinted via CSS (`--bot-orb-badge-edge`). */
const BOT_ORB_BADGE_FILL = BOT_ORB_ORBIT_COLOR

/**
 * Perspective orbits: each ring is an ellipse tilted in the screen plane.
 * Back half (local y < 32) paints behind the body; front half paints after,
 * so the stroke reads as wrapping around the mark.
 */
type OrbitRing = {
  id: 'a' | 'b'
  tiltDeg: number
  ry: number
  rx?: number
  dash: string
  strokeWidth: number
  opacity: number
  load?: boolean
}

const WORK_RINGS: OrbitRing[] = [
  { id: 'a', tiltDeg: 38, ry: 11.5, dash: '4 10', strokeWidth: 1.4, opacity: 0.45, load: true },
  { id: 'b', tiltDeg: -52, ry: 13, dash: '3 11', strokeWidth: 1.1, opacity: 0.3 },
]

function OrbitHalves({ rings, clipId, layer }: { rings: OrbitRing[]; clipId: string; layer: 'back' | 'front' }) {
  const frontBoost = layer === 'front' ? 1.2 : 0.88
  return (
    <g className={`bot-orb__orbits bot-orb__orbits--${layer}`} aria-hidden>
      {rings.map((ring) => (
        <g
          key={`${layer}-${ring.id}`}
          className={`bot-orb__orbit bot-orb__orbit--${ring.id}`}
          transform={`rotate(${ring.tiltDeg} 32 32)`}
        >
          <g clipPath={`url(#${clipId})`}>
            <ellipse
              className="bot-orb__orbit-ring"
              cx="32"
              cy="32"
              rx={ring.rx ?? 30.5}
              ry={ring.ry}
              fill="none"
              stroke={BOT_ORB_ORBIT_COLOR}
              strokeWidth={ring.strokeWidth}
              strokeOpacity={Math.min(1, ring.opacity * frontBoost)}
              strokeDasharray={ring.dash}
              pathLength={100}
            />
            {ring.load ? (
              <ellipse
                className="bot-orb__orbit-load"
                cx="32"
                cy="32"
                rx={ring.rx ?? 30.5}
                ry={ring.ry}
                fill="none"
                stroke={BOT_ORB_ORBIT_COLOR}
                strokeWidth={2}
                strokeOpacity={Math.min(1, 0.72 * frontBoost)}
                strokeLinecap="round"
                strokeDasharray="12 88"
                pathLength={100}
              />
            ) : null}
          </g>
        </g>
      ))}
    </g>
  )
}

const EYE_TILT_MAX = 11
const EYE_SQUASH_MAX = 0.34
const EYE_WIDEN_MAX = 0.1
const GAZE_NORM_Y = 6.8
const PROXIMITY_PX = 200
/** Beyond eye range the whole body still leans a little toward the cursor. */
const LEAN_PX = 720

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function gazeEyePose(gaze: Gaze): { tiltDeg: number; scaleX: number; scaleY: number } {
  const nx = clamp(gaze.x / GAZE_MAX_X, -1, 1)
  const ny = clamp(gaze.y / GAZE_NORM_Y, -1, 1)
  const absNy = Math.abs(ny)
  return {
    tiltDeg: -nx * ny * EYE_TILT_MAX,
    scaleX: 1 + absNy * EYE_WIDEN_MAX,
    scaleY: 1 - absNy * EYE_SQUASH_MAX,
  }
}

/**
 * Nose sits lower on the face sphere — strong shared parallax so L/R stay
 * mirror-symmetric; foreshorten only via scale (near side grows).
 */
const NOSE_PARALLAX_X = 0.68
const NOSE_PARALLAX_Y = 0.62
const NOSE_SEP = 0.28
const NOSE_TILT_MAX = 6
const NOSE_SQUASH_MAX = 0.18

function gazeNostrilPose(gaze: Gaze, side: 'left' | 'right') {
  const nx = clamp(gaze.x / GAZE_MAX_X, -1, 1)
  const ny = clamp(gaze.y / GAZE_NORM_Y, -1, 1)
  const toward = (side === 'left' ? -1 : 1) * nx
  return {
    x: gaze.x * NOSE_PARALLAX_X + toward * NOSE_SEP,
    y: gaze.y * NOSE_PARALLAX_Y,
    tiltDeg: -nx * ny * NOSE_TILT_MAX,
    scaleX: 1 + toward * 0.16 - Math.abs(nx) * 0.05,
    scaleY: 1 - Math.abs(ny) * NOSE_SQUASH_MAX + toward * 0.05,
  }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Spawn class for this paint. The CSS rise must be on the first frame that
 * has the key — waiting for an effect flashes the orb at full size first. */
function unplayedSpawn(spawnKey: string | null, frozen: boolean): BotOrbSpawnStyle | null {
  if (!spawnKey || frozen || prefersReducedMotion()) return null
  if (playedBotOrbSpawnKeys.has(spawnKey)) return null
  return spawnStyleFromKey(spawnKey)
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString()

const EYE_CY = 31
const EYE_CX = { left: 22.8, right: 41.2 } as const
const NOSE_ORIGIN = { left: [29.2, 35.2], right: [34.9, 35.2] } as const

type PaintRefs = {
  rig: SVGGElement | null
  gaze: SVGGElement | null
  eyes: SVGGElement | null
  eyeL: SVGRectElement | null
  eyeR: SVGRectElement | null
  arcL: SVGPathElement | null
  arcR: SVGPathElement | null
  noseL: SVGPathElement | null
  noseR: SVGPathElement | null
  noseOne: SVGPathElement | null
}

function eyeTransform(cx: number, f: RigFrame, side: 'left' | 'right') {
  const k = side === 'left' ? f.kl : f.kr
  const tilt = side === 'left' ? f.tl : f.tr
  const dy = side === 'left' ? f.dyl : f.dyr
  const sy = Math.max(0.02, f.esy * k * f.lid)
  return `translate(${cx} ${n2(EYE_CY + dy)}) rotate(${n2(tilt)}) scale(${n2(f.esx * k)} ${n2(sy)}) translate(${-cx} ${-EYE_CY})`
}

function paintFrame(el: PaintRefs, f: RigFrame) {
  el.rig?.setAttribute(
    'transform',
    `translate(${n2(f.bx)} ${n2(f.by)}) rotate(${n2(f.br)} 32 44) translate(32 56) scale(${n2(f.sx)} ${n2(f.sy)}) translate(-32 -56)`,
  )
  if (el.rig) {
    el.rig.style.opacity = f.alpha < 0.999 ? n2(Math.max(0, f.alpha)) : ''
    el.rig.style.filter = f.speed > 60 ? `blur(${n2(Math.min(2.4, f.speed / 140))}px)` : ''
  }
  const gaze = { x: f.gx, y: f.gy }
  el.gaze?.setAttribute('transform', `translate(${n2(gaze.x)} ${n2(gaze.y)})`)
  const pose = gazeEyePose(gaze)
  el.eyes?.setAttribute(
    'transform',
    `translate(32 31) rotate(${n2(pose.tiltDeg)}) scale(${n2(pose.scaleX)} ${n2(pose.scaleY)}) translate(-32 -31)`,
  )
  const left = eyeTransform(EYE_CX.left, f, 'left')
  const right = eyeTransform(EYE_CX.right, f, 'right')
  for (const [node, t, show] of [
    [el.eyeL, left, !f.arc],
    [el.eyeR, right, !f.arc],
    [el.arcL, left, f.arc],
    [el.arcR, right, f.arc],
  ] as const) {
    if (!node) continue
    node.setAttribute('transform', t)
    node.setAttribute('opacity', show ? '1' : '0')
  }
  for (const side of ['left', 'right'] as const) {
    const node = side === 'left' ? el.noseL : el.noseR
    if (!node) continue
    const p = gazeNostrilPose(gaze, side)
    const [ox, oy] = NOSE_ORIGIN[side]
    node.setAttribute(
      'transform',
      `translate(${n2(p.x - gaze.x)} ${n2(p.y - gaze.y)}) translate(${ox} ${oy}) rotate(${n2(p.tiltDeg)}) scale(${n2(p.scaleX)} ${n2(p.scaleY)}) translate(${-ox} ${-oy})`,
    )
  }
  el.noseOne?.setAttribute(
    'transform',
    `translate(${n2(gaze.x * (NOSE_PARALLAX_X - 1))} ${n2(gaze.y * (NOSE_PARALLAX_Y - 1))})`,
  )
}

const SPARKLE = 'M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1 Z'

/** Mood chrome around the face. Pure SVG; CSS animates it. */
function MoodChrome({ motion }: { motion: BotOrbMotion }) {
  switch (motion) {
    case 'thinking':
      return (
        <g transform="translate(48 10) rotate(12)">
          <g className="bot-orb__think-mark">
            <text
              className="bot-orb__badge-glyph"
              x="0"
              y="0"
              fill={BOT_ORB_BADGE_FILL}
              stroke="var(--bot-orb-badge-edge)"
              strokeWidth="0.95"
              paintOrder="stroke fill"
              strokeLinejoin="round"
              fontSize="19"
              fontWeight="700"
              fontFamily="var(--font-sans), system-ui, sans-serif"
              textAnchor="middle"
              dominantBaseline="central"
            >
              ?
            </text>
          </g>
        </g>
      )
    case 'searching':
      // Rings paint behind the body (see SearchingSonar before the figure).
      return null
    case 'writing':
      return (
        <g className="bot-orb__fx">
          <path className="bot-orb__scribble" d="M38 59 q3 -3.4 6 0 t6 0 t6 0" fill="none" pathLength={100} />
          <g transform="translate(55 50) rotate(32)">
            <g className="bot-orb__pencil bot-orb__badge-glyph">
              <rect x="-2.2" y="-12" width="4.4" height="10.5" rx="1.2" />
              <path d="M-2.2 -1.5 L2.2 -1.5 L0 3.2 Z" />
            </g>
          </g>
        </g>
      )
    case 'sending':
      return (
        <g className="bot-orb__fx">
          {[0, 1, 2].map((i) => (
            <circle key={i} className={`bot-orb__send-dot bot-orb__send-dot--${i}`} cx="56" cy="30" r={2.6 - i * 0.5} />
          ))}
        </g>
      )
    case 'sleeping':
      return (
        <g className="bot-orb__fx" fontFamily="var(--font-sans), system-ui, sans-serif" fontWeight="700">
          <text className="bot-orb__zz" x="48" y="14" fontSize="11">
            z
          </text>
          <text className="bot-orb__zz bot-orb__zz--late" x="55" y="6" fontSize="8">
            z
          </text>
        </g>
      )
    case 'yes':
      return (
        <g className="bot-orb__fx">
          {[
            [6, 14],
            [58, 10],
            [3, 42],
            [61, 40],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <path className={`bot-orb__sparkle bot-orb__sparkle--${i}`} d={SPARKLE} />
            </g>
          ))}
        </g>
      )
    case 'done':
      return (
        <g transform="translate(50 12)">
          <g className="bot-orb__done-mark bot-orb__badge-glyph">
            <circle
              cx="0"
              cy="0"
              r="8.5"
              fill={BOT_ORB_BADGE_FILL}
              stroke="var(--bot-orb-badge-edge)"
              strokeWidth="0.9"
              paintOrder="stroke fill"
            />
            <path
              d="M-3.6 0.2 L-1.2 2.8 L3.8 -2.6"
              fill="none"
              stroke="var(--bot-orb-badge-edge)"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      )
    case 'no':
      return (
        <g className="bot-orb__fx" transform="translate(53 14)">
          <path className="bot-orb__sweat" d="M0 -4.5 C2 -1.2 3.2 0.8 3.2 2.3 A3.2 3.2 0 0 1 -3.2 2.3 C-3.2 0.8 -2 -1.2 0 -4.5 Z" />
        </g>
      )
    case 'alert':
      return (
        <g className="bot-orb__fx" transform="translate(32 -1)">
          <g className="bot-orb__bang">
            <rect x="-2.1" y="-11" width="4.2" height="9" rx="2.1" />
            <circle cx="0" cy="2.4" r="2.2" />
          </g>
        </g>
      )
    case 'leave':
      return (
        <g className="bot-orb__fx bot-orb__speed" fill="none" strokeLinecap="round">
          <path d="M-6 24 h14" />
          <path d="M-10 33 h18" />
          <path d="M-5 42 h12" />
          <circle className="bot-orb__puff" cx="24" cy="58" r="4" />
          <circle className="bot-orb__puff bot-orb__puff--late" cx="38" cy="59" r="3" />
        </g>
      )
    default:
      return null
  }
}

/**
 * Colored bot mark: silhouette + white eyes + mood chrome. Face and body run
 * on a spring rig painted per frame; chrome and glow are CSS via data-motion.
 */
export function BotOrbAvatar({
  color,
  shape,
  size: rawSize = 32,
  className,
  motion = 'idle',
  pulseId = null,
  baseMotion = 'idle',
  mode,
  paused = false,
  spawnKey = null,
  stackOutline = false,
  decorative = false,
  label = 'Agent',
}: Props) {
  const size = snapMarkSize(rawSize)
  const frozen = resolveBotOrbPaused(mode, paused)
  const uid = useId().replace(/:/g, '')
  const clipId = `bot-orb-clip-${uid}`
  const maskId = `bot-orb-mask-${uid}`
  const groundClipId = `bot-orb-ground-${uid}`
  const rootRef = useRef<HTMLSpanElement>(null)
  const rigRef = useRef<BotOrbRig | null>(null)
  if (!rigRef.current) rigRef.current = new BotOrbRig()
  const paintRefs = useRef<PaintRefs>({
    rig: null,
    gaze: null,
    eyes: null,
    eyeL: null,
    eyeR: null,
    arcL: null,
    arcR: null,
    noseL: null,
    noseR: null,
    noseOne: null,
  })
  const [spawning, setSpawning] = useState(false)
  const [spawnStyle, setSpawnStyle] = useState<BotOrbSpawnStyle>('full')
  const pendingRise = unplayedSpawn(spawnKey, frozen)
  const rising = spawning || pendingRise !== null
  const riseStyle: BotOrbSpawnStyle = pendingRise ?? spawnStyle
  const lastSpawnKey = useRef<string | null>(null)
  const spawnActiveRef = useRef(false)
  const spawnStartedAt = useRef(0)
  const trackingRef = useRef(false)
  const rafRef = useRef(0)
  const pendingPtr = useRef<{ x: number; y: number } | null>(null)
  const shapeKey: BotOrbShapeKey = resolveBotOrbShape(shape)
  const def = botOrbShapeDef(shapeKey)
  const faceClip = def.path
  const fill = def.palette?.body ?? resolveBotOrbColor(color)
  const faceY = def.faceY ?? 0
  const faceScale = def.faceScale ?? 1
  const reduced = prefersReducedMotion()

  const [activeMotion, setActiveMotion] = useState<BotOrbMotion>(() =>
    isBotOrbOneShot(motion) ? (isBotOrbOneShot(baseMotion) ? 'idle' : baseMotion) : motion,
  )
  const [playingShot, setPlayingShot] = useState<BotOrbOneShot | null>(() =>
    isBotOrbOneShot(motion) ? motion : null,
  )

  // Spawn always finishes as a neutral idle face — mood chrome waits until the entrance ends.
  const displayMotion: BotOrbMotion = frozen || rising ? 'idle' : playingShot ?? activeMotion
  const busyLoop = isBotOrbBusyLoop(displayMotion)
  const allowTrack = !frozen && !rising && !busyLoop && !playingShot && displayMotion === 'idle'
  const runRig = !frozen && !rising && !reduced

  const ref = <K extends keyof PaintRefs>(key: K) =>
    (node: PaintRefs[K]) => {
      paintRefs.current[key] = node
    }

  const paint = useCallback(() => {
    const rig = rigRef.current
    if (rig) paintFrame(paintRefs.current, rig.frame())
  }, [])

  // One rAF loop per mark; it sleeps once every spring is at rest.
  useEffect(() => {
    const rig = rigRef.current!
    let last = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const settled = rig.step(dt)
      paintFrame(paintRefs.current, rig.frame())
      rafRef.current = settled ? 0 : window.requestAnimationFrame(tick)
    }
    rig.onWake = () => {
      if (rafRef.current) return
      last = performance.now()
      rafRef.current = window.requestAnimationFrame(tick)
    }
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      rig.dispose()
    }
  }, [])

  // New shape nodes need the current pose before the next spring tick.
  useLayoutEffect(() => {
    paint()
  }, [paint, shapeKey])

  // One rise per spawnKey. Cleanup must not drop the class: StrictMode replays
  // this effect, and removing `.bot-orb--spawn` restarts the CSS animation.
  // A static footprint must not burn the key — the seat often claims before
  // `live` flips and still has to rise on the next paint.
  useEffect(() => {
    if (!spawnKey || prefersReducedMotion()) {
      if (spawnKey && prefersReducedMotion()) {
        lastSpawnKey.current = spawnKey
        playedBotOrbSpawnKeys.add(spawnKey)
        spawnActiveRef.current = false
        setSpawning(false)
      }
      return
    }
    if (playedBotOrbSpawnKeys.has(spawnKey)) {
      lastSpawnKey.current = spawnKey
      return
    }
    if (frozen && !spawnActiveRef.current) return
    const style = spawnStyleFromKey(spawnKey)
    const duration = style === 'quick' ? QUICK_SPAWN_MS : FULL_SPAWN_MS
    if (lastSpawnKey.current !== spawnKey) {
      lastSpawnKey.current = spawnKey
      spawnStartedAt.current = performance.now()
      spawnActiveRef.current = true
      setSpawnStyle(style)
      setPlayingShot(null)
      setSpawning(true)
    }
    const remain = Math.max(0, duration - (performance.now() - spawnStartedAt.current))
    const id = window.setTimeout(() => {
      playedBotOrbSpawnKeys.add(spawnKey)
      spawnActiveRef.current = false
      setSpawning(false)
    }, remain)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spawn trigger only
  }, [spawnKey, frozen])

  // Sync loop motion from props (ignore while a one-shot plays).
  // While spawning, still store the target mood so it applies the moment spawn ends.
  useEffect(() => {
    if (frozen) return
    if (isBotOrbOneShot(motion)) {
      if (rising) return
      setPlayingShot(motion)
      return
    }
    setActiveMotion(motion)
  }, [motion, frozen, rising])

  // Replay one-shot when pulseId changes (after spawn finishes).
  useEffect(() => {
    if (frozen || rising || !pulseId) return
    if (isBotOrbOneShot(motion)) setPlayingShot(motion)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional pulse trigger
  }, [pulseId, rising])

  // Static, spawning and reduced motion: hold the resting face, no springs.
  useEffect(() => {
    const rig = rigRef.current!
    if (runRig) return
    const face = frozen ? (motion === 'sleeping' ? 'sleepy' : 'neutral') : rising ? 'neutral' : restingFace(displayMotion)
    rig.setFace(face, { instant: true })
    rig.snap({ gx: 0, gy: 0, bx: 0, by: 0, br: 0, sx: 1, sy: 1, lid: 1, alpha: 1 })
    if (frozen || rising) setPlayingShot(null)
    trackingRef.current = false
  }, [runRig, frozen, rising, displayMotion, motion])

  // Every mood change lands with a small squash, like a beat in a cartoon.
  const lastMotionRef = useRef(displayMotion)
  useEffect(() => {
    if (!runRig || lastMotionRef.current === displayMotion) {
      lastMotionRef.current = displayMotion
      return
    }
    lastMotionRef.current = displayMotion
    rigRef.current!.kick({ sy: -1.4, sx: 0.9 })
  }, [runRig, displayMotion])

  // One-shot choreography, then back to the base loop.
  useEffect(() => {
    if (!playingShot) return
    const shot = playingShot
    const settle = () => {
      const next = isBotOrbOneShot(baseMotion) ? 'idle' : baseMotion
      setActiveMotion(isBotOrbOneShot(motion) ? next : motion)
      setPlayingShot(null)
    }
    if (!runRig) {
      if (!reduced || frozen || rising) return
      const id = window.setTimeout(settle, oneShotDurationMs(shot))
      return () => window.clearTimeout(id)
    }
    const controller = new AbortController()
    trackingRef.current = false
    const run = async () => {
      try {
        await playShot(shot, rigRef.current!, controller.signal)
      } catch {
        return
      }
      if (!controller.signal.aborted) settle()
    }
    void run()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingShot, runRig])

  // The mood loop. Tiny facepile marks keep blinks only (idle checks size).
  useEffect(() => {
    if (!runRig || playingShot) return
    const controller = new AbortController()
    void playLoop(displayMotion, rigRef.current!, {
      signal: controller.signal,
      size,
      tracking: () => trackingRef.current,
    })
    return () => controller.abort()
  }, [runRig, playingShot, displayMotion, size])

  // Idle: eyes follow a near cursor; from further away only the body leans.
  useEffect(() => {
    if (!allowTrack || size < 28 || reduced) {
      if (trackingRef.current) {
        trackingRef.current = false
        rigRef.current!.set({ gx: 0, gy: 0 })
      }
      return
    }
    const rig = rigRef.current!
    const applyPointer = (clientX: number, clientY: number) => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = distanceToRect(clientX, clientY, rect)
      if (dist > LEAN_PX) {
        if (trackingRef.current) {
          trackingRef.current = false
          rig.set({ gx: 0, gy: 0 })
        }
        rig.set({ bx: 0, by: 0, br: 0 })
        return
      }
      const lx = clamp((clientX - cx) / LEAN_PX, -1, 1)
      const ly = clamp((clientY - cy) / LEAN_PX, -1, 1)
      const lean = { bx: lx * 2.2, by: ly * 1.4, br: lx * 4 }
      if (dist > PROXIMITY_PX) {
        if (trackingRef.current) {
          trackingRef.current = false
          rig.set({ gx: 0, gy: 0 })
        }
        rig.set(lean)
        return
      }
      trackingRef.current = true
      const halfW = Math.max(rect.width / 2, 1)
      const halfH = Math.max(rect.height / 2, 1)
      const nx = clamp((clientX - cx) / halfW, -1, 1)
      const ny = clamp((clientY - cy) / halfH, -1, 1)
      const pull = dist <= 0 ? 1 : clamp(1 - dist / PROXIMITY_PX, 0.35, 1)
      rig.set({ ...lean, gx: nx * GAZE_MAX_X * pull, gy: ny * GAZE_MAX_Y * pull })
    }
    let frame = 0
    const flush = () => {
      frame = 0
      const pending = pendingPtr.current
      pendingPtr.current = null
      if (pending) applyPointer(pending.x, pending.y)
    }
    const unsubscribe = subscribeBotOrbPointer((clientX, clientY) => {
      pendingPtr.current = { x: clientX, y: clientY }
      if (!frame) frame = window.requestAnimationFrame(flush)
    })
    return () => {
      unsubscribe()
      if (frame) window.cancelAnimationFrame(frame)
      trackingRef.current = false
      rig.set({ gx: 0, gy: 0, bx: 0, by: 0, br: 0 })
    }
  }, [allowTrack, size, reduced])

  const canPoke = runRig && !playingShot && size >= 28 && (displayMotion === 'idle' || displayMotion === 'listening')
  const onPointerEnter = () => {
    if (!canPoke) return
    const rig = rigRef.current!
    rig.setFace('surprised')
    rig.kick({ sy: -2.4, by: -8 })
    rig.after(420, () => rig.setFace(restingFace(displayMotion)))
  }
  const onPointerDown = () => {
    if (!canPoke) return
    const rig = rigRef.current!
    rig.setFace('happy')
    rig.kick({ sy: -4, sx: 2.6, by: -12 })
    rig.after(700, () => rig.setFace(restingFace(displayMotion)))
  }

  const style = {
    width: size,
    height: size,
    ['--bot-orb-color' as string]: fill,
    ['--bot-orb-detail' as string]: def.palette?.detail ?? 'color-mix(in srgb, var(--bot-orb-color) 82%, #000)',
    ['--bot-orb-ink' as string]: def.palette?.ink ?? '#ffffff',
  } as CSSProperties
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': label }

  const dataMotion = rising ? 'idle' : frozen ? 'paused' : displayMotion
  const showChrome = !frozen && !rising && !reduced
  const orbitRings = showChrome && displayMotion === 'working' ? WORK_RINGS : null
  const orbitBackClipId = `bot-orb-orbit-back-${uid}`
  const orbitFrontClipId = `bot-orb-orbit-front-${uid}`

  return (
    <span
      ref={rootRef}
      className={cn(
        'bot-orb',
        frozen && !rising && 'bot-orb--paused',
        rising && (riseStyle === 'quick' ? 'bot-orb--quickspawn' : 'bot-orb--spawn'),
        stackOutline && 'bot-orb--stack',
        className,
      )}
      style={style}
      data-testid="bot-orb-avatar"
      data-shape={shapeKey}
      data-motion={dataMotion}
      data-pulse={pulseId || undefined}
      onPointerEnter={canPoke ? onPointerEnter : undefined}
      onPointerDown={canPoke ? onPointerDown : undefined}
      {...a11y}
    >
      <svg className="bot-orb__svg" viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse" clipRule="nonzero">
            <path d={faceClip} fillRule="nonzero" />
          </clipPath>
          <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
            <path d={faceClip} fill="#ffffff" fillRule="nonzero" />
          </mask>
          {/* Ground line for the full spawn: the body rises out of y=64. */}
          <clipPath id={groundClipId} clipPathUnits="userSpaceOnUse">
            <rect x="-64" y="-64" width="192" height="128" />
          </clipPath>
          {/* Local y < 32 = far side of the orbital plane (paints behind the body). */}
          <clipPath id={orbitBackClipId} clipPathUnits="userSpaceOnUse">
            <rect x="0" y="0" width="64" height="32" />
          </clipPath>
          <clipPath id={orbitFrontClipId} clipPathUnits="userSpaceOnUse">
            <rect x="0" y="32" width="64" height="32" />
          </clipPath>
        </defs>

        {orbitRings ? <OrbitHalves rings={orbitRings} clipId={orbitBackClipId} layer="back" /> : null}

        {/* Search rings sit behind the silhouette so they wrap the mark, not cover it. */}
        {showChrome && displayMotion === 'searching' ? (
          <g className="bot-orb__fx bot-orb__sonar" fill="none">
            <circle className="bot-orb__ping" cx="32" cy="32" r="26" />
            <circle className="bot-orb__ping bot-orb__ping--late" cx="32" cy="32" r="26" />
          </g>
        ) : null}

        {/* Figure carries the CSS entrance; the rig group inside carries every spring. */}
        <g clipPath={rising && riseStyle === 'full' ? `url(#${groundClipId})` : undefined}>
        <g className="bot-orb__figure">
          <g ref={ref('rig')} className="bot-orb__rig">
            <g className="bot-orb__body" style={{ transformOrigin: '32px 32px' }}>
              {def.underPath ? <path d={def.underPath} fill="var(--bot-orb-color)" fillRule="nonzero" /> : null}
              {def.shadePath ? (
                <path
                  d={def.shadePath}
                  fill="color-mix(in srgb, var(--bot-orb-color) 90%, #000)"
                  fillRule="nonzero"
                />
              ) : null}
              <path d={def.path} fill="var(--bot-orb-color)" fillRule="nonzero" />
            </g>
            <g className="bot-orb__face-clip" clipPath={`url(#${clipId})`} mask={`url(#${maskId})`}>
              {/*
                Gaze wraps both features. faceY/faceScale only lift the eyes into
                the head — nostrils stay on the muzzle at path coordinates.
              */}
              <g ref={ref('gaze')} className="bot-orb__gaze">
                {def.detailLeft || def.detailRight || def.detailPath ? (
                  <g className="bot-orb__nose">
                    {def.detailLeft ? (
                      <path
                        ref={ref('noseL')}
                        className="bot-orb__nostril"
                        d={def.detailLeft}
                        fill="var(--bot-orb-detail)"
                        fillRule="nonzero"
                      />
                    ) : null}
                    {def.detailRight ? (
                      <path
                        ref={ref('noseR')}
                        className="bot-orb__nostril"
                        d={def.detailRight}
                        fill="var(--bot-orb-detail)"
                        fillRule="nonzero"
                      />
                    ) : null}
                    {!def.detailLeft && !def.detailRight && def.detailPath ? (
                      <path
                        ref={ref('noseOne')}
                        className="bot-orb__nostril"
                        d={def.detailPath}
                        fill="var(--bot-orb-detail)"
                        fillRule="nonzero"
                      />
                    ) : null}
                  </g>
                ) : null}
                <g
                  className="bot-orb__face"
                  transform={`translate(0 ${faceY}) translate(32 30) scale(${faceScale}) translate(-32 -30)`}
                >
                  <g ref={ref('eyes')} className="bot-orb__eyes">
                    <rect
                      ref={ref('eyeL')}
                      className="bot-orb__eye"
                      x="19.2"
                      y="25.5"
                      width="7.2"
                      height="11"
                      rx="3.6"
                      fill="var(--bot-orb-ink)"
                    />
                    <rect
                      ref={ref('eyeR')}
                      className="bot-orb__eye"
                      x="37.6"
                      y="25.5"
                      width="7.2"
                      height="11"
                      rx="3.6"
                      fill="var(--bot-orb-ink)"
                    />
                    <path
                      ref={ref('arcL')}
                      className="bot-orb__eye-arc"
                      d="M19.4 33.4 Q22.8 25.2 26.2 33.4"
                      opacity="0"
                    />
                    <path
                      ref={ref('arcR')}
                      className="bot-orb__eye-arc"
                      d="M37.8 33.4 Q41.2 25.2 44.6 33.4"
                      opacity="0"
                    />
                  </g>
                </g>
              </g>
              <ellipse
                className="bot-orb__mouth"
                cx="32"
                cy="46"
                rx="5.2"
                ry="3.1"
                fill="var(--bot-orb-ink)"
              />
            </g>
          </g>
        </g>
        </g>

        {orbitRings ? <OrbitHalves rings={orbitRings} clipId={orbitFrontClipId} layer="front" /> : null}
        {showChrome ? <MoodChrome motion={displayMotion} /> : null}
      </svg>
    </span>
  )
}
