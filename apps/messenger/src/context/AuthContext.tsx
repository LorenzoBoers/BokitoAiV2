import { createContext, useContext, useMemo, useState } from 'react'
import type { ApiConfig } from '@bokito/messenger-ui'

type AuthState = {
  token: string | null
  setToken: (token: string | null) => void
  apiConfig: ApiConfig
}

const AuthContext = createContext<AuthState | null>(null)

/** In dev, use same-origin `/api` proxy (vite.config.ts) to avoid CORS on cross-origin API calls. */
function resolveApiBase(): string {
  if (import.meta.env.DEV) return ''
  return (import.meta.env.VITE_BOKITO_API_URL || '').replace(/\/$/, '')
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => sessionStorage.getItem('bokito_access_token'))

  const setToken = (value: string | null) => {
    setTokenState(value)
    if (value) sessionStorage.setItem('bokito_access_token', value)
    else sessionStorage.removeItem('bokito_access_token')
  }

  const apiConfig = useMemo<ApiConfig>(
    () => ({
      baseUrl: resolveApiBase(),
      getToken: () => token,
    }),
    [token],
  )

  return <AuthContext.Provider value={{ token, setToken, apiConfig }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
