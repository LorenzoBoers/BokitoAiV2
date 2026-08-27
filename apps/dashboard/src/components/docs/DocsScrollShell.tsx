import type { ReactNode } from 'react'

/**
 * Public docs/help pages live outside the app shell, but html/body/#root
 * are overflow-hidden for the dashboard. This shell is the scrollport.
 */
export default function DocsScrollShell({
  header,
  children,
}: {
  header: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="shrink-0">{header}</div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  )
}
