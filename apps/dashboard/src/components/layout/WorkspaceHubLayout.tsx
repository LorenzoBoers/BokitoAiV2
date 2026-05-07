import { Outlet } from 'react-router-dom'
import WorkspaceHubNav from './WorkspaceHubNav'

export default function WorkspaceHubLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar — vrij, buiten het content-vlak */}
      <WorkspaceHubNav />

      {/* Rechts: content in een afgerond vlak */}
      <div className="flex min-w-0 flex-1 flex-col p-3 pl-0">
        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/55 bg-bg-surface/40 overflow-hidden">
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
