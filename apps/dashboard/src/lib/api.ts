import { authRoutes } from '../api/routes/auth.routes';
import { APP_API_BASE, AUTH_API_BASE, WORKFORCE_API_BASE } from './api.config';

export { APP_API_BASE, AUTH_API_BASE, WORKFORCE_API_BASE };

const DEFAULT_ACCESS_TOKEN_TTL_S = 3600;
const DEFAULT_REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
const ACCESS_TOKEN_SESSION_KEY = 'bokito_access_token_session';

/**
 * Same-origin REST client for the FastAPI gateway.
 * Live updates go over the WebSocket client in `lib/gateway.ts`.
 */
export const AUTH_PROXY_BASE = import.meta.env.VITE_AUTH_PROXY_BASE || '/api/auth';
export const ACCESS_TOKEN_TTL_S = Number(import.meta.env.VITE_DEFAULT_ACCESS_TOKEN_TTL_S || DEFAULT_ACCESS_TOKEN_TTL_S);
export const REFRESH_TOKEN_TTL_S = Number(import.meta.env.VITE_DEFAULT_REFRESH_TOKEN_TTL_S || DEFAULT_REFRESH_TOKEN_TTL_S);
const AUTH_FETCH_TIMEOUT_MS = 12_000;

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
  const merged: RequestInit = { ...init, signal: controller.signal };
  return fetch(url, merged).finally(() => window.clearTimeout(timeoutId));
}

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

function parseApiErrorBody(body: unknown): string {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim()
  const detail = o.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>
          if (typeof row.msg === 'string') return row.msg
        }
        return null
      })
      .filter((part): part is string => Boolean(part))
    if (parts.length) return parts.join('; ')
  }
  return 'Unknown error'
}

function formatHttpError(path: string, body: unknown): string {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const msg = parseApiErrorBody(body)
  const payload = o.payload && typeof o.payload === 'object' ? (o.payload as Record<string, unknown>) : null
  const param = payload && typeof payload.param === 'string' ? payload.param : null
  const hint = param ? ` (${param})` : ''
  return `${msg}${hint} [${path}]`
}

async function readJsonResponse<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let err: unknown;
    try {
      err = text ? JSON.parse(text) : { message: 'Unknown error' };
    } catch {
      const unreachable =
        res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
      err = {
        message: unreachable
          ? 'API not reachable. Start FastAPI on http://127.0.0.1:8000 (see docs/AI-OS-DEV.md).'
          : text || 'Unknown error',
      };
    }
    throw new Error(`HTTP ${res.status} ${formatHttpError(path, err)}`);
  }
  return res.json() as Promise<T>;
}

async function request<T>(
  base: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  options: { body?: object; token?: string; requireAuth?: boolean } = {},
): Promise<T> {
  const hasBody = options.body != null;
  const headers = buildAuthHeaders(options.token, hasBody);
  if (options.requireAuth !== false && !headers.Authorization) {
    throw new Error(formatHttpError(path, { message: 'Not authenticated' }));
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
  });
  if (method === 'DELETE') {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error((err as { message?: string }).message || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }
  return readJsonResponse<T>(res, path);
}

// ── app base (`/api`) ────────────────────────────────────────────────

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  return request<T>(APP_API_BASE, path, 'GET', { token });
}

export async function apiPost<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(APP_API_BASE, path, 'POST', { body, token, requireAuth: false });
}

export async function apiPatch<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(APP_API_BASE, path, 'PATCH', { body, token });
}

export async function apiPut<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(APP_API_BASE, path, 'PUT', { body, token });
}

export async function apiDelete<T = unknown>(path: string, token?: string): Promise<T | void> {
  return request<T>(APP_API_BASE, path, 'DELETE', { token });
}

// ── workforce base (`/api/workforce`) ────────────────────────────────

export async function workforceGet<T>(path: string, token?: string): Promise<T> {
  return request<T>(WORKFORCE_API_BASE, path, 'GET', { token });
}

export async function workforcePost<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(WORKFORCE_API_BASE, path, 'POST', { body, token, requireAuth: false });
}

export async function workforcePatch<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(WORKFORCE_API_BASE, path, 'PATCH', { body, token, requireAuth: false });
}

export async function workforceDelete<T = unknown>(
  path: string,
  body?: object,
  token?: string,
): Promise<T | void> {
  const headers = buildAuthHeaders(token, body != null);
  const res = await fetch(`${WORKFORCE_API_BASE}${path}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  return readJsonResponse<T>(res, path);
}

// ── auth base (`/api/auth`) ──────────────────────────────────────────

export async function apiPostAuth<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(AUTH_API_BASE, path, 'POST', { body, token, requireAuth: false });
}

export async function apiPatchAuth<T>(path: string, body: object, token?: string): Promise<T> {
  return request<T>(AUTH_API_BASE, path, 'PATCH', { body, token });
}

// ── auth session flows ───────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  return apiPostAuth(authRoutes.session.passwordResetRequest, { email });
}

export async function resetPassword(token: string, password: string, passwordConfirmation: string): Promise<{ message: string }> {
  return apiPostAuth(authRoutes.session.passwordReset, {
    token,
    password,
    password_confirmation: passwordConfirmation
  });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return apiPostAuth(authRoutes.session.verifyEmail, { token });
}

export async function resendVerificationEmail(email: string): Promise<{ message: string }> {
  return apiPostAuth(authRoutes.session.resendVerification, { email });
}

export async function refreshToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  return apiPostAuth(authRoutes.session.refreshToken, { refresh_token: refreshToken });
}

export async function revokeToken(token: string): Promise<void> {
  await apiPostAuth(authRoutes.session.revoke, {}, token);
}

export interface AuthSessionResponse {
  access_token?: string;
  authToken?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: unknown;
  return_to?: string;
}

function buildAuthProxyUrl(path: string): string {
  return `${AUTH_PROXY_BASE}${path}`;
}

export async function authLogin(email: string, password: string): Promise<AuthSessionResponse> {
  const res = await fetchWithTimeout(buildAuthProxyUrl(authRoutes.proxy.login), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  return readJsonResponse<AuthSessionResponse>(res, authRoutes.errorContext.login);
}

export async function authRefresh(): Promise<AuthSessionResponse> {
  const res = await fetchWithTimeout(buildAuthProxyUrl(authRoutes.proxy.refresh), {
    method: 'POST',
    credentials: 'include',
  });
  return readJsonResponse<AuthSessionResponse>(res, authRoutes.errorContext.refresh);
}

export async function authMe(token?: string): Promise<unknown> {
  const headers = buildAuthHeaders(token, false);
  const res = await fetchWithTimeout(buildAuthProxyUrl(authRoutes.proxy.me), {
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
  const res = await fetchWithTimeout(buildAuthProxyUrl(path), {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  return readJsonResponse<unknown>(res, authRoutes.errorContext.me);
}

export async function authLogout(token?: string): Promise<void> {
  const headers = buildAuthHeaders(token);
  const res = await fetchWithTimeout(buildAuthProxyUrl(authRoutes.proxy.logout), {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(formatHttpError(authRoutes.errorContext.logout, err));
  }
}
