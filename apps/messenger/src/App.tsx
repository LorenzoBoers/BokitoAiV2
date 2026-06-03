import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ChatPage } from './pages/ChatPage'
import { DecisionsPage } from './pages/DecisionsPage'
import { LoginPage } from './pages/LoginPage'

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <ChatPage />
            </Protected>
          }
        />
        <Route
          path="/decisions"
          element={
            <Protected>
              <DecisionsPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
