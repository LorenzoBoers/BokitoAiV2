import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'

/** Avatar that opens the person or agent page. Decorative when there is no page. */
export function EntityAvatarLink({
  to,
  label,
  children,
  className,
}: {
  to?: string | null
  label: string
  children: ReactNode
  className?: string
}) {
  if (!to) return <span className={cn('inline-flex shrink-0', className)}>{children}</span>
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'inline-flex shrink-0 rounded-full outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
    >
      {children}
    </Link>
  )
}
