import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { BrandTile } from '../integrations/BrandMark'
import { cn } from '../../lib/utils'

export type ProviderRowTone = 'connected' | 'available' | 'muted'

const TONE_CLASSES: Record<ProviderRowTone, string> = {
  connected: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  available: 'bg-accent/10 text-accent',
  muted: 'bg-bg-surface-hover text-text-muted',
}

type Props = {
  brand: string
  name: string
  description: string
  status: string
  tone: ProviderRowTone
  children: ReactNode
  testId?: string
}

/** One collapsible provider row: logo, name, status; setup details inside. */
export function AiToolProviderRow({ brand, name, description, status, tone, children, testId }: Props) {
  return (
    <details
      className="group rounded-lg border border-border/60 bg-bg-surface open:border-border-light"
      data-testid={testId}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <BrandTile slug={brand} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-heading">{name}</p>
          <p className="truncate-fade text-xs text-text-muted">{description}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium', TONE_CLASSES[tone])}>
          {status}
        </span>
        <ChevronDown
          size={15}
          className="shrink-0 text-text-muted transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-3 border-t border-border/50 px-4 py-4">{children}</div>
    </details>
  )
}
