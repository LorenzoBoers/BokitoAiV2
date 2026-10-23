import { Suspense } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, GitFork, Users, Waypoints, type LucideIcon } from 'lucide-react'
import {
  DEPARTMENTS_PATH,
  GRID_ICON,
  GRID_PATH,
  ORGANOGRAM_PATH,
  TAB_PATHS,
  WORKFLOW_PATH,
} from '../../lib/navigation'
import { cn } from '../../lib/utils'
import { WorkforceSectionTabs } from './SectionTabs'
import { RouteShellSkeleton } from '../ui/skeleton'
import { PageHeader } from '../ui/page-header'

type WorkforceNavItem = {
  to: string
  labelKey: string
  icon: LucideIcon
  active: boolean
}

/**
 * Workforce hub: second rail flush against the main menu (Settings pattern).
 * People · Departments · Grid · Workflow · Organogram live here; the page fills the rest.
 */
export default function WorkforceLayout() {
  const { t } = useTranslation('nav')
  const { pathname, search } = useLocation()
  const tab = new URLSearchParams(search).get('tab')
  const onGrid = pathname.startsWith(GRID_PATH)
  const onWorkflow = pathname.startsWith(WORKFLOW_PATH)
  const onOrganogram = pathname.startsWith(ORGANOGRAM_PATH)
  const onCanvas = onGrid || onWorkflow || onOrganogram
  const onDepartments = !onCanvas && (tab === 'departments' || tab === 'teams')
  const onPeople = !onCanvas && !onDepartments

  const items: WorkforceNavItem[] = [
    {
      to: TAB_PATHS.team,
      labelKey: 'teamPage.sections.people',
      icon: Users,
      active: onPeople,
    },
    {
      to: DEPARTMENTS_PATH,
      labelKey: 'teamPage.sections.teams',
      icon: Building2,
      active: onDepartments,
    },
    {
      to: GRID_PATH,
      labelKey: 'tabs.grid.title',
      icon: GRID_ICON,
      active: onGrid,
    },
    {
      to: WORKFLOW_PATH,
      labelKey: 'tabs.workflow.title',
      icon: Waypoints,
      active: onWorkflow,
    },
    {
      to: ORGANOGRAM_PATH,
      labelKey: 'tabs.organogram.title',
      icon: GitFork,
      active: onOrganogram,
    },
  ]
  // Grid, Workflow and Organogram fill the pane; their title is for screen readers only.
  const canvasItem = onCanvas ? items.find((item) => item.active) : undefined

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside
        className="hidden w-rail shrink-0 flex-col border-r border-border bg-bg px-2 pb-2 pt-2.5 lg:flex"
        aria-label={t('tabs.team.title')}
      >
        <p className="flex h-7 shrink-0 items-center pl-2 pb-1 text-sm font-medium leading-none text-text-heading">
          {t('tabs.team.title')}
        </p>
        <nav className="flex min-h-0 flex-col gap-0.5">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className="nav-row"
                data-active={item.active ? 'true' : undefined}
                aria-current={item.active ? 'page' : undefined}
              >
                <Icon aria-hidden />
                <span className="min-w-0 flex-1 truncate-fade">{t(item.labelKey)}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <nav
          className="shrink-0 overflow-x-auto border-b border-border bg-bg px-3 py-2 lg:hidden"
          aria-label={t('tabs.team.title')}
        >
          <WorkforceSectionTabs />
        </nav>
        <div
          className={cn(
            'min-h-0 flex-1',
            onCanvas ? 'overflow-hidden' : 'overflow-y-auto px-6 pb-8 pt-4',
          )}
        >
          {canvasItem ? <PageHeader className="sr-only" title={t(canvasItem.labelKey)} /> : null}
          <Suspense fallback={<RouteShellSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
