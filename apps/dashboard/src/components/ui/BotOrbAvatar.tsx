import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { BotOrbMotion } from '../../lib/agentActivity'
import {
  botOrbShapeDef,
  resolveBotOrbColor,
  resolveBotOrbShape,
  type BotOrbShapeKey,
} from '../../lib/bot-orb-shapes'
import { distanceToRect, subscribeBotOrbPointer } from '../../lib/bot-orb-pointer'
import { cn } from '../../lib/utils'

type Props = {
  color: string
  shape?: string | null
  size?: number
  className?: string
  /** Face mood: idle look-around, or busy thinking / typing / working. */
  motion?: BotOrbMotion
  /** Pause idle motion (picker previews may stay still). */
  paused?: boolean
  /** Hide from AT when a parent already labels the control. */
  decorative?: boolean
  label?: string
}

type EyeAct = 'base' | 'squint' | 'blink'
type ActKind = 'look' | 'squint' | 'blink'
type ThinkSide = 'center' | 'left' | 'right'
type Gaze = { x: number; y: number }

/** Idle look targets (SVG user units; view-box transform). */
const LOOK_GAZE: Record<string, Gaze> = {
  'look-left': { x: -5.4, y: 0 },
  'look-right': { x: 5.4, y: 0 },
  'look-up': { x: 0, y: -4.6 },
  'look-down': { x: 0, y: 3.8 },
  'look-up-left': { x: -5.2, y: -3.2 },
  'look-up-right': { x: 5.2, y: -3.2 },
  'look-down-left': { x: -5.2, y: 3.2 },
  'look-down-right': { x: 5.2, y: 3.2 },
}

const LOOK_SEQS: (keyof typeof LOOK_GAZE)[][] = [
  ['look-left', 'look-up-left'],
  ['look-right', 'look-up-right'],
  ['look-left', 'look-down-left'],
  ['look-right', 'look-down-right'],
  ['look-left'],
  ['look-right'],
  ['look-down'],
  ['look-up'],
]

/** Thinking: high, but clearly below the top rim. */
const THINK_Y = -15.5
const THINK_GAZE: Record<ThinkSide, Gaze> = {
  center: { x: 0, y: THINK_Y },
  left: { x: -5, y: THINK_Y },
  right: { x: 5.2, y: THINK_Y },
}

const GAZE_MAX_X = 9.2
const GAZE_MAX_Y = 6.4
/** Normalize vertical look including thinking height. */
const GAZE_NORM_Y = Math.max(GAZE_MAX_Y, Math.abs(THINK_Y))
const PROXIMITY_PX = 200

/** Max eye tilt (deg) when looking into a corner. */
const EYE_TILT_MAX = 11
/** How much eyes flatten when looking fully up/down. */
const EYE_SQUASH_MAX = 0.34
/** Slight widen so foreshortened eyes keep volume. */
const EYE_WIDEN_MAX = 0.1

const MS_LOOK = 580
const MS_THINK = 700
/** Return-to-base: always slower so thinking → idle never snaps. */
const MS_SETTLE = 1200
const MS_TRACK = 90

