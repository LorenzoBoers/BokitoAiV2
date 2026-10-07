import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { BrandTile } from '../integrations/BrandMark'
import { Badge, type BadgeTone } from '../ui/badge'

export type ProviderRowTone = 'connected' | 'available' | 'muted'

const TONE: Record<ProviderRowTone, BadgeTone> = {
  connected: 'success',
  available: 'accent',
  muted: 'neutral',
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
      className="panel group open:border-border-light"
      data-testid={testId}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <BrandTile slug={brand} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-heading">{name}</p>
          <p className="truncate-fade text-xs text-text-muted">{description}</p>
        </div>
        <Badge variant={TONE[tone]}>{status}</Badge>
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
