import { Outlet } from 'react-router-dom'

/** Content shell for /integrations/*; section subnav is in SectionSidebar. */
export default function IntegrationsLayout() {
  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
      <Outlet />
    </div>
  )
}
