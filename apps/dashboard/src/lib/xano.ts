export const XANO_BASE_URL = 'https://xrex-nmji-j9ur.f2.xano.io';
export const XANO_AUTH_API = `${XANO_BASE_URL}/api:DavdZOps`;

export const TOKEN_KEY = 'bokito_auth_token';

function formatXanoHttpError(path: string, body: unknown): string {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const msg = typeof o.message === 'string' ? o.message : 'Onbekende fout'
  const payload = o.payload && typeof o.payload === 'object' ? (o.payload as Record<string, unknown>) : null
  const param = payload && typeof payload.param === 'string' ? payload.param : null
  const hint = param ? ` (${param})` : ''
  return `${msg}${hint} [${path}]`
}

export async function xanoPost<T>(path: string, body: object, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }));
    throw new Error(formatXanoHttpError(path, err));
  }

  return res.json();
}

export async function xanoGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }));
    throw new Error(formatXanoHttpError(path, err));
  }

  return res.json();
}

export async function xanoDelete<T = unknown>(path: string, token: string): Promise<T | void> {
  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
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

export async function xanoPatch<T>(path: string, body: object, token: string): Promise<T> {
  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Onbekende fout' }))
    throw new Error(err.message || `HTTP ${res.status}`)
  }

  return res.json()
}

export async function xanoPut<T>(path: string, body: object, token: string): Promise<T> {
  const res = await fetch(`${XANO_AUTH_API}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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
  return xanoPost('/auth/password-reset-request', { email });
}

export async function resetPassword(token: string, password: string, passwordConfirmation: string): Promise<{ message: string }> {
  return xanoPost('/auth/password-reset', { 
    token, 
    password, 
    password_confirmation: passwordConfirmation 
  });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return xanoPost('/auth/verify-email', { token });
}

export async function resendVerificationEmail(email: string): Promise<{ message: string }> {
  return xanoPost('/auth/resend-verification', { email });
}

export async function refreshToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  return xanoPost('/auth/refresh', { refresh_token: refreshToken });
}

export async function revokeToken(token: string): Promise<void> {
  await xanoPost('/auth/revoke', {}, token);
}
