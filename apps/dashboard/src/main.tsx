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

function loadChatWidgetScript(): void {
  if (typeof document === 'undefined') return
  const existing = document.querySelector('script[data-bokito-chat-widget]')
  if (existing) return
  const script = document.createElement('script')
  script.src = '/chat-widget/bokito-chat.js'
  script.defer = true
  script.dataset.bokitoChatWidget = ''
  script.dataset.agentSlug = 'bokito-dashboard'
  script.dataset.apiUrl = 'https://xrex-nmji-j9ur.f2.xano.io'
  document.body.appendChild(script)
}

loadChatWidgetScript()

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
