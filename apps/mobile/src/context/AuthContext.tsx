import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  fetchMe,
  isTwoFactorChallenge,
  login as apiLogin,
  setAccessToken,
  setOnUnauthorized,
  switchWorkspace as apiSwitchWorkspace,
  verifyTotp,
  type AuthUser,
  type LoginResponse,
} from '../lib/api'
import { gateway } from '../lib/gateway'
import { registerForPush } from '../lib/push'
import { clearToken, loadToken, saveLastEmail, saveToken } from '../lib/storage'

export type SignInResult = { status: 'ok' } | { status: '2fa'; challengeToken: string }

type AuthState = {
  user: AuthUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<SignInResult>
  completeTwoFactor: (challengeToken: string, code: string) => Promise<void>
  switchWorkspace: (tenantId: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function applySession(result: LoginResponse, setUser: (user: AuthUser) => void) {
  setAccessToken(result.access_token)
  await saveToken(result.access_token)
  gateway.reset()
  setUser(result.user)
  void registerForPush()
}

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

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const result = await apiLogin(email, password)
    await saveLastEmail(email)
    if (isTwoFactorChallenge(result)) {
      return { status: '2fa', challengeToken: result.challenge_token }
    }
    await applySession(result, setUser)
    return { status: 'ok' }
  }, [])

  const completeTwoFactor = useCallback(async (challengeToken: string, code: string) => {
    const result = await verifyTotp(challengeToken, code)
    await applySession(result, setUser)
  }, [])

  const switchWorkspace = useCallback(async (tenantId: string) => {
    const result = await apiSwitchWorkspace(tenantId)
    await applySession(result, setUser)
  }, [])

  const signOut = useCallback(async () => {
    setAccessToken(null)
    await clearToken()
    gateway.reset()
    setUser(null)
  }, [])

  useEffect(() => {
    setOnUnauthorized(() => {
      void signOut()
    })
    return () => setOnUnauthorized(null)
  }, [signOut])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, completeTwoFactor, switchWorkspace, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
