import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'

const TONE = {
  info: { box: 'border-status-info/25 bg-status-info/[0.07]', ink: 'text-status-info', Icon: Info },
  success: { box: 'border-status-success/25 bg-status-success/[0.07]', ink: 'text-status-success', Icon: CheckCircle2 },
  warning: { box: 'border-status-warning/30 bg-status-warning/[0.08]', ink: 'text-status-warning', Icon: AlertTriangle },
  error: { box: 'border-status-error/30 bg-status-error/[0.08]', ink: 'text-status-error', Icon: OctagonAlert },
  ai: { box: 'border-ai/25 bg-ai/[0.07]', ink: 'text-ai-ink', Icon: Sparkles },
  neutral: { box: 'border-border/60 bg-bg-elevated', ink: 'text-text-muted', Icon: Info },
} as const

export type CalloutTone = keyof typeof TONE

type CalloutProps = {
  tone?: CalloutTone
  title?: ReactNode
  children?: ReactNode
  /** Right-aligned or trailing actions (Button size="sm", TextLink). */
  actions?: ReactNode
  /** Hide the leading icon. */
  bare?: boolean
  className?: string
  role?: 'alert' | 'status'
}

/** Inline banner for status, warnings and errors inside a page or card. */
export function Callout({
  tone = 'info',
  title,
  children,
  actions,
  bare = false,
  className,
  role,
}: CalloutProps) {
  const { box, ink, Icon } = TONE[tone]
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : undefined)}
      className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', box, className)}
    >
      {bare ? null : <Icon size={15} className={cn('mt-0.5 shrink-0', ink)} aria-hidden />}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className={cn('font-medium', tone === 'neutral' ? 'text-text-heading' : ink)}>{title}</p> : null}
        {children ? <div className="text-xs leading-5 text-text-secondary">{children}</div> : null}
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div> : null}
      </div>
    </div>
  )
}

export default Callout
