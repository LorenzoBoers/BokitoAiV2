import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export type OsNodeKind =
  | 'orchestra'
  | 'blueprint'
  | 'project'
  | 'orchestrator'
  | 'assistant'
  | 'workstream'
  | 'repo'
  | 'source'
  | 'tool'
  | 'runs'
  | 'communication'

type NodeCardProps = {
  kind: OsNodeKind
  title: string
  subtitle?: string
  statusLabel?: string
  statusTone?: 'default' | 'active' | 'warning' | 'muted'
  icon: LucideIcon
  accentColor?: string
  onClick?: () => void
  className?: string
  'data-testid'?: string
}

const toneClass: Record<NonNullable<NodeCardProps['statusTone']>, string> = {
  default: 'border-border/50 bg-bg-elevated/80 text-text-secondary',
  active: 'border-status-success/25 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  muted: 'border-border/40 bg-bg-elevated/50 text-text-muted',
}

export default function NodeCard({
  kind,
  title,
  subtitle,
  statusLabel,
  statusTone = 'default',
  icon: Icon,
  accentColor = '#6366f1',
  onClick,
  className,
  'data-testid': testId,
}: NodeCardProps) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      data-testid={testId}
      data-node-kind={kind}
      className={cn(
        'group relative flex h-full w-[200px] flex-col overflow-hidden rounded-2xl border border-border/45 p-3 text-left',
        'bg-gradient-to-b from-bg-surface/95 via-bg-surface/90 to-bg-elevated/75',
        'shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_14px_36px_-22px_rgba(0,0,0,0.65)]',
        'backdrop-blur-[2px] transition-all duration-200',
        onClick &&
          'cursor-pointer hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_0_0_1px_rgba(var(--color-accent),0.18),0_20px_44px_-18px_rgba(var(--color-accent),0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      style={
        onClick
          ? ({ ['--node-accent' as string]: accentColor } as CSSProperties)
          : undefined
      }
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"
        aria-hidden
      />
      <span
        className="absolute left-0 top-3 h-9 w-1 rounded-r-full transition-shadow duration-200 group-hover:shadow-[0_0_12px_1px_var(--node-accent,#6366f1)]"
        style={{ backgroundColor: accentColor }}
      />
      <div className="flex items-start gap-2.5 pl-2.5">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-bg-root/50"
          style={{ boxShadow: `0 0 18px -8px ${accentColor}` }}
        >
          <Icon size={16} className="text-text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-text-heading">{title}</p>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {statusLabel ? (
        <span
          className={cn(
            'mt-2.5 ml-2.5 inline-flex w-fit rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            toneClass[statusTone],
          )}
        >
          {statusLabel}
        </span>
      ) : null}
    </Tag>
  )
}
