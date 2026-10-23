import { createContext, useContext, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import type { PageGuideSlug } from '../../lib/page-guides'
import { PageGuideLink } from '../layout/PageGuideLink'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu'

/** True inside `AppShell`, whose topbar shows the page title below `md`. */
export const ShellTitleContext = createContext(false)

type PageHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  /** The one main action; always visible. */
  primaryAction?: ReactNode
  /** Other controls: inline from `sm`, behind a menu on a narrow screen. */
  actions?: ReactNode
  /** Page-guide slug: renders a quiet "Learn more" link next to the controls. */
  guide?: PageGuideSlug
  /** Detail pages: arrow + label back to the parent list. */
  back?: { to: string; label: ReactNode }
  /** Leading `IconTile` for entity pages (department, folder). */
  icon?: ReactNode
  className?: string
}

/**
 * The page's one `<h1>`. Inside the shell, below `md`, the topbar shows the
 * title, so a top-level page keeps the heading for screen readers only.
 */
export function PageHeader({
  title,
  subtitle,
  primaryAction,
  actions,
  guide,
  back,
  icon,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation('nav')
  // Detail pages keep their name: the topbar only shows the section there.
  const inShell = useContext(ShellTitleContext) && !back
  const controls = Boolean(primaryAction || actions || guide)
  return (
    <section className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {back ? (
          <Link
            to={back.to}
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-heading"
          >
            <ArrowLeft size={14} aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <div className={cn('shrink-0', inShell && 'hidden md:block')}>{icon}</div> : null}
          <div className="min-w-0">
            <h1 className={cn('title-page leading-tight', inShell && 'sr-only md:not-sr-only')}>{title}</h1>
            {subtitle ? (
              <div className={cn('text-sm text-text-secondary', inShell ? 'md:mt-1' : 'mt-1')}>{subtitle}</div>
            ) : null}
          </div>
        </div>
      </div>
      {controls ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {guide ? <PageGuideLink page={guide} compact={Boolean(primaryAction || actions)} /> : null}
          {actions ? <div className="hidden flex-wrap items-center gap-2 sm:flex">{actions}</div> : null}
          {actions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden" aria-label={t('topbar.pageActions')}>
                  <MoreHorizontal size={16} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="flex flex-col items-stretch gap-1 p-2">
                {actions}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {primaryAction}
        </div>
      ) : null}
    </section>
  )
}
