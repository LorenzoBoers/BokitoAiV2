import type { ReactNode } from 'react'
import type { PageGuideSlug } from '../../lib/page-guides'
import { PageGuideLink } from '../layout/PageGuideLink'
import { cn } from '../../lib/utils'

type ContentHeaderProps = {
  title: string
  subtitle?: ReactNode
  /** Right-aligned controls (buttons, pills, filters). */
  meta?: ReactNode
  /** Page-guide slug: renders a quiet "Learn more" link next to the controls. */
  guide?: PageGuideSlug
  className?: string
}

/** Page header: compact title + one-line subtitle left, guide link and controls right. */
export default function ContentHeader({ title, subtitle, meta, guide, className }: ContentHeaderProps) {
  return (
    <section className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight tracking-[-0.01em] text-text-heading">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p> : null}
      </div>
      {meta || guide ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {guide ? <PageGuideLink page={guide} compact={Boolean(meta)} /> : null}
          {meta}
        </div>
      ) : null}
    </section>
  )
}
