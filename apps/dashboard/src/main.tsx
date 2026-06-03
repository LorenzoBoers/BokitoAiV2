import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { NotificationProvider } from './context/NotificationContext'
import { ValidationProvider } from './context/ValidationContext'
import { UndoRedoProvider } from './context/UndoRedoContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { IntegrationBrandProvider } from './context/IntegrationBrandContext'
import { AppErrorBoundary } from './components/layout/AppErrorBoundary'
import App from './App'
import { readPublishedDashboardUser } from './lib/widget-bridge'
import './i18n'
import './index.css'
import { DASHBOARD_CHAT_AGENT_SLUG, CHAT_WIDGET_SCRIPT_PATH_INTERNAL, livechatWidgetHttpOrigin } from './lib/api.config'

const DASHBOARD_AUTH_TOKEN_KEY = 'bokito_access_token_session'

declare global {
  interface Window {
    BokitoConfig?: Record<string, unknown>
  }
}

const USE_BOKITO_API = import.meta.env.VITE_API_MODE === 'bokito'

function loadChatWidgetScript(): void {
  if (USE_BOKITO_API) return
  if (typeof document === 'undefined') return
  const existing = document.querySelector('script[data-bokito-chat-widget]')
  if (existing) return
  window.BokitoConfig = {
    ...(window.BokitoConfig ?? {}),
    getAuthToken: () => {
      try {
        return sessionStorage.getItem(DASHBOARD_AUTH_TOKEN_KEY) || ''
      } catch {
        return ''
      }
    },
    getUser: () => readPublishedDashboardUser(),
  }
  const script = document.createElement('script')
  script.src = CHAT_WIDGET_SCRIPT_PATH_INTERNAL
  script.defer = true
  script.dataset.bokitoChatWidget = ''
  script.dataset.agentSlug = DASHBOARD_CHAT_AGENT_SLUG
  script.dataset.apiUrl = livechatWidgetHttpOrigin()
  script.dataset.authMode = 'optional'
  document.body.appendChild(script)
}

loadChatWidgetScript()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <IntegrationBrandProvider>
                <NotificationProvider>
                  <ValidationProvider>
                    <UndoRedoProvider>
                      <App />
                      <Toaster richColors closeButton position="top-right" />
                    </UndoRedoProvider>
                  </ValidationProvider>
                </NotificationProvider>
              </IntegrationBrandProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
