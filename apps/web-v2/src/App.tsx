import { Navigate, Route, Routes } from 'react-router-dom'

import { useToken } from '@/lib/auth'
import { Shell } from '@/shell/Shell'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { SurfacePlaceholder } from '@/pages/SurfacePlaceholder'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useToken()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/communication" replace />} />
        <Route path="/communication/*" element={<SurfacePlaceholder surface="communication" />} />
        <Route path="/overview" element={<SurfacePlaceholder surface="overview" />} />
        <Route path="/govern/*" element={<SurfacePlaceholder surface="govern" />} />
        <Route path="/work/*" element={<SurfacePlaceholder surface="work" />} />
        <Route path="/knowledge/*" element={<SurfacePlaceholder surface="knowledge" />} />
        <Route path="/connections/*" element={<SurfacePlaceholder surface="connections" />} />
        <Route path="/settings/*" element={<SurfacePlaceholder surface="settings" />} />
        <Route path="*" element={<Navigate to="/communication" replace />} />
      </Route>
    </Routes>
  )
}
