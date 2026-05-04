import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { TOKEN_KEY, xanoGet, xanoPost } from '../lib/xano';
import { UserRole, PermissionAction } from '../types/custom-db';

const REFRESH_TOKEN_KEY = 'bokito_refresh_token';

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  authToken?: string;
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
  logout: () => void;
  hasPermission: (action: PermissionAction) => boolean;
  setUserRole: (role: UserRole) => void; // Dev tool for testing
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

  return {
    id: toNumber(payload.id) ?? 0,
    name: toString(payload.name, 'Onbekende gebruiker'),
    email: toString(payload.email),
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
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refreshToken = useCallback(async () => {
    const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refresh) {
      logout();
      return;
    }

    try {
      const data = await xanoPost<AuthTokens>('/auth/refresh', { refresh_token: refresh });
      const nextToken = data.authToken ?? data.access_token;
      if (!nextToken) throw new Error('Geen access token ontvangen');
      localStorage.setItem(TOKEN_KEY, nextToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      setToken(nextToken);
    } catch {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    xanoGet<unknown>('/auth/me', token)
      .then((me) => setUser(normalizeAuthUser(me)))
      .catch(async () => {
        // Try to refresh token before logging out
        try {
          await refreshToken();
        } catch {
          logout();
        }
      })
      .finally(() => setIsLoading(false));
  }, [token, logout, refreshToken]);

  // Auto-refresh token every 14 minutes (access token expires in 15 minutes)
  useEffect(() => {
    if (!token) return;

    const interval = setInterval(() => {
      refreshToken();
    }, 14 * 60 * 1000);

    return () => clearInterval(interval);
  }, [token, refreshToken]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await xanoPost<AuthTokens>('/auth/login', { email, password });
    // Xano standard auth returns `authToken`; OAuth-style returns `access_token`
    const token = data.authToken ?? data.access_token;
    if (!token) throw new Error('Geen token ontvangen van de server');
    localStorage.setItem(TOKEN_KEY, token);
    if (data.refresh_token) {
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    }
    setToken(token);
    try {
      const me = await xanoGet<unknown>('/auth/me', token);
      setUser(normalizeAuthUser(me));
    } catch {
      // Fallback: keep users signed in when /auth/me is temporarily misconfigured.
      setUser(buildFallbackUserFromLogin(data, email));
    }
  }, []);

  const hasPermission = useCallback((action: PermissionAction): boolean => {
    if (!user) return false;
    return ROLE_PERMISSIONS[user.role]?.includes(action) ?? false;
  }, [user]);

  // Dev tool for testing role changes
  const setUserRole = useCallback((role: UserRole) => {
    if (user) {
      setUser({ ...user, role });
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, hasPermission, setUserRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
