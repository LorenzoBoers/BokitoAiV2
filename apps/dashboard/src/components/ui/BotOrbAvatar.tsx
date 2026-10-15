import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import {
  BOT_ORB_MS,
  isBotOrbBusyLoop,
  isBotOrbOneShot,
  oneShotDurationMs,
  type BotOrbOneShot,
} from '../../lib/bot-orb-motion'
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
  /** Face mood: idle / busy loops / one-shots. */
  motion?: BotOrbMotion
  /** Replay one-shot when this changes. */
  pulseId?: string | null
  /** Base loop after a one-shot settles (defaults to idle). */
  baseMotion?: BotOrbMotion
  /** Pause idle motion (picker previews / facepiles). */
  paused?: boolean
  /** Hide from AT when a parent already labels the control. */
  decorative?: boolean
  label?: string
}

type EyeAct = 'base' | 'squint' | 'blink' | 'happy'
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

/** Thinking: glance up, still on the face (not into the forehead/ears). */
const THINK_Y = -6.8
const THINK_X = 4.6
const THINK_GAZE: Record<ThinkSide, Gaze> = {
  center: { x: 0, y: THINK_Y },
  left: { x: -THINK_X, y: THINK_Y },
  right: { x: THINK_X, y: THINK_Y },
}

/** Typing: slight down toward the composer. */
const TYPE_GAZE: Gaze = { x: 0, y: 4.2 }

/** Working: soft focus, barely off-center. */
const WORK_GAZE: Gaze = { x: 1.2, y: -1.5 }

const GAZE_MAX_X = 9.2
const GAZE_MAX_Y = 6.4
const GAZE_NORM_Y = Math.max(GAZE_MAX_Y, Math.abs(THINK_Y))
const PROXIMITY_PX = 200

const EYE_TILT_MAX = 11
const EYE_SQUASH_MAX = 0.34
const EYE_WIDEN_MAX = 0.1

const MS_LOOK = BOT_ORB_MS.look
const MS_THINK = BOT_ORB_MS.thinkSway
const MS_SETTLE = BOT_ORB_MS.settle
const MS_TRACK = BOT_ORB_MS.track

