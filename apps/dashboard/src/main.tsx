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
import './index.css'

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
