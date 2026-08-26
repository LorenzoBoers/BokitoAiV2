import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CircleHelp, X } from 'lucide-react'
import {
  dismissPageGuide,
  isPageGuideDismissed,
  pageGuideDismissKey,
  pageGuidePath,
  type PageGuideSlug,
} from '../../lib/page-guides'
import { cn } from '../../lib/utils'

interface PageGuideBannerProps {
  page: PageGuideSlug
  /** Optional copy + dismiss key, e.g. `runs` on Communication. */
  variant?: string
  className?: string
}

function variantDismissed(page: PageGuideSlug, variant?: string): boolean {
  if (!variant) return isPageGuideDismissed(page)
  try {
    return localStorage.getItem(`${pageGuideDismissKey(page)}:${variant}`) === '1'
  } catch {
    return false
  }
}

function dismissVariant(page: PageGuideSlug, variant?: string): void {
  if (!variant) {
    dismissPageGuide(page)
    return
  }
  try {
    localStorage.setItem(`${pageGuideDismissKey(page)}:${variant}`, '1')
  } catch {
    // ignore storage failures
  }
}

/** Dismissible intro banner that links to the in-app explanation page. */
export function PageGuideBanner({ page, variant, className }: PageGuideBannerProps) {
  const { t } = useTranslation('nav')
  const [dismissed, setDismissed] = useState(() => variantDismissed(page, variant))

  if (dismissed) return null

  const titleKey = variant
    ? `pageGuides.${page}.${variant}BannerTitle`
    : `pageGuides.${page}.bannerTitle`
  const bodyKey = variant
    ? `pageGuides.${page}.${variant}BannerBody`
    : `pageGuides.${page}.bannerBody`

  return (
    <aside
      className={cn(
        'flex items-start gap-3 rounded-xl border border-accent/20 bg-accent/[0.06] px-3.5 py-3 animate-page-enter',
        className,
      )}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
        <CircleHelp size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text-heading">{t(titleKey)}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">
          {t(bodyKey)}
        </p>
        <Link
          to={pageGuidePath(page)}
          className="link-draw mt-1.5 inline-flex text-[12.5px] font-medium text-accent"
        >
          {t('pageGuides.learnMore')}
        </Link>
      </div>
      <button
        type="button"
        onClick={() => {
          dismissVariant(page, variant)
          setDismissed(true)
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-heading"
        aria-label={t('pageGuides.dismiss')}
      >
        <X size={14} aria-hidden />
      </button>
    </aside>
  )
}

export default PageGuideBanner