function gazeEyePose(gaze: Gaze): { tiltDeg: number; scaleX: number; scaleY: number } {
  const nx = clamp(gaze.x / GAZE_MAX_X, -1, 1)
  const ny = clamp(gaze.y / GAZE_NORM_Y, -1, 1)
  const absNy = Math.abs(ny)
  const tiltDeg = -nx * ny * EYE_TILT_MAX
  const scaleY = 1 - absNy * EYE_SQUASH_MAX
  const scaleX = 1 + absNy * EYE_WIDEN_MAX
  return { tiltDeg, scaleX, scaleY }
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

function gazeNostrilPose(
  gaze: Gaze,
  side: 'left' | 'right',
): { x: number; y: number; tiltDeg: number; scaleX: number; scaleY: number } {
  const nx = clamp(gaze.x / GAZE_MAX_X, -1, 1)
  const ny = clamp(gaze.y / GAZE_NORM_Y, -1, 1)
  const sideSign = side === 'left' ? -1 : 1
  // Positive when this nostril is on the near side of a head turn toward gaze.
  const toward = sideSign * nx
  const x = gaze.x * NOSE_PARALLAX_X + toward * NOSE_SEP
  const y = gaze.y * NOSE_PARALLAX_Y
  const tiltDeg = -nx * ny * NOSE_TILT_MAX
  const scaleX = 1 + toward * 0.16 - Math.abs(nx) * 0.05
  const scaleY = 1 - Math.abs(ny) * NOSE_SQUASH_MAX + toward * 0.05
  return { x, y, tiltDeg, scaleX, scaleY }
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
 * Colored bot mark: silhouette + white eyes + Lottie-inspired chrome.
 * Gaze is JS-driven; chrome spin/pulse is CSS via data-motion.
 */
export function BotOrbAvatar({
  color,
  shape,
  size = 32,
  className,
  motion = 'idle',
  pulseId = null,
  baseMotion = 'idle',
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
  const faceClip = def.path
  const fill = resolveBotOrbColor(color)
  const faceY = def.faceY ?? 0
  const faceScale = def.faceScale ?? 1

  const [eyeAct, setEyeAct] = useState<EyeAct>('base')
  const [thinkSide, setThinkSide] = useState<ThinkSide | null>(null)
  const [tracking, setTracking] = useState(false)
  const [gaze, setGaze] = useState<Gaze>({ x: 0, y: 0 })
  const [gazeMs, setGazeMs] = useState<number>(MS_LOOK)
  /** Active face mood after one-shot settle. */
  const [activeMotion, setActiveMotion] = useState<BotOrbMotion>(() =>
    isBotOrbOneShot(motion) ? (isBotOrbOneShot(baseMotion) ? 'idle' : baseMotion) : motion,
  )
  const [playingShot, setPlayingShot] = useState<BotOrbOneShot | null>(
    () => (isBotOrbOneShot(motion) ? motion : null),
  )

  const displayMotion: BotOrbMotion = paused
    ? 'idle'
    : playingShot ?? activeMotion
  const thinking = displayMotion === 'thinking'
  const typing = displayMotion === 'typing'
  const working = displayMotion === 'working'
  const busyLoop = isBotOrbBusyLoop(displayMotion)
  const allowTrack = !paused && !busyLoop && !playingShot && displayMotion === 'idle'

  const moveGaze = (next: Gaze, ms: number) => {
    setGazeMs(ms)
    setGaze(next)
  }

  const settleHome = () => {
    setEyeAct('base')
    setThinkSide(null)
    moveGaze({ x: 0, y: 0 }, MS_SETTLE)
  }

  // Sync loop motion from props (ignore while a one-shot plays).
  useEffect(() => {
    if (paused) return
    if (isBotOrbOneShot(motion)) {
      setPlayingShot(motion)
      return
    }
    setActiveMotion(motion)
    if (!playingShot) setPlayingShot(null)
  }, [motion, paused])

  // Replay one-shot when pulseId changes.
  useEffect(() => {
    if (paused || !pulseId) return
    if (isBotOrbOneShot(motion)) {
      setPlayingShot(motion)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional pulse trigger
  }, [pulseId])

  // One-shot choreography + settle back to base/loop.
  useEffect(() => {
    if (!playingShot || paused || prefersReducedMotion()) {
      if (playingShot && (paused || prefersReducedMotion())) {
        setPlayingShot(null)
      }
      return
    }
    const shot = playingShot
    const controller = new AbortController()
    const { signal } = controller
    const ms = oneShotDurationMs(shot)

    const run = async () => {
      try {
        setThinkSide(null)
        trackingRef.current = false
        setTracking(false)
        if (shot === 'yes') {
          setEyeAct('happy')
          moveGaze({ x: 0, y: -3 }, 180)
          await sleep(ms * 0.45, signal)
          setEyeAct('squint')
          await sleep(ms * 0.35, signal)
        } else if (shot === 'no') {
          setEyeAct('squint')
          moveGaze({ x: -6, y: 0 }, 120)
          await sleep(ms * 0.25, signal)
          moveGaze({ x: 6, y: 0 }, 120)
          await sleep(ms * 0.25, signal)
          moveGaze({ x: -4, y: 0 }, 120)
          await sleep(ms * 0.25, signal)
        } else if (shot === 'alert') {
          setEyeAct('blink')
          moveGaze({ x: 0, y: -2 }, 100)
          await sleep(ms * 0.35, signal)
          setEyeAct('squint')
          await sleep(ms * 0.4, signal)
        } else {
          // jump
          setEyeAct('happy')
          moveGaze({ x: 0, y: -5 }, 160)
          await sleep(ms * 0.4, signal)
          setEyeAct('base')
          await sleep(ms * 0.35, signal)
        }
        const next = isBotOrbOneShot(baseMotion) ? 'idle' : baseMotion
        const fromProp = isBotOrbOneShot(motion) ? next : motion
        setActiveMotion(fromProp === 'idle' || isBotOrbBusyLoop(fromProp) ? fromProp : next)
        settleHome()
        setPlayingShot(null)
      } catch {
        // aborted
      }
    }

    void run()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingShot, paused])

  // Idle look / blink / squint — skip tiny facepile marks (lists stay CSS-breathe).
  // Threshold 28 so Communication thread headers (28px) still track + look.
  useEffect(() => {
    if (
      paused ||
      tracking ||
      busyLoop ||
      playingShot ||
      size < 28 ||
      prefersReducedMotion()
    ) {
      if (!tracking && !thinking) {
        setEyeAct((a) => (a === 'happy' ? a : 'base'))
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
          await sleep(randBetween(1400, 4800), signal)

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, tracking, busyLoop, playingShot, size])

  useEffect(() => {
    if (!paused) return
    settleHome()
    setPlayingShot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  // Thinking sway.
  useEffect(() => {
    if (!thinking || paused || tracking || prefersReducedMotion()) return
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
        }
      } catch {
        // aborted
      }
    }

    void run()
    return () => {
      controller.abort()
      settleHome()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking, paused, tracking])

  // Typing: focused down + micro-blink.
  useEffect(() => {
    if (!typing || paused || tracking || prefersReducedMotion()) return
    const controller = new AbortController()
    const { signal } = controller

    const run = async () => {
      try {
        moveGaze(TYPE_GAZE, MS_THINK)
        while (!signal.aborted) {
          setEyeAct('base')
          await sleep(randBetween(500, 900), signal)
          setEyeAct('blink')
          await sleep(randBetween(140, 200), signal)
          setEyeAct('base')
          await sleep(randBetween(400, 700), signal)
        }
      } catch {
        // aborted
      }
    }

    void run()
    return () => {
      controller.abort()
      settleHome()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, paused, tracking])

  // Working: hold a soft focus gaze (chrome/CSS does the pulse).
  useEffect(() => {
    if (!working || paused || tracking || prefersReducedMotion()) return
    setThinkSide(null)
    moveGaze(WORK_GAZE, MS_THINK)
    return () => {
      settleHome()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, paused, tracking])

  // Pointer tracking — idle only; 28px+ (thread header + heroes).
  useEffect(() => {
    if (!allowTrack || size < 28 || prefersReducedMotion()) {
      if (trackingRef.current) {
        trackingRef.current = false
        setTracking(false)
      }
      return
    }

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
  }, [allowTrack, size])

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const eyePose = gazeEyePose(gaze)
  const noseLeft = gazeNostrilPose(gaze, 'left')
  const noseRight = gazeNostrilPose(gaze, 'right')
  const gazeTransition = {
    transitionDuration: `${gazeMs}ms`,
    transitionTimingFunction:
      gazeMs >= MS_SETTLE ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease',
  } as const
  const nostrilTransition = {
    transitionProperty: 'transform',
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

  const dataMotion = paused ? 'paused' : displayMotion
  const showChrome = !paused && !prefersReducedMotion()
  const showRing =
    showChrome && (displayMotion === 'working' || displayMotion === 'thinking' || displayMotion === 'typing')
  const showLoad =
    showChrome && (displayMotion === 'thinking' || displayMotion === 'typing')
  const showAlert = showChrome && displayMotion === 'alert'
  const showShotBody =
    displayMotion === 'yes' ||
    displayMotion === 'no' ||
    displayMotion === 'jump' ||
    displayMotion === 'alert'

  return (
    <span
      ref={rootRef}
      className={cn('bot-orb', paused && 'bot-orb--paused', className)}
      style={style}
      data-testid="bot-orb-avatar"
      data-shape={shapeKey}
      data-motion={dataMotion}
      data-pulse={pulseId || undefined}
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

        {/* Lottie-inspired chrome: outer ring + load arc + alert cross */}
        <g className="bot-orb__chrome" opacity={showChrome ? 1 : 0}>
          {showRing ? (
            <circle
              className="bot-orb__ring"
              cx="32"
              cy="32"
              r="30.5"
              fill="none"
              stroke="var(--bot-orb-color)"
              strokeWidth="1.4"
              strokeOpacity="0.45"
              strokeDasharray={displayMotion === 'thinking' ? '8 6' : displayMotion === 'typing' ? '4 10' : '48 12'}
            />
          ) : null}
          {showLoad ? (
            <circle
              className="bot-orb__load"
              cx="32"
              cy="32"
              r="30.5"
              fill="none"
              stroke="var(--bot-orb-color)"
              strokeWidth="2"
              strokeOpacity="0.75"
              strokeLinecap="round"
              strokeDasharray="14 180"
            />
          ) : null}
          {showAlert ? (
            <g className="bot-orb__alert-cross" stroke="var(--bot-orb-color)" strokeWidth="2.2" strokeLinecap="round">
              <line x1="24" y1="24" x2="40" y2="40" />
              <line x1="40" y1="24" x2="24" y2="40" />
            </g>
          ) : null}
        </g>

        <g
          className={cn(
            'bot-orb__body',
            showShotBody && `bot-orb__body--${displayMotion}`,
          )}
          style={{ transformOrigin: '32px 32px' }}
        >
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
          {/*
            Gaze wraps both features. faceY/faceScale only lift the eyes into
            the head — nostrils stay on the muzzle at path coordinates.
          */}
          <g
            className="bot-orb__gaze"
            style={{
              transform: `translate(${gaze.x}px, ${gaze.y}px)`,
              ...gazeTransition,
            }}
          >
            {def.detailLeft || def.detailRight || def.detailPath ? (
              <g className="bot-orb__nose">
                {def.detailLeft ? (
                  <path
                    className="bot-orb__nostril"
                    d={def.detailLeft}
                    fill="color-mix(in srgb, var(--bot-orb-color) 82%, #000)"
                    fillRule="nonzero"
                    style={{
                      transformOrigin: '29.2px 35.2px',
                      transform: `translate(${noseLeft.x - gaze.x}px, ${noseLeft.y - gaze.y}px) rotate(${noseLeft.tiltDeg}deg) scale(${noseLeft.scaleX}, ${noseLeft.scaleY})`,
                      ...nostrilTransition,
                    }}
                  />
                ) : null}
                {def.detailRight ? (
                  <path
                    className="bot-orb__nostril"
                    d={def.detailRight}
                    fill="color-mix(in srgb, var(--bot-orb-color) 82%, #000)"
                    fillRule="nonzero"
                    style={{
                      transformOrigin: '34.9px 35.2px',
                      transform: `translate(${noseRight.x - gaze.x}px, ${noseRight.y - gaze.y}px) rotate(${noseRight.tiltDeg}deg) scale(${noseRight.scaleX}, ${noseRight.scaleY})`,
                      ...nostrilTransition,
                    }}
                  />
                ) : null}
                {!def.detailLeft && !def.detailRight && def.detailPath ? (
                  <path
                    className="bot-orb__nostril"
                    d={def.detailPath}
                    fill="color-mix(in srgb, var(--bot-orb-color) 82%, #000)"
                    fillRule="nonzero"
                    style={{
                      transformOrigin: '32px 35.5px',
                      transform: `translate(${gaze.x * (NOSE_PARALLAX_X - 1)}px, ${gaze.y * (NOSE_PARALLAX_Y - 1)}px)`,
                      ...nostrilTransition,
                    }}
                  />
                ) : null}
              </g>
            ) : null}
            <g
              className="bot-orb__face"
              style={{
                transform: `translate(0px, ${faceY}px) scale(${faceScale})`,
                transformOrigin: '32px 30px',
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
