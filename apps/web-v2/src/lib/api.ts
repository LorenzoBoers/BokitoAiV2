/**
 * REST transport: bearer token from the auth store, one refresh attempt on 401,
 * and the API's `{error: {code, message}}` shape surfaced as `ApiError`.
 */
import { API_BASE } from './api.config'
import { authRoutes } from '@/api/routes'
import { authStore } from './auth-store'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: unknown } } = {}
  try {
    body = await res.json()
  } catch {
    /* no body */
  }
  return new ApiError(
    res.status,
    body.error?.code ?? 'http_error',
    body.error?.message ?? res.statusText,
    body.error?.details,
  )
}

let refreshing: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}${authRoutes.refresh}`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!res.ok) return false
        const data = (await res.json()) as { access_token: string; tenant_id: string | null }
        authStore.setToken(data.access_token, data.tenant_id)
        return true
      } catch {
        return false
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

export async function request<T>(
  path: string,
  init: { method?: Method; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  retry = true,
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = {}
  const token = authStore.token
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'include',
  })

  if (res.status === 401 && retry && token) {
    if (await tryRefresh()) return request<T>(path, init, false)
    authStore.clear()
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | boolean | undefined>) =>
    request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
