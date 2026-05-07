import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  ACCESS_TOKEN_TTL_S,
  authLogin,
  authLogout,
  authMe,
  authRefresh,
  requestPasswordReset,
  resetPassword as resetPasswordRequest,
  setAccessTokenProvider,
  type AuthSessionResponse,
} from '../lib/xano';
import { UserRole, PermissionAction } from '../types/custom-db';

const ACCESS_TOKEN_FALLBACK_KEY = 'bokito_access_token_session';

interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  authToken?: string;
  expires_in?: number;
  user_id?: number | string;
  id?: number | string;
  name?: string;
  email?: string;
  role?: string;
  account_id?: number | string | null;
  tenant?: unknown;
}

interface Tenant {
  id: number | null;
  slug: string;
  name: string;
  /** Public URL for tenant/company branding (from auth/me when provided). */
  logo: string | null;
}

interface User {
  id: number;
  name: string;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  accountId: number | null;
  /** Xano `user.organisation_id` (UUID); required for tenant-scoped APIs such as email. */
  organisationId: string | null;
  role: UserRole;
  tenant: Tenant;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  hasPermission: (action: PermissionAction) => boolean;
  setUserRole: (role: UserRole) => void;
  refreshUser: () => Promise<void>;
  patchLocalUser: (patch: Partial<Pick<User, 'name' | 'email' | 'jobTitle' | 'avatarUrl'>>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const LOGO_FIELD_KEYS = ['logo_url', 'logo', 'image_url', 'company_logo', 'brand_logo'] as const;

function pickLogoFromRecord(record: Record<string, unknown> | undefined): string | null {
  if (!record) return null;
  for (const key of LOGO_FIELD_KEYS) {
    const v = record[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function resolveTenantLogo(payload: Record<string, unknown>, tenantRaw: Record<string, unknown>): string | null {
  const account =
    payload.account && typeof payload.account === 'object'
      ? (payload.account as Record<string, unknown>)
      : undefined;
  const organisation =
    payload.organisation && typeof payload.organisation === 'object'
      ? (payload.organisation as Record<string, unknown>)
      : undefined;
  const organization =
    payload.organization && typeof payload.organization === 'object'
      ? (payload.organization as Record<string, unknown>)
      : undefined;

  return (
    pickLogoFromRecord(tenantRaw) ??
    pickLogoFromRecord(account) ??
    pickLogoFromRecord(organisation) ??
    pickLogoFromRecord(organization)
  );
}

function normalizeOrganisationId(payload: Record<string, unknown>): string | null {
  const direct =
    payload.organisation_id ?? payload.organization_id ?? payload.organisationId ?? payload.organizationId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct);
  return null;
}

function normalizeAuthUser(raw: unknown): User {
  const payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const tenantRaw =
    payload.tenant && typeof payload.tenant === 'object'
      ? (payload.tenant as Record<string, unknown>)
      : {};

  const avatarRaw = payload.avatar && typeof payload.avatar === 'object'
    ? (payload.avatar as Record<string, unknown>)
    : null;
  const avatarUrl = avatarRaw
    ? toString(avatarRaw.url ?? avatarRaw.path ?? avatarRaw.src ?? '')
    : typeof payload.avatar === 'string' ? toString(payload.avatar) : null;

  return {
    id: toNumber(payload.id) ?? 0,
    name: toString(payload.name, 'Onbekende gebruiker'),
    email: toString(payload.email),
    jobTitle: typeof payload.job_title === 'string' && payload.job_title.trim() ? payload.job_title.trim() : null,
    avatarUrl: avatarUrl || null,
    accountId: toNumber(payload.account_id),
    organisationId: normalizeOrganisationId(payload),
    role: (toString(payload.role) as UserRole) || 'viewer',
    tenant: {
      id: toNumber(tenantRaw.id),
      slug: toString(tenantRaw.slug, 'unknown'),
      name: toString(tenantRaw.name, 'Onbekend'),
      logo: resolveTenantLogo(payload, tenantRaw),
    },
  };
}

function buildFallbackUserFromLogin(loginPayload: AuthTokens, loginEmail: string): User {
  const guessedName = loginEmail.includes('@') ? loginEmail.split('@')[0] : loginEmail;
  const lp = loginPayload as Record<string, unknown>;
  return normalizeAuthUser({
    id: loginPayload.user_id ?? loginPayload.id ?? 0,
    name: loginPayload.name ?? guessedName,
    email: loginPayload.email ?? loginEmail,
    role: loginPayload.role ?? 'viewer',
    account_id: loginPayload.account_id ?? null,
    organisation_id: lp.organisation_id ?? lp.organization_id,
    tenant: loginPayload.tenant ?? {},
  });
}

// Permission matrix: what each role can do
const ROLE_PERMISSIONS: Record<UserRole, PermissionAction[]> = {
  owner: [
    'edit_record', 'delete_record', 'create_table', 'edit_schema',
    'manage_api_keys', 'manage_webhooks', 'delete_workspace', 
    'invite_members', 'view_audit_log'
  ],
  admin: [
    'edit_record', 'delete_record', 'create_table', 'edit_schema',
    'manage_api_keys', 'manage_webhooks', 'invite_members', 'view_audit_log'
  ],
  editor: [
    'edit_record', 'delete_record', 'create_table', 'edit_schema'
  ],
  viewer: []
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<number | null>(null);
  const refreshHandlerRef = useRef<() => Promise<void>>(async () => {});

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  }, []);

  const clearSession = useCallback(() => {
    clearRefreshTimer();
    try {
      sessionStorage.removeItem(ACCESS_TOKEN_FALLBACK_KEY);
    } catch {
      // Ignore storage failures in private mode.
    }
    setToken(null);
    setUser(null);
  }, [clearRefreshTimer]);

  const scheduleRefresh = useCallback((expiresInSeconds?: number) => {
    clearRefreshTimer();
    const ttl = Number.isFinite(expiresInSeconds) && (expiresInSeconds as number) > 0
      ? (expiresInSeconds as number)
      : ACCESS_TOKEN_TTL_S;
    const refreshInMs = Math.max((ttl - 300) * 1000, 30_000);
    refreshTimeoutRef.current = window.setTimeout(() => {
      void refreshHandlerRef.current();
    }, refreshInMs);
  }, [clearRefreshTimer]);

  const applySession = useCallback((session: AuthSessionResponse) => {
    const nextToken = session.authToken ?? session.access_token;
    if (!nextToken) throw new Error('Geen access token ontvangen');
    try {
      sessionStorage.setItem(ACCESS_TOKEN_FALLBACK_KEY, nextToken);
    } catch {
      // Ignore storage failures in private mode.
    }
    setToken(nextToken);
    scheduleRefresh(session.expires_in);
    return nextToken;
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    try {
      await authLogout(token ?? undefined);
    } catch {
      // Server-side logout is best effort; we still clear local auth state.
    } finally {
      clearSession();
    }
  }, [clearSession, token]);

  const refreshToken = useCallback(async () => {
    try {
      const data = await authRefresh();
      const nextToken = applySession(data);
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : '';
      const isMissingRefreshEndpoint = message.includes('http 404') || message.includes('unable to locate request');
      if (isMissingRefreshEndpoint) {
        // Keep active access token session when backend refresh endpoint is not available.
        return;
      }
      clearSession();
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    refreshHandlerRef.current = refreshToken;
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateSession() {
      setIsLoading(true);
      try {
        const storedToken = (() => {
          try {
            return sessionStorage.getItem(ACCESS_TOKEN_FALLBACK_KEY);
          } catch {
            return null;
          }
        })();

        if (storedToken) {
          try {
            const meWithStoredToken = await authMe(storedToken);
            if (!cancelled) {
              setToken(storedToken);
              setUser(normalizeAuthUser(meWithStoredToken));
            }
            return;
          } catch {
            try {
              sessionStorage.removeItem(ACCESS_TOKEN_FALLBACK_KEY);
            } catch {
              // Ignore storage failures in private mode.
            }
          }
        }

        const me = await authMe();
        if (!cancelled) {
          setUser(normalizeAuthUser(me));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        const isUnauthorized = message.includes('401') || message.includes('403') || message.includes('niet geauthenticeerd');
        if (isUnauthorized) {
          if (!cancelled) clearSession();
        } else {
          try {
            const session = await authRefresh();
            const nextToken = applySession(session);
            const me = await authMe(nextToken);
            if (!cancelled) setUser(normalizeAuthUser(me));
          } catch {
            if (!cancelled) clearSession();
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void hydrateSession();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  useEffect(() => {
    setAccessTokenProvider(() => token);
    return () => setAccessTokenProvider(null);
  }, [token]);

  useEffect(() => () => clearRefreshTimer(), [clearRefreshTimer]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authLogin(email, password) as AuthTokens;
    const nextToken = applySession(data);
    try {
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch {
      // Fallback: keep users signed in when /auth/me is temporarily misconfigured.
      setUser(buildFallbackUserFromLogin(data, email));
    }
  }, [applySession]);

  const hasPermission = useCallback((action: PermissionAction): boolean => {
    if (!user) return false;
    return ROLE_PERMISSIONS[user.role]?.includes(action) ?? false;
  }, [user]);

  const sendPasswordReset = useCallback(async (email: string) => {
    await requestPasswordReset(email);
  }, []);

  const resetPassword = useCallback(async (resetToken: string, password: string) => {
    await resetPasswordRequest(resetToken, password, password);
  }, []);

  const setUserRole = useCallback((role: UserRole) => {
    if (user) setUser({ ...user, role });
  }, [user]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const me = await authMe(token);
      setUser(normalizeAuthUser(me));
    } catch {
      // Silently ignore; stale user data is better than a broken session.
    }
  }, [token]);

  const patchLocalUser = useCallback((patch: Partial<Pick<User, 'name' | 'email' | 'jobTitle' | 'avatarUrl'>>) => {
    setUser((prev) => prev ? { ...prev, ...patch } : prev);
  }, []);

  // Re-check /me when token changes unexpectedly and user is empty.
  useEffect(() => {
    if (!token || user) return;
    authMe(token)
      .then((me) => setUser(normalizeAuthUser(me)))
      .catch(async () => {
        try {
          await refreshToken();
        } catch {
          clearSession();
        }
      });
  }, [clearSession, refreshToken, token, user]);

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, login, logout, sendPasswordReset, resetPassword, hasPermission, setUserRole, refreshUser, patchLocalUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
