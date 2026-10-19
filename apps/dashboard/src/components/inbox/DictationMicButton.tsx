/**
 * Mic control for dictation: click to toggle, hold to talk.
 * Idle is a plain icon. While listening, the button shows a gray microphone
 * with an accent-green check circle (confirm keeps the text). Send (outside
 * this button) sends what was heard.
 * DictationLevelMeter, drawn to the left, follows the live microphone.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Mic } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

const HOLD_MS = 280
const LEVEL_BARS = 12

/** Stop-recording mark: gray mic, accent circle, white check. */
function DictationConfirmIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 268 268" fill="none" aria-hidden>
      <path
        d="M134 22.3325C125.115 22.3325 116.594 25.862 110.312 32.1444C104.029 38.4269 100.5 46.9478 100.5 55.8325V133.999C100.5 142.884 104.029 151.405 110.312 157.687C116.594 163.97 125.115 167.499 134 167.499C142.885 167.499 151.406 163.97 157.688 157.687C163.971 151.405 167.5 142.884 167.5 133.999V55.8325C167.5 46.9478 163.971 38.4269 157.688 32.1444C151.406 25.862 142.885 22.3325 134 22.3325Z"
        stroke="currentColor"
        strokeWidth="22.3333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M212.166 111.667V134.001C212.166 154.732 203.931 174.614 189.272 189.273C174.613 203.932 154.731 212.167 134 212.167C113.269 212.167 93.3867 203.932 78.7276 189.273C64.0685 174.614 55.8331 154.732 55.8331 134.001V111.667"
        stroke="currentColor"
        strokeWidth="22.3333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M134 212.167V245.667"
        stroke="currentColor"
        strokeWidth="22.3333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="190.5" cy="77.5" r="56.5" className="fill-accent" />
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

/**
 * Live microphone level, left of the confirm control.
 * A second capture (analyser only) so the bars move when the mic hears sound.
 * Nothing is recorded or uploaded from this stream.
 */
export function DictationLevelMeter({ className }: { className?: string }) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null

    const paint = (scales: number[]) => {
      scales.forEach((scale, i) => {
        const el = barsRef.current[i]
        if (el) el.style.transform = `scaleY(${scale})`
      })
    }

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
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const scales: number[] = []
        const start = 2
        const end = 18
        const span = end - start
        for (let i = 0; i < LEVEL_BARS; i++) {
          const from = start + Math.floor((i * span) / LEVEL_BARS)
          const to = start + Math.floor(((i + 1) * span) / LEVEL_BARS)
          let peak = 0
          for (let j = from; j < to; j++) peak = Math.max(peak, data[j] ?? 0)
          const norm = Math.min(1, Math.max(0, peak - 18) / 140)
          scales.push(0.34 + norm * 0.66)
        }
        paint(scales)
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
    <span
      className={cn('flex h-8 w-24 shrink-0 items-center justify-between px-0.5', className)}
      aria-hidden
    >
      {Array.from({ length: LEVEL_BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="h-4 w-0.5 origin-center rounded-full bg-status-success"
          style={{ transform: 'scaleY(0.34)' }}
        />
      ))}
    </span>
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
        'text-text-muted hover:bg-bg-hover hover:text-text-primary',
        className,
      )}
    >
      {listening ? (
        <DictationConfirmIcon size={size === 'sm' ? 16 : 18} />
      ) : (
        <Mic size={size === 'sm' ? 13 : 14} />
      )}
    </button>
  )
}
