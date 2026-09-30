import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { useToken } from '@/lib/auth'
import { Shell } from '@/shell/Shell'
import { LoginPage } from '@/pages/auth/LoginPage'
import { OAuthConsentPage } from '@/pages/auth/OAuthConsentPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { CommunicationPage } from '@/pages/communication/CommunicationPage'
import { ConnectionsPage } from '@/pages/ConnectionsPage'
import { GovernPage } from '@/pages/govern/GovernPage'
import { KnowledgePage } from '@/pages/KnowledgePage'
import { OverviewPage } from '@/pages/OverviewPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WorkPage } from '@/pages/work/WorkPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useToken()
  const location = useLocation()
  if (!token) {
    const next = `${location.pathname}${location.search}`
    const to = next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'
    return <Navigate to={to} replace />
  }
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/oauth/consent"
        element={
          <RequireAuth>
            <OAuthConsentPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/communication" replace />} />
        <Route path="/communication" element={<CommunicationPage />} />
        <Route path="/communication/:id" element={<CommunicationPage />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/govern" element={<GovernPage />} />
        <Route path="/govern/:tab" element={<GovernPage />} />
        <Route path="/work" element={<WorkPage />} />
        <Route path="/work/:tab" element={<WorkPage />} />
        <Route path="/work/:tab/:id" element={<WorkPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<KnowledgePage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:tab" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/communication" replace />} />
      </Route>
    </Routes>
  )
}
