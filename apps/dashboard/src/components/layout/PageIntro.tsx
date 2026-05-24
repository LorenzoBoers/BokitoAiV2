import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface PageIntroProps {
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Subtitle row that appears below `AppHeader`. Never renders an `<h1>` —
 * the page title lives in `AppHeader` (driven by portal-nav meta). Use this
 * for a description + primary action pair only.
 */
export function PageIntro({ description, actions, className }: PageIntroProps) {
  if (!description && !actions) return null
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      {description ? (
        <p className="max-w-2xl text-sm text-text-secondary">{description}</p>
      ) : (
        <span aria-hidden />
      )}
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

export default PageIntro
