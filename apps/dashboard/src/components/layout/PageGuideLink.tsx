import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CircleHelp } from 'lucide-react'
import { pageGuidePath, type PageGuideSlug } from '../../lib/page-guides'
import { cn } from '../../lib/utils'
import { Tip } from '../ui/Tip'

interface PageGuideLinkProps {
  page: PageGuideSlug
  /** Optional copy variant, e.g. `runs` on Communication. */
  variant?: string
  /** Icon-only (section headers) or icon + label (page headers). */
  compact?: boolean
  className?: string
}

/**
 * Quiet link to the in-app explanation for this page. Replaces the old
 * full-width intro banner: the one-line summary becomes the tooltip.
 */
export function PageGuideLink({ page, variant, compact = false, className }: PageGuideLinkProps) {
  const { t } = useTranslation('nav')
  const titleKey = variant ? `pageGuides.${page}.${variant}BannerTitle` : `pageGuides.${page}.bannerTitle`
  const title = t(titleKey)
  const label = t('pageGuides.learnMore')
  return (
    <Tip label={title} className="max-w-64 font-normal">
      <Link
        to={pageGuidePath(page)}
        aria-label={compact ? `${label}. ${title}` : undefined}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md text-xs text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-heading',
          compact ? 'w-7 justify-center' : 'px-2',
          className,
        )}
      >
        <CircleHelp size={13} aria-hidden />
        {compact ? null : <span>{label}</span>}
      </Link>
    </Tip>
  )
}

export default PageGuideLink
