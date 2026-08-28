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
        'flex items-center gap-2.5 rounded-lg border border-accent/20 bg-accent/[0.06] px-3 py-2 animate-page-enter',
        className,
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/12 text-accent">
        <CircleHelp size={13} aria-hidden />
      </span>
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-text-heading">
        <span className="font-medium">{t(titleKey)}</span>
        <Link
          to={pageGuidePath(page)}
          className="ml-2 font-medium text-accent hover:underline"
        >
          {t('pageGuides.learnMore')}
        </Link>
      </p>
      <span className="sr-only">{t(bodyKey)}</span>
      <button
        type="button"
        onClick={() => {
          dismissVariant(page, variant)
          setDismissed(true)
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-heading"
        aria-label={t('pageGuides.dismiss')}
      >
        <X size={13} aria-hidden />
      </button>
    </aside>
  )
}

export default PageGuideBanner
