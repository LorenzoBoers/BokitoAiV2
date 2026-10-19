/**
 * Mic control for dictation: click to toggle, hold to talk.
 * Idle is a plain icon. While listening, the button shows a gray microphone
 * with a green check circle (confirm keeps the text). Send (outside
 * this button) sends what was heard.
 * DictationLevelMeter, drawn to the left, scrolls a frozen wave right to left.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Mic } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

const HOLD_MS = 280
const WAVE_GREEN = 'rgb(var(--color-status-success))'
const WAVE_WIDTH = 144
const WAVE_HEIGHT = 32
const WAVE_SAMPLES = 48
/** Samples advanced per frame. A crest crosses the strip in about 4s. */
const WAVE_SCROLL = 0.2
/** Two and a half waves across the strip. Phase is locked to the scroll. */
const WAVE_CYCLES = 2.5
const WAVE_PHASE_STEP = (WAVE_CYCLES * Math.PI * 2) / WAVE_SAMPLES

/** Stop-recording mark: gray mic, accent circle, white check. */
function DictationConfirmIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 268 268" fill="none" aria-hidden>
      <path
        d="M134 22.3325C125.115 22.3325 116.594 25.862 110.312 32.1444C104.029 38.4269 100.5 46.9478 100.5 55.8325V133.999C100.5 142.884 104.029 151.405 110.312 157.687C116.594 163.97 125.115 167.499 134 167.499C142.885 167.499 151.406 163.97 157.688 157.687C163.971 151.405 167.5 142.884 167.5 133.999V55.8325C167.5 46.9478 163.971 38.4269 157.688 32.1444C151.406 25.862 142.885 22.3325 134 22.3325Z"
        stroke="rgb(var(--color-text-muted))"
        strokeWidth="22.3333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M212.166 111.667V134.001C212.166 154.732 203.931 174.614 189.272 189.273C174.613 203.932 154.731 212.167 134 212.167C113.269 212.167 93.3867 203.932 78.7276 189.273C64.0685 174.614 55.8331 154.732 55.8331 134.001V111.667"
        stroke="rgb(var(--color-text-muted))"
        strokeWidth="22.3333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M134 212.167V245.667"
        stroke="rgb(var(--color-text-muted))"
        strokeWidth="22.3333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="190.5" cy="77.5" r="56.5" fill={WAVE_GREEN} />
      <path
        d="M166.691 78.1113L184.01 95.4301M215.759 64.3262L184.846 95.2394"
        stroke="white"
        strokeWidth="15.2107"
        strokeLinecap="round"
      />
    </svg>
  )
}

type Props = {
  listening: boolean
  disabled?: boolean
  onStart: () => void
  /** Stop listening and commit any interim text. */
  onConfirm: () => void
  className?: string
  /** Compact size for nested panels (e.g. Write assist). */
  size?: 'sm' | 'md'
}

