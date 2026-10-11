import { Outlet } from 'react-router-dom'
import ProjectsFolderNav from './ProjectsFolderNav'

/** Projects hub: folder tree on the left, the list or the open project on the right. */
export default function ProjectsLayout() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-border/60 bg-bg px-2 pb-2 pt-2.5 md:flex">
        <ProjectsFolderNav className="h-full" />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 pb-8 pt-4">
        <div className="mb-3 max-h-72 border-b border-border/60 pb-3 md:hidden">
          <ProjectsFolderNav className="h-full max-h-64" />
        </div>
        <Outlet />
      </div>
    </div>
  )
}
