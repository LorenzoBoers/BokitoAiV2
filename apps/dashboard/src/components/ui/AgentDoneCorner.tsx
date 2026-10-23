import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Tip } from './Tip'

/**
 * Small purple check on static "agent was here" thread marks — message settled.
 * When `enter` is set (live → static), the badge pops in.
 */
export function AgentDoneCorner({
  size,
  enter = false,
}: {
  size: number
  /** Animate in after the live seat just left this mark. */
  enter?: boolean
}) {
  const { t } = useTranslation('communication')
  const badge = Math.max(10, Math.round(size * 0.38))
  const icon = Math.max(7, Math.round(badge * 0.62))
  const label = t('timeline.agentDoneMark')
  return (
    <Tip label={label}>
      <span
        style={{ width: badge, height: badge }}
        className={cn(
          'absolute -bottom-px -right-px z-10 inline-flex items-center justify-center rounded-full',
          'bg-ai text-ai-fg ring-2 ring-cutout',
          enter && 'agent-done-corner--enter',
        )}
        aria-hidden
      >
        <Check size={icon} />
        <span className="sr-only">{label}</span>
      </span>
    </Tip>
  )
}
