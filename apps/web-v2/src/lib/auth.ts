import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { authRoutes } from '@/api/routes'
import { api } from './api'
import { authStore } from './auth-store'

export type TokenOut = { access_token: string; tenant_id: string | null; user_id: string }

export type Me = {
  user_id: string
  email: string
  name: string
  language: string
  is_staff: boolean
  role: string | null
  workspace: {
    id: string
    slug: string
    name: string
    posture: 'manual' | 'assisted' | 'autonomous'
    region: string
    language: string
  }
}

export function useToken() {
  return useSyncExternalStore(
    (fn) => authStore.subscribe(fn),
    () => authStore.token,
    () => authStore.token,
  )
}

export function useMe() {
  const token = useToken()
  return useQuery({
    queryKey: ['me', token],
    queryFn: () => api.get<Me>(authRoutes.me),
    enabled: Boolean(token),
    staleTime: 60_000,
    retry: false,
  })
}

export async function login(email: string, password: string) {
  const out = await api.post<TokenOut>(authRoutes.login, { email, password })
  authStore.setToken(out.access_token, out.tenant_id)
  return out
}

export async function signup(input: {
  email: string
  password: string
  name: string
  workspace_name: string
  language: string
  invite?: string
}) {
  const out = await api.post<TokenOut>(authRoutes.signup, input)
  authStore.setToken(out.access_token, out.tenant_id)
  return out
}

export function useLogout() {
  const qc = useQueryClient()
  return async () => {
    try {
      await api.post(authRoutes.logout)
    } finally {
      authStore.clear()
      qc.clear()
    }
  }
}
