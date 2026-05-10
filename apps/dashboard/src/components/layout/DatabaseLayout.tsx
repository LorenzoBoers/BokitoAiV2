import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AppHeader from './AppHeader'
import { DatabaseProvider } from '../../context/DatabaseContext'
import DatabaseSectionSidebar from './DatabaseSectionSidebar'

export default function DatabaseLayout() {
  return (
    <DatabaseProvider>
      <div className="flex h-screen gap-3 bg-bg p-3">
        <Sidebar />
        <div className="flex-1 min-w-0">
          <div className="featurebase-shell-panel flex h-full min-h-0 overflow-hidden">
            <DatabaseSectionSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <AppHeader />
              <main className="featurebase-main flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 pb-5 pt-2.5">
                <Outlet />
              </main>
            </div>
          </div>
        </div>
      </div>
    </DatabaseProvider>
  )
}
