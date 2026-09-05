import { Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import PersonalAssistantWidget from '../shell/PersonalAssistantWidget'
import WorkspaceHubNav from './WorkspaceHubNav'

export default function WorkspaceHubLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar — vrij, buiten het content-vlak */}
      <WorkspaceHubNav />

      {/* Rechts: content in een afgerond vlak */}
      <div className="flex min-w-0 flex-1 flex-col p-3 pl-0">
        <div className="featurebase-shell-panel flex min-h-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-y-auto">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>

      {/* Same personal Bokito FAB as inside a workspace — person-scoped memory,
          threads still land in the JWT/current workspace until they open another. */}
      <PersonalAssistantWidget />
    </div>
  )
}
