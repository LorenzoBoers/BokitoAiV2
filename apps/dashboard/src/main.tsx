import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, isRouteErrorResponse, RouterProvider, useRouteError } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { NotificationProvider } from './context/NotificationContext'
import { ValidationProvider } from './context/ValidationContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { IntegrationBrandProvider } from './context/IntegrationBrandContext'
import { AppErrorBoundary } from './components/layout/AppErrorBoundary'
import { NativeTitleTooltipBridge } from './components/ui/NativeTitleTooltipBridge'
import { TooltipProvider } from './components/ui/tooltip'
import { ConfirmProvider } from './components/ui/confirm-dialog'
import { Toaster } from './components/ui/toaster'
import App from './App'
import i18n, { ensureLanguage } from './i18n'
import { PLATFORM_DEFAULT_LANGUAGE } from './lib/api.config'
import { initSentry } from './lib/sentry'
import { registerServiceWorker } from './lib/web-push'
// Self-hosted fonts (latin subset): no request to Google, no third-party IP transfer.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-500.css'
import '@fontsource/source-serif-4/latin-600.css'
import './index.css'
import { Button } from './components/ui/button'
import { PageHeader } from './components/ui/page-header'

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
// Locale strings load per language; render once the active one is in.
const languageReady = ensureLanguage(bootLanguage)
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

function RouteErrorFallback() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : i18n.t('errorBoundary.body', { ns: 'nav' })

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-6">
      <div className="max-w-md space-y-4 text-center">
        <PageHeader
          className="mb-0 justify-center text-center"
          title={i18n.t('errorBoundary.title', { ns: 'nav' })}
          subtitle={message}
        />
        <Button
          type="button"
          onClick={() => window.location.assign('/')}
        >
          {i18n.t('errorBoundary.refresh', { ns: 'nav' })}
        </Button>
      </div>
    </div>
  )
}

// Data router (single splat route around the app) so router-data hooks such
// as useBlocker (unsaved-changes guard) work; App keeps its descendant
// <Routes> for the actual route table.
const router = createBrowserRouter([
  {
    path: '*',
    errorElement: <RouteErrorFallback />,
    element: (
      <ThemeProvider>
        <TooltipProvider delayDuration={150}>
          <AuthProvider>
            <WorkspaceProvider>
              <IntegrationBrandProvider>
                <NotificationProvider>
                  <ValidationProvider>
                    <ConfirmProvider>
                      <App />
                    </ConfirmProvider>
                    <NativeTitleTooltipBridge />
                    <Toaster />
                  </ValidationProvider>
                </NotificationProvider>
              </IntegrationBrandProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    ),
  },
])

void languageReady
  .catch(() => undefined)
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </StrictMode>,
    )
  })
