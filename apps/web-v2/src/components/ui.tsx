/** Small shared primitives. Keep this file boring: layout, badges, dialogs, empty states. */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/cn'

export function PageHeader({
  title,
  intro,
  actions,
  className,
}: {
  title: string
  intro?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4', className)}>
      <div>
        <h1 className="text-base font-semibold text-text-heading">{title}</h1>
        {intro && <p className="mt-0.5 text-xs text-text-muted">{intro}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex h-full flex-col animate-page-enter', className)}>{children}</div>
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('panel p-4', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-text-heading">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

const TONES = {
  neutral: 'border-border/60 bg-bg-elevated text-text-secondary',
  accent: 'border-accent/40 bg-accent/10 text-accent-ink',
  ai: 'border-ai/40 bg-ai/10 text-ai-ink',
  success: 'border-status-success/40 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/40 bg-status-error/10 text-status-error',
  info: 'border-status-info/40 bg-status-info/10 text-status-info',
} as const

export type Tone = keyof typeof TONES

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'open':
    case 'active':
    case 'done':
    case 'applied':
    case 'approved':
    case 'sent':
    case 'delivered':
      return 'success'
    case 'waiting':
    case 'queued':
    case 'pending':
    case 'draft':
    case 'snoozed':
      return 'warning'
    case 'failed':
    case 'error':
    case 'rejected':
    case 'denied':
      return 'error'
    case 'running':
      return 'info'
    case 'closed':
    case 'cancelled':
    case 'rolled_back':
    case 'disabled':
    case 'expired':
    default:
      return 'neutral'
  }
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-text-muted', className)} />
}

export function Empty({ title, hint, action }: { title?: string; hint?: string; action?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm text-text-secondary">{title ?? t('common.empty')}</p>
      {hint && <p className="max-w-sm text-xs text-text-muted">{hint}</p>}
      {action}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner />
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const message = error instanceof Error ? error.message : String(error)
  return <p className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">{message || t('common.error')}</p>
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 animate-fade-in" />
        <DialogPrimitive.Content
          className={cn(
            'panel fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto p-5 shadow-overlay animate-dialog-in',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold text-text-heading">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-text-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="btn-ghost -mr-2 -mt-1 h-8 w-8 p-0" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Drawer({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/60 bg-bg-surface shadow-overlay animate-slide-in-left">
          <div className="flex h-14 items-center justify-between border-b border-border/60 px-4">
            <DialogPrimitive.Title className="text-sm font-semibold text-text-heading">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            <DialogPrimitive.Close className="btn-ghost h-8 w-8 p-0" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-auto p-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Tabs({
  value,
  onValueChange,
  items,
  children,
  className,
}: {
  value: string
  onValueChange: (v: string) => void
  items: Array<{ value: string; label: string; count?: number }>
  children: ReactNode
  className?: string
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <TabsPrimitive.List className="flex gap-1 border-b border-border/60 px-6">
        {items.map((it) => (
          <TabsPrimitive.Trigger
            key={it.value}
            value={it.value}
            className="-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-2 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary data-[state=active]:border-accent data-[state=active]:text-text-heading"
          >
            {it.label}
            {it.count !== undefined && <span className="chip">{it.count}</span>}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}

export const TabPanel = TabsPrimitive.Content

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block text-xs text-text-secondary', className)}>
      <span className="font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-2xs text-text-muted">{hint}</span>}
    </label>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="panel p-4">
      <div className="text-2xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold text-text-heading', tone === 'success' && 'text-status-success')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-text-muted">{hint}</div>}
    </div>
  )
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-text-primary">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Avatar({ name, className, tone = 'neutral' }: { name: string; className?: string; tone?: 'neutral' | 'ai' | 'accent' }) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const text = parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') : '?'
  return (
    <span
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
        tone === 'ai' && 'bg-ai/15 text-ai-ink',
        tone === 'accent' && 'bg-accent/15 text-accent-ink',
        tone === 'neutral' && 'bg-bg-elevated text-text-secondary',
        className,
      )}
    >
      {text}
    </span>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-border bg-bg-elevated',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  )
}
