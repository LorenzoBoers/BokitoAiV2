import { Card } from '../ui/card'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Props = {
  /** Logo or icon tile, rendered at `md` size. */
  mark: ReactNode
  name: string
  /** One line under the name: connection count, "Module", endpoint. */
  meta: string
  onClick: () => void
  className?: string
}

/** Compact row card in the Connected strip of the Connections page. */
export function ConnectedTile({ mark, name, meta, onClick, className }: Props) {
  return (
    <Card asChild padding="compact">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'hover-lift flex min-w-0 items-center gap-3 text-left hover:border-border',
          className,
        )}
      >
        <span className="shrink-0">{mark}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-heading">{name}</span>
          <span className="block truncate text-2xs text-text-muted">{meta}</span>
        </span>
      </button>
    </Card>
  )
}
