import { authRoutes } from '../api/routes/auth.routes';
import { APP_API_BASE, AUTH_API_BASE, INTEGRATIONS_API_BASE, WORKFORCE_API_BASE, XANO_BASE_URL, xanoApiBase } from './api.config';

const DEFAULT_ACCESS_TOKEN_TTL_S = 3600;
const DEFAULT_REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
const ACCESS_TOKEN_SESSION_KEY = 'bokito_access_token_session';

export { XANO_BASE_URL, xanoApiBase };
export const XANO_AUTH_API = AUTH_API_BASE;
const XANO_APP_API = APP_API_BASE;
const XANO_INTEGRATIONS_API = INTEGRATIONS_API_BASE;
/**
 * Same-origin BFF/proxy contract for portal auth.
 * Expected routes: POST /login, POST /refresh, GET /me, POST /logout.
 */
export const AUTH_PROXY_BASE = import.meta.env.VITE_AUTH_PROXY_BASE || '/api/auth';
export const ACCESS_TOKEN_TTL_S = Number(import.meta.env.VITE_DEFAULT_ACCESS_TOKEN_TTL_S || DEFAULT_ACCESS_TOKEN_TTL_S);
export const REFRESH_TOKEN_TTL_S = Number(import.meta.env.VITE_DEFAULT_REFRESH_TOKEN_TTL_S || DEFAULT_REFRESH_TOKEN_TTL_S);
const AUTH_PROXY_FALLBACK_STATUSES = new Set([404, 405, 502, 503, 504]);

let accessTokenProvider: (() => string | null) | null = null;

export function setAccessTokenProvider(provider: (() => string | null) | null): void {
  accessTokenProvider = provider;
}

function readStoredAccessToken(): string | null {
  try {
    const fromSession = sessionStorage.getItem(ACCESS_TOKEN_SESSION_KEY);
    if (fromSession?.trim()) return fromSession;
  } catch {
    // Ignore storage failures in private mode.
  }
  return null;
}

export function resolveAccessToken(explicitToken?: string): string | null {
  if (explicitToken && explicitToken.trim()) return explicitToken;
  const fromProvider = accessTokenProvider?.();
  if (fromProvider?.trim()) return fromProvider;
  return readStoredAccessToken();
}

export function requireAccessToken(explicitToken?: string): string {
  const token = resolveAccessToken(explicitToken);
  if (!token) throw new Error('Not authenticated');
  return token;
}

export function buildAuthHeaders(token?: string, includeJson = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJson) headers['Content-Type'] = 'application/json';
  const resolvedToken = resolveAccessToken(token);
  if (resolvedToken) headers['Authorization'] = `Bearer ${resolvedToken}`;
  return headers;
}

function formatXanoHttpError(path: string, body: unknown): string {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const msg = typeof o.message === 'string' ? o.message : 'Onbekende fout'
  const payload = o.payload && typeof o.payload === 'object' ? (o.payload as Record<string, unknown>) : null
  const param = payload && typeof payload.param === 'string' ? payload.param : null
  const hint = param ? ` (${param})` : ''
  return `${msg}${hint} [${path}]`
}

async function readJsonResponse<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }));
    throw new Error(`HTTP ${res.status} ${formatXanoHttpError(path, err)}`);
  }
  return res.json() as Promise<T>;
}

function buildAuthProxyUrl(path: string): string {
  return `${AUTH_PROXY_BASE}${path}`;
}

function buildAuthDirectUrl(path: string): string {
  return `${XANO_AUTH_API}${path}`;
}

async function fetchAuthWithFallback(proxyPath: string, directPath: string, init: RequestInit): Promise<Response> {
  try {
    const proxyRes = await fetch(buildAuthProxyUrl(proxyPath), init);
    if (!AUTH_PROXY_FALLBACK_STATUSES.has(proxyRes.status)) return proxyRes;
  } catch {
    // Fall through to direct auth endpoint when proxy is unreachable.
  }
  return fetch(buildAuthDirectUrl(directPath), init);
}

export async function xanoPost<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);

  const res = await fetch(`${XANO_APP_API}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });

  return readJsonResponse<T>(res, path);
}

export async function xanoPostAuth<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoPatchAuth<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }
  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoGet<T>(path: string, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token, false);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }

  const res = await fetch(`${XANO_APP_API}${path}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  return readJsonResponse<T>(res, path);
}

