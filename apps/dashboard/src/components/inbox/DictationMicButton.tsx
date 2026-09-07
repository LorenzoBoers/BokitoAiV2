/**
 * Mic control for Whisperflow-style dictation: click to toggle, hold to talk.
 * Visual language matches the chat-widget listening control (bordered idle,
 * green glow + shared wave bars while listening, check on hover).
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Mic } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SPEECH_WAVE_BARS } from '@bokito/shared'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'

const HOLD_MS = 280

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

function DictationWave({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4', className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      {SPEECH_WAVE_BARS.map((bar, i) => (
        <rect
          key={i}
          className="dictation-wave-bar"
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={1.5}
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </svg>
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={listening}
          aria-label={label}
          onPointerDown={onPointerDown}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          className={cn(
            'group relative flex shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-40',
            dim,
            listening
              ? 'border-status-success bg-status-success text-white shadow-[0_0_0_3px_rgb(var(--color-status-success)/0.22)] hover:bg-[rgb(21_128_61)]'
              : 'border-border/60 bg-bg-surface text-text-muted hover:border-accent/50 hover:text-accent',
            className,
          )}
        >
          {listening ? (
            <>
              <DictationWave className="transition-opacity group-hover:opacity-0" />
              <Check
                size={size === 'sm' ? 13 : 14}
                strokeWidth={2.5}
                className="pointer-events-none absolute opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </>
          ) : (
            <Mic size={size === 'sm' ? 13 : 14} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-center">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}