/** Smooth curve through samples. Ends stay on the calls that pin them. */
function wavePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2
    const yc = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${xc.toFixed(2)} ${yc.toFixed(2)}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`
  return d
}

/**
 * Live microphone level, left of the confirm control.
 * A slow wave is written on the right and scrolls left, frozen as it goes.
 * Loudness sets the wave height, not a lift off the center line. Each half
 * wave (180 degrees) shares one height: the average level while that half
 * was drawn. The left edge fades to the baseline. A second capture (analyser
 * only) drives it.
 * Nothing is recorded or uploaded.
 */
export function DictationLevelMeter({ className }: { className?: string }) {
  const pathRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
      } catch {
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        stream.getTracks().forEach((track) => track.stop())
        stream = null
        return
      }
      ctx = new Ctor()
      void ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.15
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const history = new Float32Array(WAVE_SAMPLES)
      const halfOf = new Int16Array(WAVE_SAMPLES)
      const halfAmp = new Map<number, number>()
      let head = 0
      let pending = 0
      let phase = 0
      let level = 0
      let halfId = 0
      let halfSum = 0
      let halfCount = 0
      let noise = 0.03
      const mid = WAVE_HEIGHT / 2
      const amp = 13
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        // The floor follows this mic's silence. A slightly higher gate keeps
        // room noise off the line. Above that, a curve keeps soft speech
        // lower than loud speech.
        noise += (rms - noise) * (rms <= noise ? 0.08 : 0.004)
        noise = Math.max(0.0015, noise)
        const above = Math.max(0, rms - noise * 1.6)
        const norm = above / Math.max(0.012, noise * 1.5)
        const target = Math.min(1, Math.pow(norm, 1.6))
        const follow = target > level ? 0.85 : 0.4
        level += (target - level) * follow
        halfSum += level
        halfCount += 1
        halfAmp.set(halfId, halfSum / halfCount)
        pending += WAVE_SCROLL
        const steps = Math.min(WAVE_SAMPLES, Math.floor(pending))
        pending -= steps
        for (let s = 0; s < steps; s++) {
          phase += WAVE_PHASE_STEP
          const nextHalf = Math.floor(phase / Math.PI)
          if (nextHalf !== halfId) {
            halfId = nextHalf
            halfSum = level
            halfCount = 1
            halfAmp.set(halfId, level)
            if (halfAmp.size > 12) {
              const keep = halfId - 8
              for (const key of halfAmp.keys()) {
                if (key < keep) halfAmp.delete(key)
              }
            }
          }
          history[head] = Math.sin(phase)
          halfOf[head] = halfId
          head = (head + 1) % WAVE_SAMPLES
        }
        const points: Array<{ x: number; y: number }> = []
        for (let i = 0; i < WAVE_SAMPLES; i++) {
          const t = (i - pending) / (WAVE_SAMPLES - 1)
          if (t < 0) continue
          const fade = t < 0.14 ? Math.sin((t / 0.14) * (Math.PI / 2)) : 1
          const at = (head + i) % WAVE_SAMPLES
          const sample = history[at] * (halfAmp.get(halfOf[at]) ?? 0)
          points.push({
            x: t * WAVE_WIDTH,
            y: mid - sample * amp * fade,
          })
        }
        const tipPhase = phase + pending * WAVE_PHASE_STEP
        const tipHalf = Math.floor(tipPhase / Math.PI)
        const tipLevel = halfAmp.get(tipHalf) ?? (halfCount ? halfSum / halfCount : 0)
        const tip = Math.sin(tipPhase) * tipLevel
        points.push({ x: WAVE_WIDTH, y: mid - tip * amp })
        pathRef.current?.setAttribute('d', wavePath(points))
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((track) => track.stop())
      void ctx?.close()
    }
  }, [])

  return (
    <svg
      viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
      className={cn('h-8 w-36 shrink-0', className)}
      aria-hidden
    >
      <path
        ref={pathRef}
        d={`M 0 ${WAVE_HEIGHT / 2} L ${WAVE_WIDTH} ${WAVE_HEIGHT / 2}`}
        fill="none"
        stroke={WAVE_GREEN}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Mic and send share one row in every composer. The meter only inserts on the
 * left, so the gap between the record button and send stays put.
 */
export function ComposerDictationRow({
  supported,
  listening,
  disabled,
  onStart,
  onConfirm,
  children,
}: {
  supported: boolean
  listening: boolean
  disabled?: boolean
  onStart: () => void
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5">
      {supported && listening ? <DictationLevelMeter /> : null}
      {supported ? (
        <DictationMicButton
          listening={listening}
          disabled={disabled}
          onStart={onStart}
          onConfirm={onConfirm}
        />
      ) : null}
      {children}
    </div>
  )
}

export function DictationMicButton({
  listening,
  disabled,
  onStart,
  onConfirm,
  className,
  size = 'md',
}: Props) {
  const { t } = useTranslation('communication')
  const holdRef = useRef<{
    pointerId: number | null
    startedAt: number
    wasListening: boolean
  }>({ pointerId: null, startedAt: 0, wasListening: false })

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    holdRef.current = {
      pointerId: event.pointerId,
      startedAt: Date.now(),
      wasListening: listening,
    }
    if (!listening) onStart()
  }

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdRef.current.pointerId !== event.pointerId) return
    const heldFor = Date.now() - holdRef.current.startedAt
    const wasListening = holdRef.current.wasListening
    holdRef.current.pointerId = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // already released
    }
    if (heldFor >= HOLD_MS) {
      onConfirm()
      return
    }
    if (wasListening) onConfirm()
  }

  const label = listening ? t('composer.dictationConfirm') : t('composer.dictationStart')
  const tip = listening ? t('composer.dictationConfirmHint') : t('composer.dictationHoldHint')
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'

  // Native title only — no Radix Tooltip. Agent chat is a lazy route chunk;
  // a Tooltip here previously crashed the whole page when Provider context
  // did not match across chunks.
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={listening}
      aria-label={label}
      title={tip}
      onPointerDown={onPointerDown}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        dim,
        listening
          ? 'text-text-muted hover:bg-bg-hover'
          : 'text-text-primary hover:bg-bg-hover hover:text-text-heading',
        className,
      )}
    >
      {listening ? (
        <DictationConfirmIcon size={size === 'sm' ? 16 : 18} />
      ) : (
        <Mic size={size === 'sm' ? 16 : 18} />
      )}
    </button>
  )
}