/** Perspective pose from gaze: corner tilt + up/down foreshorten (Grok-like). */
function gazeEyePose(gaze: Gaze): { tiltDeg: number; scaleX: number; scaleY: number } {
  const nx = clamp(gaze.x / GAZE_MAX_X, -1, 1)
  const ny = clamp(gaze.y / GAZE_NORM_Y, -1, 1)
  const absNy = Math.abs(ny)
  // Tops lean toward the look corner (up-right → slight clockwise).
  const tiltDeg = -nx * ny * EYE_TILT_MAX
  const scaleY = 1 - absNy * EYE_SQUASH_MAX
  const scaleX = 1 + absNy * EYE_WIDEN_MAX
  return { tiltDeg, scaleX, scaleY }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const id = window.setTimeout(() => resolve(), ms)
    const onAbort = () => {
      window.clearTimeout(id)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function pickAct(last: ActKind | null): ActKind {
  const roll = Math.random()
  let kind: ActKind
  if (roll < 0.4) kind = 'blink'
  else if (roll < 0.78) kind = 'look'
  else kind = 'squint'
  if (last !== null && kind === last && Math.random() < 0.65) {
    const others: ActKind[] = (['blink', 'look', 'squint'] as const).filter((k) => k !== last)
    kind = others[Math.floor(Math.random() * others.length)]!
  }
  return kind
}

function pickLookSeq(lastIdx: number | null): { seq: (keyof typeof LOOK_GAZE)[]; idx: number } {
  let idx = Math.floor(Math.random() * LOOK_SEQS.length)
  if (lastIdx !== null && idx === lastIdx && LOOK_SEQS.length > 1 && Math.random() < 0.7) {
    idx = (idx + 1 + Math.floor(Math.random() * (LOOK_SEQS.length - 1))) % LOOK_SEQS.length
  }
  return { seq: LOOK_SEQS[idx]!, idx }
}

/**
 * Colored bot mark: silhouette + white eyes. All gaze is JS-driven with CSS
 * transitions so motion never snaps when mood (thinking → idle) changes.
 */
export function BotOrbAvatar({
  color,
  shape,
  size = 32,
  className,
  motion = 'idle',
  paused = false,
  decorative = false,
  label = 'Agent',
}: Props) {
  const uid = useId().replace(/:/g, '')
  const clipId = `bot-orb-clip-${uid}`
  const maskId = `bot-orb-mask-${uid}`
  const rootRef = useRef<HTMLSpanElement>(null)
  const trackingRef = useRef(false)
  const rafRef = useRef(0)
  const pendingPtr = useRef<{ x: number; y: number } | null>(null)
  const shapeKey: BotOrbShapeKey = resolveBotOrbShape(shape)
  const def = botOrbShapeDef(shapeKey)
  /** Eyes clip to the face body only — never ears — so overlaps can't hole the mask. */
  const faceClip = def.path
  const fill = resolveBotOrbColor(color)
  const faceY = def.faceY ?? 0
  const faceScale = def.faceScale ?? 1
  const [eyeAct, setEyeAct] = useState<EyeAct>('base')
  const [thinkSide, setThinkSide] = useState<ThinkSide | null>(null)
  const [tracking, setTracking] = useState(false)
  const [gaze, setGaze] = useState<Gaze>({ x: 0, y: 0 })
  const [gazeMs, setGazeMs] = useState(MS_LOOK)
  const thinking = motion === 'thinking'

  const moveGaze = (next: Gaze, ms: number) => {
    setGazeMs(ms)
    setGaze(next)
  }

  const settleHome = () => {
    setEyeAct('base')
    setThinkSide(null)
    moveGaze({ x: 0, y: 0 }, MS_SETTLE)
  }

  // Idle look / blink / squint choreography.
  useEffect(() => {
    if (paused || tracking || thinking || prefersReducedMotion()) {
      if (!tracking && !thinking) {
        setEyeAct('base')
      }
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    let last: ActKind | null = null
    let lastLookIdx: number | null = null

    const run = async () => {
      try {
        while (!signal.aborted) {
          setEyeAct('base')
          await sleep(randBetween(1200, 4200), signal)

          const kind = pickAct(last)
          last = kind

          if (kind === 'look') {
            const { seq, idx } = pickLookSeq(lastLookIdx)
            lastLookIdx = idx
            for (const step of seq) {
              moveGaze(LOOK_GAZE[step]!, MS_LOOK)
              await sleep(randBetween(650, 950), signal)
            }
            moveGaze({ x: 0, y: 0 }, MS_SETTLE)
            await sleep(randBetween(220, 480), signal)
          } else if (kind === 'squint') {
            setEyeAct('squint')
            await sleep(1500, signal)
            setEyeAct('base')
          } else {
            setEyeAct('blink')
            await sleep(randBetween(220, 300), signal)
            setEyeAct('base')
          }
        }
      } catch {
        // aborted
      }
    }

    void run()
    return () => {
      controller.abort()
      // Do not settle here: cleanup closes over stale thinking/tracking. Thinking
      // and pointer-tracking own the next gaze; pause settles separately.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moveGaze via closure
  }, [paused, tracking, thinking])

  // Pause: ease eyes home (no snap).
  useEffect(() => {
    if (!paused) return
    settleHome()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  // Thinking: center-up, then left / right sway (JS so exit can settle smoothly).
  useEffect(() => {
    if (!thinking || paused || tracking || prefersReducedMotion()) {
      return
    }
    const controller = new AbortController()
    const { signal } = controller

    const run = async () => {
      try {
        while (!signal.aborted) {
          setThinkSide('center')
          moveGaze(THINK_GAZE.center, MS_THINK)
          await sleep(randBetween(1100, 1500), signal)

          setThinkSide('left')
          moveGaze(THINK_GAZE.left, MS_THINK)
          await sleep(randBetween(1200, 1600), signal)

          setThinkSide('right')
          moveGaze(THINK_GAZE.right, MS_THINK)
          await sleep(randBetween(1200, 1600), signal)

          setThinkSide('left')
          moveGaze(THINK_GAZE.left, MS_THINK)
          await sleep(randBetween(1200, 1600), signal)

          setThinkSide('right')
          moveGaze(THINK_GAZE.right, MS_THINK)
          await sleep(randBetween(1200, 1600), signal)
        }
      } catch {
        // aborted — settle handled in cleanup
      }
    }

    void run()
    return () => {
      controller.abort()
      settleHome()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking, paused, tracking])

  useEffect(() => {
    if (paused || prefersReducedMotion()) return

    const applyPointer = (clientX: number, clientY: number) => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const near = distanceToRect(clientX, clientY, rect) <= PROXIMITY_PX

      if (!near) {
        if (trackingRef.current) {
          trackingRef.current = false
          setTracking(false)
          setEyeAct('base')
          moveGaze({ x: 0, y: 0 }, MS_SETTLE)
        }
        return
      }

      if (!trackingRef.current) {
        trackingRef.current = true
        setEyeAct('base')
        setThinkSide(null)
        setTracking(true)
      }

      const halfW = Math.max(rect.width / 2, 1)
      const halfH = Math.max(rect.height / 2, 1)
      const nx = clamp((clientX - (rect.left + halfW)) / halfW, -1, 1)
      const ny = clamp((clientY - (rect.top + halfH)) / halfH, -1, 1)
      const dist = distanceToRect(clientX, clientY, rect)
      const pull = dist <= 0 ? 1 : clamp(1 - dist / PROXIMITY_PX, 0.35, 1)
      moveGaze({ x: nx * GAZE_MAX_X * pull, y: ny * GAZE_MAX_Y * pull }, MS_TRACK)
    }

    const flush = () => {
      rafRef.current = 0
      const pending = pendingPtr.current
      pendingPtr.current = null
      if (!pending) return
      applyPointer(pending.x, pending.y)
    }

    return subscribeBotOrbPointer((clientX, clientY) => {
      pendingPtr.current = { x: clientX, y: clientY }
      if (!rafRef.current) {
        rafRef.current = window.requestAnimationFrame(flush)
      }
    })
  }, [paused])

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const eyePose = gazeEyePose(gaze)
  const gazeTransition = {
    transitionDuration: `${gazeMs}ms`,
    transitionTimingFunction:
      gazeMs >= MS_SETTLE ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease',
  } as const
  const style = {
    width: size,
    height: size,
    ['--bot-orb-color' as string]: fill,
    ['--bot-orb-ink' as string]: '#ffffff',
    ['--bot-orb-gaze-ms' as string]: `${gazeMs}ms`,
  } as CSSProperties
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': label }

  return (
    <span
      ref={rootRef}
      className={cn('bot-orb', paused && 'bot-orb--paused', className)}
      style={style}
      data-testid="bot-orb-avatar"
      data-shape={shapeKey}
      data-motion={paused ? 'paused' : motion}
      data-act={eyeAct}
      data-think-side={thinkSide ?? undefined}
      data-tracking={tracking ? 'true' : undefined}
      {...a11y}
    >
      <svg
        className="bot-orb__svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse" clipRule="nonzero">
            <path d={faceClip} fillRule="nonzero" />
          </clipPath>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <path d={faceClip} fill="#ffffff" fillRule="nonzero" />
          </mask>
        </defs>
        <g className="bot-orb__body" style={{ transformOrigin: '32px 32px' }}>
          {def.underPath ? (
            <path d={def.underPath} fill="var(--bot-orb-color)" fillRule="nonzero" />
          ) : null}
          {def.shadePath ? (
            <path
              d={def.shadePath}
              fill="color-mix(in srgb, var(--bot-orb-color) 90%, #000)"
              fillRule="nonzero"
            />
          ) : null}
          <path d={def.path} fill="var(--bot-orb-color)" fillRule="nonzero" />
        </g>
        <g
          className="bot-orb__face-clip"
          clipPath={`url(#${clipId})`}
          mask={`url(#${maskId})`}
        >
          <g
            className="bot-orb__face"
            style={{
              transform: `translate(0px, ${faceY}px) scale(${faceScale})`,
              transformOrigin: '32px 30px',
            }}
          >
            <g
              className="bot-orb__gaze"
              style={{
                transform: `translate(${gaze.x}px, ${gaze.y}px)`,
                ...gazeTransition,
              }}
            >
              <g
                className="bot-orb__eyes"
                style={{
                  transform: `rotate(${eyePose.tiltDeg}deg) scale(${eyePose.scaleX}, ${eyePose.scaleY})`,
                  ...gazeTransition,
                }}
              >
                <rect
                  className="bot-orb__eye"
                  x="19.2"
                  y="25.5"
                  width="7.2"
                  height="11"
                  rx="3.6"
                  fill="var(--bot-orb-ink)"
                />
                <rect
                  className="bot-orb__eye"
                  x="37.6"
                  y="25.5"
                  width="7.2"
                  height="11"
                  rx="3.6"
                  fill="var(--bot-orb-ink)"
                />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </span>
  )
}
