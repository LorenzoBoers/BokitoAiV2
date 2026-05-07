import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { NotificationProvider } from './context/NotificationContext'
import { ValidationProvider } from './context/ValidationContext'
import { UndoRedoProvider } from './context/UndoRedoContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import App from './App'
import './i18n'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <NotificationProvider>
              <ValidationProvider>
                <UndoRedoProvider>
                  <App />
                </UndoRedoProvider>
              </ValidationProvider>
            </NotificationProvider>
          </WorkspaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
