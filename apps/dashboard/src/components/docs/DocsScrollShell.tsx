import type { ReactNode } from 'react'

/**
 * Public docs/help pages live outside the app shell, but html/body/#root
 * are overflow-hidden for the dashboard. The header is fixed so article
 * content can scroll underneath a frosted glass bar.
 */
export default function DocsScrollShell({
  header,
  children,
  className,
}: {
  header: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className ?? 'relative h-dvh overflow-hidden bg-bg text-text-primary'}>
      <div className="docs-header-sticky fixed inset-x-0 top-0 z-30">{header}</div>
      <div className="docs-scroll h-dvh overflow-y-auto overscroll-contain pt-14">
        {children}
      </div>
    </div>
  )
}
