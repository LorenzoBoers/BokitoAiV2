import { Outlet } from 'react-router-dom'
import { DatabaseProvider } from '../../context/DatabaseContext'

/** Wraps /database routes so SectionSidebar can list tables via useDatabase. */
export default function DatabaseRouteLayout() {
  return (
    <DatabaseProvider>
      <Outlet />
    </DatabaseProvider>
  )
}
