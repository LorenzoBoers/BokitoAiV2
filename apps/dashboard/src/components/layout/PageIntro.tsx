import type { ReactNode } from 'react'
import type { PageGuideSlug } from '../../lib/page-guides'
import { cn } from '../../lib/utils'
import { PageGuideLink } from './PageGuideLink'

interface PageIntroProps {
  description?: ReactNode
  actions?: ReactNode
  /** Page-guide slug: adds a quiet "Learn more" link to the actions. */
  guide?: PageGuideSlug
  className?: string
}

/**
 * Subtitle row that appears below the shell breadcrumb. Never renders an
 * `<h1>` — the page title lives in the topbar (driven by portal-nav meta).
 * Use this for a description + primary action pair only.
 */
export function PageIntro({ description, actions, guide, className }: PageIntroProps) {
  if (!description && !actions && !guide) return null
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
      {actions || guide ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {guide ? <PageGuideLink page={guide} /> : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}

export default PageIntro
