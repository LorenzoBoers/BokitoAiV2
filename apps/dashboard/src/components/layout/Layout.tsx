import type { ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { NavBadgeProvider } from '../../context/NavBadgeContext'
import { InboxCommunicationProvider } from '../../context/InboxCommunicationContext'
import { ProjectHubNavProvider, isProjectHubRoute } from '../../context/ProjectHubNavContext'
import { WorkspaceDocNavProvider } from '../../context/WorkspaceDocNavContext'
import Sidebar from './Sidebar'
import AppHeader from './AppHeader'
import SectionSidebar from './SectionSidebar'

/**
 * Lift the workspace docs provider above `SectionSidebar` on hub doc
 * routes so the contextual page tree can render alongside the canvas.
 */
function MaybeWorkspaceDocs({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  if (
    pathname.startsWith('/projects') ||
    pathname.startsWith('/project/')
  ) {
    return <WorkspaceDocNavProvider>{children}</WorkspaceDocNavProvider>
  }
  return <>{children}</>
}

function MaybeProjectHubNav({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  if (isProjectHubRoute(pathname)) {
    return <ProjectHubNavProvider>{children}</ProjectHubNavProvider>
  }
  return <>{children}</>
}

export default function Layout() {
  return (
    <NavBadgeProvider>
      <InboxCommunicationProvider>
      <MaybeProjectHubNav>
        <MaybeWorkspaceDocs>
        <div className="flex h-screen gap-3 bg-bg p-3">
          <Sidebar />
          <div className="flex-1 min-w-0">
            <div className="featurebase-shell-panel flex h-full min-h-0 overflow-hidden">
              <SectionSidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <AppHeader />
                <main className="featurebase-main flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-2.5">
                  <Outlet />
                </main>
              </div>
            </div>
          </div>
        </div>
        </MaybeWorkspaceDocs>
      </MaybeProjectHubNav>
      </InboxCommunicationProvider>
    </NavBadgeProvider>
  )
}
