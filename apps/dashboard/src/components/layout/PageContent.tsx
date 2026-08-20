import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type PageContentWidth = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface PageContentProps {
  children: ReactNode
  /**
   * Constrain content width.
   * - sm: 640px (narrow forms)
   * - md: 896px (standard reading width)
   * - lg: 1000px (default; settings, project overview)
   * - xl: 1200px (dense lists, integrations marketplace)
   * - full: no max-width (database grid, doc canvas)
   */
  width?: PageContentWidth
  className?: string
}

const WIDTH_CLASS: Record<PageContentWidth, string> = {
  sm: 'mx-auto w-full max-w-[640px]',
  md: 'mx-auto w-full max-w-[896px]',
  lg: 'mx-auto w-full max-w-[1000px]',
  xl: 'mx-auto w-full max-w-[1200px]',
  full: 'w-full',
}

/**
 * Canonical inner wrapper for routes inside `Layout`. Owns horizontal width
 * only; `Layout.tsx` already provides outer padding (`px-5 pb-5 pt-2.5`).
 *
 * Use a vertical stack utility (`space-y-*`) inside via `className` when the
 * page renders multiple sections.
 */
export function PageContent({ children, width = 'lg', className }: PageContentProps) {
  return <div className={cn(WIDTH_CLASS[width], 'animate-page-enter', className)}>{children}</div>
}

export default PageContent
