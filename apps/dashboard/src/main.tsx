import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { NotificationProvider } from './context/NotificationContext'
import { ValidationProvider } from './context/ValidationContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { IntegrationBrandProvider } from './context/IntegrationBrandContext'
import { AppErrorBoundary } from './components/layout/AppErrorBoundary'
import App from './App'
import i18n from './i18n'
import { initSentry } from './lib/sentry'
import { registerServiceWorker } from './lib/web-push'
import './index.css'

initSentry()
if (import.meta.env.PROD) {
  void registerServiceWorker()
}

// After a deploy the old hashed chunks disappear from the server. When a
// lazy route chunk fails to load, reload once so the browser picks up the
// new bundle instead of showing a broken page. The timestamp guard prevents
// a reload loop when the server itself is unreachable.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'bokito-chunk-reload-at'
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last < 30_000) return
  try {
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // ignore
  }
  event.preventDefault()
  window.location.reload()
})
void i18n.changeLanguage('en')
try {
  localStorage.setItem('bokito-language', 'en')
} catch {
  // ignore
}

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
                    <App />
                    <Toaster richColors closeButton position="top-right" />
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
