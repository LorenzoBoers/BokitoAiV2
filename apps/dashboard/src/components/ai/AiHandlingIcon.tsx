import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_HANDLING_META, type AiHandlingMode } from '../../lib/ai-handling'
import { cn } from '../../lib/utils'

/** The one icon per AI handling mode: A in refresh arrows, grey+violet handshake, Hand. All stroke 2. */
export function AiHandlingIcon({
  mode,
  size = 14,
  className,
  title,
}: {
  mode: AiHandlingMode
  size?: number
  className?: string
  /** Accessible label; defaults to the mode name. */
  title?: string
}) {
  const { t } = useTranslation('common')
  const meta = AI_HANDLING_META[mode]
  const Icon = meta.icon
  const label = title ?? t(`aiHandling.modes.${mode}.label`)
  return (
    <Icon
      size={size}
      strokeWidth={2}
      className={cn('shrink-0', meta.iconClass || undefined, className)}
      aria-label={label}
      role="img"
      data-ai-handling={mode}
    />
  )
}

/** Icon + mode name in a small pill (timeline, lists, settings exceptions). */
export function AiHandlingPill({
  mode,
  className,
  children,
}: {
  mode: AiHandlingMode
  className?: string
  children?: ReactNode
}) {
  const { t } = useTranslation('common')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-4',
        AI_HANDLING_META[mode].surfaceClass,
        className,
      )}
    >
      <AiHandlingIcon mode={mode} size={10} />
      {children ?? t(`aiHandling.modes.${mode}.label`)}
    </span>
  )
}
