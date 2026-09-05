/**
 * Mic control for Whisperflow-style dictation: click to toggle, hold to talk,
 * green check while listening so "confirm" is obvious (not MicOff).
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Mic } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
}

export function DictationMicButton({
  listening,
  disabled,
  onStart,
  onConfirm,
  className,
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
    // Hold-to-talk: release after a real hold confirms.
    if (heldFor >= HOLD_MS) {
      onConfirm()
      return
    }
    // Short click: if already listening before press, confirm; otherwise leave on (toggle start).
    if (wasListening) onConfirm()
  }

  const label = listening ? t('composer.dictationConfirm') : t('composer.dictationStart')
  const tip = listening ? t('composer.dictationConfirmHint') : t('composer.dictationHoldHint')

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
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40',
            listening
              ? 'bg-status-success text-white shadow-sm ring-1 ring-status-success/40 hover:bg-status-success/90'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
            className,
          )}
        >
          {listening ? <Check size={14} strokeWidth={2.5} /> : <Mic size={14} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-center">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}
