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

/** Discrete face acts played in a random sequence. */
type FaceAct =
  | 'base'
  | 'look-left'
  | 'look-right'
  | 'look-up'
  | 'look-down'
  | 'look-up-left'
  | 'look-up-right'
  | 'look-down-left'
  | 'look-down-right'
  | 'squint'
  | 'blink'

type ActKind = 'look' | 'squint' | 'blink'

/** Named look choreographies (steps held by JS, then return to base). */
const LOOK_SEQS: FaceAct[][] = [
  ['look-left', 'look-up-left'],
  ['look-right', 'look-up-right'],
  ['look-left', 'look-down-left'],
  ['look-right', 'look-down-right'],
  ['look-left'],
  ['look-right'],
  ['look-down'],
  ['look-up'],
]

/** Max eye travel while tracking the pointer. */
const GAZE_MAX_X = 9.2
const GAZE_MAX_Y = 6.4
/** Start following when the pointer is this close to the avatar box. */
const PROXIMITY_PX = 200

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

/** Weighted pick; avoid immediate repeats when possible. */
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

function pickLookSeq(lastIdx: number | null): { seq: FaceAct[]; idx: number } {
  let idx = Math.floor(Math.random() * LOOK_SEQS.length)
  if (lastIdx !== null && idx === lastIdx && LOOK_SEQS.length > 1 && Math.random() < 0.7) {
    idx = (idx + 1 + Math.floor(Math.random() * (LOOK_SEQS.length - 1))) % LOOK_SEQS.length
  }
  return { seq: LOOK_SEQS[idx]!, idx }
}

/**
 * Colored bot mark: silhouette + white eyes. Idle face acts, thinking sway,
 * proximity mouse-follow (within ~200px).
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
  const fill = resolveBotOrbColor(color)
  const faceY = def.faceY ?? 0
  const faceScale = def.faceScale ?? 1
  const [act, setAct] = useState<FaceAct>('base')
  const [tracking, setTracking] = useState(false)
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  const thinking = motion === 'thinking'

  useEffect(() => {
    // Thinking uses a CSS gaze loop; proximity tracking owns the eyes while active.
    if (paused || tracking || thinking || prefersReducedMotion()) {
      if (!tracking) setAct('base')
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    let last: ActKind | null = null
    let lastLookIdx: number | null = null

    const run = async () => {
      try {
        while (!signal.aborted) {
          setAct('base')
          await sleep(randBetween(1200, 4200), signal)

          const kind = pickAct(last)
          last = kind

          if (kind === 'look') {
            const { seq, idx } = pickLookSeq(lastLookIdx)
            lastLookIdx = idx
            for (const step of seq) {
              setAct(step)
              await sleep(randBetween(650, 950), signal)
            }
            setAct('base')
            await sleep(randBetween(180, 420), signal)
          } else if (kind === 'squint') {
            setAct('squint')
            await sleep(1500, signal)
            setAct('base')
          } else {
            setAct('blink')
            await sleep(randBetween(220, 300), signal)
            setAct('base')
          }
        }
      } catch {
        // aborted
      }
    }

    void run()
    return () => {
      controller.abort()
      setAct('base')
    }
  }, [paused, tracking, thinking])

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
          setGaze({ x: 0, y: 0 })
          setAct('base')
        }
        return
      }

      if (!trackingRef.current) {
        trackingRef.current = true
        setAct('base')
        setTracking(true)
      }

      const halfW = Math.max(rect.width / 2, 1)
      const halfH = Math.max(rect.height / 2, 1)
      const nx = clamp((clientX - (rect.left + halfW)) / halfW, -1, 1)
      const ny = clamp((clientY - (rect.top + halfH)) / halfH, -1, 1)
      const dist = distanceToRect(clientX, clientY, rect)
      const pull = dist <= 0 ? 1 : clamp(1 - dist / PROXIMITY_PX, 0.35, 1)
      setGaze({ x: nx * GAZE_MAX_X * pull, y: ny * GAZE_MAX_Y * pull })
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

  const style = {
    width: size,
    height: size,
    ['--bot-orb-color' as string]: fill,
    ['--bot-orb-ink' as string]: '#ffffff',
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
      data-act={tracking ? 'base' : act}
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
          {/* clipPath + mask: CSS transforms on eyes often escape clipPath alone. */}
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path d={def.path} />
          </clipPath>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <path d={def.path} fill="#ffffff" />
          </mask>
        </defs>
        <g className="bot-orb__body" style={{ transformOrigin: '32px 32px' }}>
          <path d={def.path} fill="var(--bot-orb-color)" />
        </g>
        <g
          className="bot-orb__face-clip"
          clipPath={`url(#${clipId})`}
          mask={`url(#${maskId})`}
          style={{ clipPath: `url(#${clipId})` }}
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
              style={
                tracking
                  ? { transform: `translate(${gaze.x}px, ${gaze.y}px)` }
                  : undefined
              }
            >
              <g className="bot-orb__eyes">
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
