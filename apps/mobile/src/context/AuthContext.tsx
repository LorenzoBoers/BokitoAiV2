import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchMe, login as apiLogin, setAccessToken, type AuthUser } from '../lib/api'
import { gateway } from '../lib/gateway'
import { clearToken, loadToken, saveToken } from '../lib/storage'
import { registerForPush } from '../lib/push'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const token = await loadToken()
      if (!token) {
        if (!cancelled) setLoading(false)
        return
      }
      setAccessToken(token)
      try {
        const me = await fetchMe()
        if (!cancelled) {
          setUser(me.user)
          void registerForPush()
        }
      } catch {
        setAccessToken(null)
        await clearToken()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password)
    setAccessToken(result.access_token)
    await saveToken(result.access_token)
    gateway.reset()
    setUser(result.user)
    void registerForPush()
  }, [])

  const signOut = useCallback(async () => {
    setAccessToken(null)
    await clearToken()
    gateway.reset()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
