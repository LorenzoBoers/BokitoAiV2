import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ProjectsFolderNav from './ProjectsFolderNav'
import { SplitPane, SplitRow } from '../ui/SplitRow'
import { RouteShellSkeleton } from '../ui/skeleton'

/** Folders hub: resizable tree on the left (like Communication), detail on the right. */
export default function ProjectsLayout() {
  const { t } = useTranslation('nav')
  return (
    <SplitRow
      storageKey="bokito.split.foldersHub"
      minFlex={320}
      resetHint={t('projects.page.splitResetHint', {
        defaultValue: 'Drag to resize. Double-click or press Enter to reset.',
      })}
      className="h-full min-h-0"
    >
      <SplitPane
        id="nav"
        defaultWidth={232}
        minWidth={176}
        maxWidth={420}
        label={t('projects.page.splitNav', { defaultValue: 'Resize folders sidebar' })}
        className="hidden md:flex"
      >
        <aside className="flex h-full min-h-0 w-full flex-col border-r border-border/60 bg-bg px-2 pb-2 pt-2.5">
          <ProjectsFolderNav className="h-full" />
        </aside>
      </SplitPane>
      <SplitPane id="main" defaultWidth={0} minWidth={0} maxWidth={0} flex>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 pb-8 pt-4">
          <div className="mb-3 max-h-72 border-b border-border/60 pb-3 md:hidden">
            <ProjectsFolderNav className="h-full max-h-64" />
          </div>
          <Suspense fallback={<RouteShellSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </SplitPane>
    </SplitRow>
  )
}