export async function xanoDelete<T = unknown>(path: string, token?: string): Promise<T | void> {
  const headers = buildAuthHeaders(token, false);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }

  const res = await fetch(`${XANO_APP_API}${path}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  const text = await res.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function xanoPatch<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }

  const res = await fetch(`${XANO_APP_API}${path}`, {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }

  return res.json()
}

export async function xanoGetIntegrations<T>(path: string, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token, false);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }
  const res = await fetch(`${XANO_INTEGRATIONS_API}${path}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoPostIntegrations<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  const res = await fetch(`${XANO_INTEGRATIONS_API}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoPatchIntegrations<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }
  const res = await fetch(`${XANO_INTEGRATIONS_API}${path}`, {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoPutIntegrations<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }
  const res = await fetch(`${XANO_INTEGRATIONS_API}${path}`, {
    method: 'PUT',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoDeleteIntegrations<T = unknown>(path: string, token?: string): Promise<T | void> {
  const headers = buildAuthHeaders(token, false);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }
  const res = await fetch(`${XANO_INTEGRATIONS_API}${path}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function xanoPut<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }

  const res = await fetch(`${XANO_APP_API}${path}`, {
    method: 'PUT',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }

  return res.json()
}

// Enhanced auth functions
export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  return xanoPostAuth(authRoutes.session.passwordResetRequest, { email });
}

export async function resetPassword(token: string, password: string, passwordConfirmation: string): Promise<{ message: string }> {
  return xanoPostAuth(authRoutes.session.passwordReset, {
    token, 
    password, 
    password_confirmation: passwordConfirmation 
  });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return xanoPostAuth(authRoutes.session.verifyEmail, { token });
}

export async function resendVerificationEmail(email: string): Promise<{ message: string }> {
  return xanoPostAuth(authRoutes.session.resendVerification, { email });
}

export async function refreshToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  return xanoPostAuth(authRoutes.session.refreshToken, { refresh_token: refreshToken });
}

export async function revokeToken(token: string): Promise<void> {
  await xanoPostAuth(authRoutes.session.revoke, {}, token);
}

export interface AuthSessionResponse {
  access_token?: string;
  authToken?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: unknown;
  return_to?: string;
}

export async function authLogin(email: string, password: string): Promise<AuthSessionResponse> {
  const res = await fetchAuthWithFallback(authRoutes.proxy.login, authRoutes.proxy.login, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  return readJsonResponse<AuthSessionResponse>(res, authRoutes.errorContext.login);
}

export async function authRefresh(): Promise<AuthSessionResponse> {
  const res = await fetchAuthWithFallback(authRoutes.proxy.refresh, authRoutes.proxy.refresh, {
    method: 'POST',
    credentials: 'include',
  });
  return readJsonResponse<AuthSessionResponse>(res, authRoutes.errorContext.refresh);
}

export async function authMe(token?: string): Promise<unknown> {
  const headers = buildAuthHeaders(token, false);
  const res = await fetchAuthWithFallback(authRoutes.proxy.me, authRoutes.proxy.me, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  return readJsonResponse<unknown>(res, authRoutes.errorContext.me);
}

export async function authMeForTenant(token: string | undefined, tenantSubdomain: string): Promise<unknown> {
  const sanitizedSubdomain = tenantSubdomain.trim().toLowerCase();
  if (!sanitizedSubdomain) return authMe(token);
  const path = authRoutes.meWithTenantQuery(sanitizedSubdomain);
  const headers = buildAuthHeaders(token, false);
  const res = await fetchAuthWithFallback(path, path, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  return readJsonResponse<unknown>(res, authRoutes.errorContext.me);
}

export async function authLogout(token?: string): Promise<void> {
  const headers = buildAuthHeaders(token);
  const res = await fetchAuthWithFallback(authRoutes.proxy.logout, authRoutes.proxy.logout, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }));
    throw new Error(formatXanoHttpError(authRoutes.errorContext.logout, err));
  }
}

export async function xanoGetWorkforce<T>(path: string, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token, false);
  if (!headers.Authorization) {
    throw new Error(formatXanoHttpError(path, { message: 'Niet geauthenticeerd' }));
  }
  const res = await fetch(`${WORKFORCE_API_BASE}${path}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoPostWorkforce<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  const res = await fetch(`${WORKFORCE_API_BASE}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoPatchWorkforce<T>(path: string, body: object, token?: string): Promise<T> {
  const headers = buildAuthHeaders(token);
  const res = await fetch(`${WORKFORCE_API_BASE}${path}`, {
    method: 'PATCH',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(res, path);
}

export async function xanoDeleteWorkforce<T = unknown>(path: string, token?: string): Promise<T | void> {
  const headers = buildAuthHeaders(token, false);
  const res = await fetch(`${WORKFORCE_API_BASE}${path}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (res.status === 204) return undefined as T;
  return readJsonResponse<T>(res, path);
}
