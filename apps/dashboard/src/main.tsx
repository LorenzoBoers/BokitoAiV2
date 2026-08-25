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
import { PLATFORM_DEFAULT_LANGUAGE } from './lib/api.config'
import { initSentry } from './lib/sentry'
import { registerServiceWorker } from './lib/web-push'
import './index.css'

function resolveBootLanguage(): 'nl' | 'en' {
  const fromQuery = new URLSearchParams(window.location.search).get('lang')
  if (fromQuery === 'en' || fromQuery === 'nl') return fromQuery
  try {
    const stored = window.localStorage.getItem('bokito-language')
    if (stored === 'en' || stored === 'nl') return stored
  } catch {
    // Ignore private-mode storage failures.
  }
  return PLATFORM_DEFAULT_LANGUAGE
}

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
const bootLanguage = resolveBootLanguage()
void i18n.changeLanguage(bootLanguage)
document.documentElement.lang = bootLanguage
try {
  const fromQuery = new URLSearchParams(window.location.search).get('lang')
  if (fromQuery === 'en' || fromQuery === 'nl') {
    localStorage.setItem('bokito-language', fromQuery)
  } else if (!localStorage.getItem('bokito-language')) {
    localStorage.setItem('bokito-language', PLATFORM_DEFAULT_LANGUAGE)
  }
} catch {
  // Ignore private-mode storage failures.
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
                    <Toaster
                      richColors
                      closeButton
                      position="top-right"
                      toastOptions={{
                        duration: 3400,
                        className: 'shadow-overlay',
                      }}
                    />
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
