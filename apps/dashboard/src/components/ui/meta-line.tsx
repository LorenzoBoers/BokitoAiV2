import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Small muted line of facts separated by middots ("Gmail · 3 days ago").
 * Falsy children are skipped so callers can pass conditionals.
 */
export function MetaLine({ children, className }: { children: ReactNode; className?: string }) {
  const parts = Children.toArray(children).filter((child) => child !== '')
  return (
    <p className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-text-muted', className)}>
      {parts.map((part, index) => (
        <Fragment key={isValidElement(part) && part.key != null ? part.key : index}>
          {index > 0 ? <span aria-hidden>·</span> : null}
          <span className="min-w-0 truncate">{part}</span>
        </Fragment>
      ))}
    </p>
  )
}

export default MetaLine
