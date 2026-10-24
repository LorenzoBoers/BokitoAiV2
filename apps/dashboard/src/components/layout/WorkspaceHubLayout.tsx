import { Card } from '../ui/card'
import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import PersonalAssistantWidget from '../shell/PersonalAssistantWidget'
import WorkspaceHubNav from './WorkspaceHubNav'
import { RouteShellSkeleton } from '../ui/skeleton'

export default function WorkspaceHubLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar — vrij, buiten het content-vlak */}
      <WorkspaceHubNav />

      {/* Rechts: content in een afgerond vlak */}
      <div className="flex min-w-0 flex-1 flex-col p-3 pl-0">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<div className="p-6"><RouteShellSkeleton /></div>}>
              {children ?? <Outlet />}
            </Suspense>
          </main>
        </Card>
      </div>

      {/* Same in-app Bokito helper as inside a workspace (dev-only; no FAB). */}
      <PersonalAssistantWidget />
    </div>
  )
}
