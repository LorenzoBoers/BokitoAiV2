import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

export type RelatedLink = {
  to: string
  label: ReactNode
}

/**
 * Quiet footer links for settings/docs that relate to the current page.
 * Prefer this over packing secondary destinations into page headers.
 */
export function PageRelatedLinks({
  links,
  className,
}: {
  links: RelatedLink[]
  className?: string
}) {
  const { t } = useTranslation('nav')
  if (links.length === 0) return null
  return (
    <nav
      aria-label={t('pageRelated.ariaLabel', { defaultValue: 'Related' })}
      className={cn('border-t border-border/40 pt-4 text-xs text-text-muted', className)}
    >
      <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <li className="mr-1">{t('pageRelated.ariaLabel', { defaultValue: 'Related' })}</li>
        {links.map((link, index) => (
          <li key={`${link.to}-${index}`} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden className="text-border-light">·</span> : null}
            <Link
              to={link.to}
              className="text-text-secondary underline-offset-2 transition-colors hover:text-text-heading hover:underline"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
