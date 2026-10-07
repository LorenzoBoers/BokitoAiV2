import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type SectionHeadingProps = {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned actions (button, link, count). */
  actions?: ReactNode
  /** `label` = small muted group label, `title` = section title. */
  level?: 'label' | 'title'
  className?: string
}

/** Heading for a group of content inside a page or card. */
export function SectionHeading({
  title,
  description,
  actions,
  level = 'title',
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {level === 'label' ? (
          <p className="text-xs font-medium text-text-muted">{title}</p>
        ) : (
          <h3 className="text-sm font-semibold text-text-heading">{title}</h3>
        )}
        {description ? <p className="mt-0.5 text-xs text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export default SectionHeading
