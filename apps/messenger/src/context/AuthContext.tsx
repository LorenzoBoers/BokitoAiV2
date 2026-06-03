import { createContext, useContext, useMemo, useState } from 'react'
import type { ApiConfig } from '@bokito/messenger-ui'

type AuthState = {
  token: string | null
  setToken: (token: string | null) => void
  apiConfig: ApiConfig
}

const AuthContext = createContext<AuthState | null>(null)

const API_BASE = import.meta.env.VITE_BOKITO_API_URL || ''

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => sessionStorage.getItem('bokito_access_token'))

  const setToken = (value: string | null) => {
    setTokenState(value)
    if (value) sessionStorage.setItem('bokito_access_token', value)
    else sessionStorage.removeItem('bokito_access_token')
  }

  const apiConfig = useMemo<ApiConfig>(
    () => ({
      baseUrl: API_BASE,
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
