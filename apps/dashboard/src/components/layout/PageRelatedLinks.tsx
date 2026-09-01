import type { ReactNode } from 'react'
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
  if (links.length === 0) return null
  return (
    <nav
      aria-label="Related"
      className={cn('border-t border-border/40 pt-4 text-[12px] text-text-muted', className)}
    >
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {links.map((link, index) => (
          <li key={`${link.to}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 ? <span aria-hidden className="text-border-light">·</span> : null}
            <Link to={link.to} className="font-medium text-accent hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
