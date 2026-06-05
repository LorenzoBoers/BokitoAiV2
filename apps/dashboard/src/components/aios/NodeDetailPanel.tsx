import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, X, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export type PanelStatusTone = 'default' | 'active' | 'warning' | 'muted'

export type PanelAction = {
  id: string
  label: string
  to?: string
  onClick?: () => void
  variant?: 'primary' | 'outline' | 'ghost'
  icon?: LucideIcon
  external?: boolean
}

export type PanelRow = {
  label: string
  value: ReactNode
}

export type PanelListItem = {
  id: string
  title: string
  subtitle?: string
  statusLabel?: string
  statusTone?: PanelStatusTone
  to?: string
  onClick?: () => void
}

export type NodeDetailPanelProps = {
  open: boolean
  onClose: () => void
  icon: LucideIcon
  accentColor?: string
  title: string
  subtitle?: string
  statusLabel?: string
  statusTone?: PanelStatusTone
  description?: string
  rows?: PanelRow[]
  list?: { heading: string; items: PanelListItem[]; emptyLabel: string }
  actions?: PanelAction[]
  children?: ReactNode
}

const toneClass: Record<PanelStatusTone, string> = {
  default: 'border-border/50 bg-bg-elevated/80 text-text-secondary',
  active: 'border-status-success/25 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  muted: 'border-border/40 bg-bg-elevated/50 text-text-muted',
}

function StatusBadge({ label, tone = 'default' }: { label: string; tone?: PanelStatusTone }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        toneClass[tone],
      )}
    >
      {label}
    </span>
  )
}

export default function NodeDetailPanel({
  open,
  onClose,
  icon: Icon,
  accentColor = '#6366f1',
  title,
  subtitle,
  statusLabel,
  statusTone = 'default',
  description,
  rows,
  list,
  actions,
  children,
}: NodeDetailPanelProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-0 z-50 transition-opacity duration-200',
        open ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity duration-200',
          open ? 'pointer-events-auto opacity-100' : 'opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-label={title}
        className={cn(
          'absolute inset-y-0 right-0 flex w-[380px] max-w-[88%] flex-col border-l border-border/60 bg-bg-surface shadow-[0_30px_70px_-35px_rgba(0,0,0,0.75)] transition-transform duration-200 ease-out',
          open ? 'pointer-events-auto translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start gap-3 border-b border-border/50 px-4 py-3.5">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-bg-root/50"
            style={{ boxShadow: `0 0 18px -8px ${accentColor}` }}
          >
            <Icon size={17} className="text-text-secondary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-heading">{title}</p>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-text-muted">{subtitle}</p> : null}
            {statusLabel ? (
              <div className="mt-1.5">
                <StatusBadge label={statusLabel} tone={statusTone} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border/60 bg-bg-elevated p-1.5 text-text-muted transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={15} />
            <span className="sr-only">Close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {description ? <p className="text-sm leading-relaxed text-text-secondary">{description}</p> : null}

          {rows && rows.length > 0 ? (
            <dl className="space-y-2 rounded-xl border border-border/45 bg-bg-elevated/40 p-3">
              {rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-text-muted">{row.label}</dt>
                  <dd className="min-w-0 truncate text-right text-sm font-medium text-text-heading">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {list ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{list.heading}</p>
              {list.items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-xs text-text-muted">
                  {list.emptyLabel}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {list.items.map((item) => {
                    const inner = (
                      <div className="flex items-center gap-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-heading">{item.title}</p>
                          {item.subtitle ? (
                            <p className="truncate text-xs text-text-muted">{item.subtitle}</p>
                          ) : null}
                        </div>
                        {item.statusLabel ? (
                          <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                        ) : null}
                      </div>
                    )
                    const className =
                      'block rounded-lg border border-border/45 bg-bg-elevated/40 px-3 py-2 text-left transition-colors hover:border-border/70 hover:bg-bg-hover/50'
                    if (item.to) {
                      return (
                        <Link key={item.id} to={item.to} className={className}>
                          {inner}
                        </Link>
                      )
                    }
                    return (
                      <button key={item.id} type="button" onClick={item.onClick} className={cn('w-full', className)}>
                        {inner}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}

          {children}
        </div>

        {actions && actions.length > 0 ? (
          <footer className="flex flex-col gap-2 border-t border-border/50 px-4 py-3">
            {actions.map((action) => {
              const base =
                'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
              const variantClass =
                action.variant === 'primary' || !action.variant
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : action.variant === 'outline'
                    ? 'border border-border/70 text-text-primary hover:bg-bg-hover/60'
                    : 'text-text-secondary hover:bg-bg-hover/50'
              const ActionIcon = action.icon ?? (action.to && action.external ? ArrowUpRight : undefined)
              const content = (
                <>
                  {ActionIcon ? <ActionIcon size={15} /> : null}
                  {action.label}
                </>
              )
              if (action.to) {
                if (action.external) {
                  return (
                    <a
                      key={action.id}
                      href={action.to}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={cn(base, variantClass)}
                    >
                      {content}
                    </a>
                  )
                }
                return (
                  <Link key={action.id} to={action.to} className={cn(base, variantClass)}>
                    {content}
                  </Link>
                )
              }
              return (
                <button key={action.id} type="button" onClick={action.onClick} className={cn(base, variantClass)}>
                  {content}
                </button>
              )
            })}
          </footer>
        ) : null}
      </aside>
    </div>
  )
}
