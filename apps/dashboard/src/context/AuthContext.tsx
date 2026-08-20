import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import {
  ACCESS_TOKEN_TTL_S,
  authAcceptInvite,
  authLogin,
  authLogout,
  authSignup,
  authTotpVerify,
  authWorkspaceSetupAcceptInvite,
  authWorkspaceSetupCreate,
  type PendingWorkspaceInvite,
  type SignupParams,
  authMe,
  authMeForTenant,
  authRefresh,
  authSwitchWorkspace,
  requestPasswordReset,
  resetPassword as resetPasswordRequest,
  setAccessTokenProvider,
  type AuthSessionResponse,
} from '../lib/api';
import { switchStaffTenant as switchStaffTenantRequest } from '../lib/staff-api';
import { UserRole, PermissionAction } from '../types/custom-db';
import {
  clearLocationHashPreservePath,
  consumeDevLocalhostAccessHashFromLocation,
  resolveTenantSubdomainFromHost,
} from '../lib/host-routing';
import { publishDashboardUserToWidget } from '../lib/widget-bridge';
import { clearAuthRetryHandlers, configureAuthRetry, jwtRemainingSeconds } from '../lib/auth-retry';
const ACCESS_TOKEN_FALLBACK_KEY = 'bokito_access_token_session';
/** When set, the auth router returned 404 for POST /refresh; skip further refresh calls until logout. */
const SKIP_SERVER_AUTH_REFRESH_KEY = 'bokito_skip_server_auth_refresh';

function shouldSkipServerAuthRefresh(): boolean {
  try {
    return sessionStorage.getItem(SKIP_SERVER_AUTH_REFRESH_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSkipServerAuthRefresh(): void {
  try {
    sessionStorage.setItem(SKIP_SERVER_AUTH_REFRESH_KEY, '1');
  } catch {
    // Ignore storage failures in private mode.
  }
}

/** Detect the `?sso=connected` return from the Microsoft SSO callback and strip
 * it from the URL. The callback set the refresh cookie, so the regular
 * cookie-based hydration below picks up the session; we just make sure a stale
 * "skip refresh" flag doesn't block it. */
function consumeSsoReturnFlag(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('sso') !== 'connected') return false;
    url.searchParams.delete('sso');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

function isMissingRefreshEndpointError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('http 404') || message.includes('unable to locate request');
}

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

type TenantRole = 'owner' | 'admin' | 'user';

interface TenantMembership {
  tenantId: string;
  slug: string;
  name: string;
  role: TenantRole;
  status: 'active' | 'invited' | 'suspended';
}

interface User {
  id: number;
  name: string;
  email: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  /** Public signature image URL used in outbound mail signatures. */
  signatureUrl: string | null;
  accountId: number | null;
  /** `user.organisation_id` (UUID); required for tenant-scoped APIs such as email. */
  organisationId: string | null;
  role: UserRole;
  isStaff: boolean;
  emailVerified: boolean;
  /** TOTP two-factor authentication enrolled and active. */
  totpEnabled: boolean;
  tenant: Tenant;
  memberships: TenantMembership[];
}

/** Thrown by `login` when the account requires a TOTP code as a second step. */
export class TwoFactorRequiredError extends Error {
  challengeToken: string;

  constructor(challengeToken: string) {
    super('Two-factor authentication required');
    this.name = 'TwoFactorRequiredError';
    this.challengeToken = challengeToken;
  }
}

/** Thrown by `login` when the account is valid but has no workspace membership
 * (e.g. an admin removed it from its last tenant). The account persists; the
 * user joins via a pending invite or creates a new workspace. */
export class WorkspaceRequiredError extends Error {
  setupToken: string;
  email: string;
  pendingInvites: PendingWorkspaceInvite[];

  constructor(setupToken: string, email: string, pendingInvites: PendingWorkspaceInvite[]) {
    super('No workspace membership');
    this.name = 'WorkspaceRequiredError';
    this.setupToken = setupToken;
    this.email = email;
    this.pendingInvites = pendingInvites;
  }
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<string>;
  /** Second login step: complete a 2FA challenge with a TOTP code. */
  verifyTotp: (challengeToken: string, code: string) => Promise<string>;
  /** No-workspace state: accept a pending invite and start a session. */
  setupAcceptInvite: (setupToken: string, inviteId: string) => Promise<string>;
  /** No-workspace state: create a new workspace and start a session. */
  setupCreateWorkspace: (setupToken: string, workspaceName: string) => Promise<string>;
  signup: (params: SignupParams) => Promise<string>;
  acceptInvite: (params: { token: string; password: string; displayName?: string }) => Promise<string>;
  logout: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  hasPermission: (action: PermissionAction) => boolean;
  setUserRole: (role: UserRole) => void;
  refreshUser: () => Promise<void>;
  patchLocalUser: (patch: Partial<Pick<User, 'name' | 'email' | 'jobTitle' | 'avatarUrl' | 'signatureUrl' | 'emailVerified' | 'totpEnabled'>>) => void;
  currentTenantRole: UserRole | null;
  hasTenantAccess: (tenantSubdomain: string) => boolean;
  isStaff: boolean;
  switchStaffTenant: (tenantId: string) => Promise<void>;
  /** Switch the session to another workspace: new JWT + full reload. */
  switchWorkspaceTenant: (tenantId: string) => Promise<void>;
  /** Adopt an access token issued out-of-band (e.g. workspace create) + full reload. */
  adoptWorkspaceSession: (accessToken: string) => void;
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

function normalizeTenantRole(value: unknown): TenantRole {
  const role = toString(value).toLowerCase();
  if (role === 'owner') return 'owner';
  if (role === 'admin') return 'admin';
  return 'user';
}

function mapTenantRoleToUserRole(role: unknown): UserRole {
  const normalized = toString(role).toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  return 'member';
}

function normalizeMemberships(payload: Record<string, unknown>): TenantMembership[] {
  const rawMemberships = Array.isArray(payload.memberships) ? payload.memberships : [];
  return rawMemberships
    .map((entry) => {
      const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      if (!row) return null;
      const tenantId = toString(row.tenant_id ?? row.tenantId ?? row.organisation_id ?? row.organization_id);
      const slug = toString(row.tenant_slug ?? row.slug).toLowerCase();
      if (!tenantId || !slug) return null;
      return {
        tenantId,
        slug,
        name: toString(row.tenant_name ?? row.name, slug),
        role: normalizeTenantRole(row.role),
        status: (toString(row.status, 'active').toLowerCase() as TenantMembership['status']),
      } satisfies TenantMembership;
    })
    .filter((membership): membership is TenantMembership => membership !== null);
}

function normalizeAuthUser(raw: unknown): User {
  const payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const memberships = normalizeMemberships(payload);
  const currentTenantRaw =
    payload.current_tenant && typeof payload.current_tenant === 'object'
      ? (payload.current_tenant as Record<string, unknown>)
      : null;
  const tenantRaw =
    currentTenantRaw ??
    (payload.tenant && typeof payload.tenant === 'object'
      ? (payload.tenant as Record<string, unknown>)
      : {});

  const avatarRaw = payload.avatar && typeof payload.avatar === 'object'
    ? (payload.avatar as Record<string, unknown>)
    : null;
  const avatarUrl = avatarRaw
    ? toString(avatarRaw.url ?? avatarRaw.path ?? avatarRaw.src ?? '')
    : typeof payload.avatar === 'string' ? toString(payload.avatar) : null;
  const signatureRaw =
    payload.signature && typeof payload.signature === 'object'
      ? (payload.signature as Record<string, unknown>)
      : null;
  const signatureUrl = toString(
    payload.signature_url ??
      payload.signatureUrl ??
      payload.user_signature_url ??
      payload.userSignatureUrl ??
      signatureRaw?.url ??
      signatureRaw?.path ??
      '',
  );

  return {
    id: toNumber(payload.id) ?? 0,
    name: toString(payload.name, 'Unknown user'),
    email: toString(payload.email),
    jobTitle: typeof payload.job_title === 'string' && payload.job_title.trim() ? payload.job_title.trim() : null,
    avatarUrl: avatarUrl || null,
    signatureUrl: signatureUrl || null,
    accountId: toNumber(payload.account_id),
    organisationId: normalizeOrganisationId(payload),
    role: mapTenantRoleToUserRole(payload.role),
    isStaff: Boolean(payload.is_staff),
    emailVerified: Boolean(payload.email_verified),
    totpEnabled: Boolean(payload.totp_enabled),
    tenant: {
      id: toNumber(tenantRaw.id),
      slug: toString(tenantRaw.slug, 'unknown'),
      name: toString(tenantRaw.name, 'Unknown'),
      logo: resolveTenantLogo(payload, tenantRaw),
    },
    memberships,
  };
}

function buildFallbackUserFromLogin(loginPayload: AuthTokens, loginEmail: string): User {
  const guessedName = loginEmail.includes('@') ? loginEmail.split('@')[0] : loginEmail;
  const lp = loginPayload as unknown as Record<string, unknown>;
  return normalizeAuthUser({
    id: loginPayload.user_id ?? loginPayload.id ?? 0,
    name: loginPayload.name ?? guessedName,
    email: loginPayload.email ?? loginEmail,
    role: mapTenantRoleToUserRole(loginPayload.role),
    is_staff: lp.is_staff,
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
  member: [
    'edit_record', 'delete_record', 'create_table'
  ]
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
      sessionStorage.removeItem(SKIP_SERVER_AUTH_REFRESH_KEY);
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
    if (!nextToken) throw new Error('No access token received');
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
    if (shouldSkipServerAuthRefresh()) return;
    try {
      const data = await authRefresh();
      const nextToken = applySession(data);
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch (err) {
      if (isMissingRefreshEndpointError(err)) {
        rememberSkipServerAuthRefresh();
        // Keep active access token session when backend refresh endpoint is not available.
        return;
      }
      clearSession();
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    refreshHandlerRef.current = refreshToken;
  }, [refreshToken]);

  // Global 401 recovery: when any API call fails with an expired access token,
  // refresh the session once via the cookie and retry; log out locally when
  // the refresh cookie is gone so route guards redirect to login instead of
  // leaving the app stuck on "Invalid token" errors.
  useEffect(() => {
    configureAuthRetry({
      refresh: async () => {
        if (shouldSkipServerAuthRefresh()) return null;
        try {
          const session = await authRefresh();
          const nextToken = applySession(session);
          try {
            const me = await authMe(nextToken);
            setUser(normalizeAuthUser(me));
          } catch {
            // Token refreshed; profile re-fetch is best effort.
          }
          return nextToken;
        } catch (err) {
          if (isMissingRefreshEndpointError(err)) rememberSkipServerAuthRefresh();
          return null;
        }
      },
      onSessionExpired: () => {
        clearSession();
      },
    });
    return () => clearAuthRetryHandlers();
  }, [applySession, clearSession]);

  useEffect(() => {
    let cancelled = false;
    async function hydrateSession() {
      setIsLoading(true);
      const tenantSubdomain = resolveTenantSubdomainFromHost();
      if (consumeSsoReturnFlag()) {
        try {
          sessionStorage.removeItem(SKIP_SERVER_AUTH_REFRESH_KEY);
        } catch {
          // Ignore storage failures in private mode.
        }
      }
      try {
        const handoffToken = consumeDevLocalhostAccessHashFromLocation();
        if (handoffToken) {
          try {
            sessionStorage.setItem(ACCESS_TOKEN_FALLBACK_KEY, handoffToken);
          } catch {
            // Ignore storage failures in private mode.
          }
          clearLocationHashPreservePath();
        }

        const storedToken = (() => {
          try {
            return sessionStorage.getItem(ACCESS_TOKEN_FALLBACK_KEY);
          } catch {
            return null;
          }
        })();

        if (storedToken) {
          try {
            const meWithStoredToken = tenantSubdomain
              ? await authMeForTenant(storedToken, tenantSubdomain)
              : await authMe(storedToken);
            if (!cancelled) {
              setToken(storedToken);
              setUser(normalizeAuthUser(meWithStoredToken));
              // Restored sessions must keep refreshing too — schedule from the
              // token's actual remaining lifetime, not the full TTL.
              scheduleRefresh(jwtRemainingSeconds(storedToken));
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

        if (tenantSubdomain && !shouldSkipServerAuthRefresh()) {
          try {
            const session = await authRefresh();
            const nextToken = applySession(session);
            const me = await authMeForTenant(nextToken, tenantSubdomain);
            if (!cancelled) setUser(normalizeAuthUser(me));
            return;
          } catch (err) {
            if (isMissingRefreshEndpointError(err)) rememberSkipServerAuthRefresh();
          }
        } else if (!shouldSkipServerAuthRefresh()) {
          try {
            const session = await authRefresh();
            const nextToken = applySession(session);
            const me = await authMe(nextToken);
            if (!cancelled) setUser(normalizeAuthUser(me));
            return;
          } catch (err) {
            if (isMissingRefreshEndpointError(err)) rememberSkipServerAuthRefresh();
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        const isUnauthorized = message.includes('401') || message.includes('403');
        if (isUnauthorized) {
          const tokenAfterRace = (() => {
            try {
              return sessionStorage.getItem(ACCESS_TOKEN_FALLBACK_KEY);
            } catch {
              return null;
            }
          })();
          if (tokenAfterRace) {
            try {
              const meRetry = tenantSubdomain
                ? await authMeForTenant(tokenAfterRace, tenantSubdomain)
                : await authMe(tokenAfterRace);
              if (!cancelled) {
                setToken(tokenAfterRace);
                setUser(normalizeAuthUser(meRetry));
                scheduleRefresh(jwtRemainingSeconds(tokenAfterRace));
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
          if (!cancelled) clearSession();
        } else {
          if (!shouldSkipServerAuthRefresh()) {
            try {
              const session = await authRefresh();
              const nextToken = applySession(session);
              const me = tenantSubdomain ? await authMeForTenant(nextToken, tenantSubdomain) : await authMe(nextToken);
              if (!cancelled) setUser(normalizeAuthUser(me));
            } catch (err) {
              if (isMissingRefreshEndpointError(err)) rememberSkipServerAuthRefresh();
              if (!cancelled) clearSession();
            }
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
  }, [applySession, clearSession, scheduleRefresh]);

  useLayoutEffect(() => {
    setAccessTokenProvider(() => token);
    return () => setAccessTokenProvider(null);
  }, [token]);

  useEffect(() => () => clearRefreshTimer(), [clearRefreshTimer]);

  const login = useCallback(async (email: string, password: string): Promise<string> => {
    const data = await authLogin(email, password) as AuthTokens;
    const raw = data as unknown as AuthSessionResponse;
    if (raw.requires_2fa && raw.challenge_token) {
      // Password was correct, but the account needs a TOTP code first.
      throw new TwoFactorRequiredError(raw.challenge_token);
    }
    if (raw.requires_workspace && raw.setup_token) {
      throw new WorkspaceRequiredError(raw.setup_token, raw.email ?? email, raw.pending_invites ?? []);
    }
    const nextToken = applySession(data);
    try {
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch {
      // Fallback: keep users signed in when /auth/me is temporarily misconfigured.
      setUser(buildFallbackUserFromLogin(data, email));
    }
    return nextToken;
  }, [applySession]);

  const verifyTotp = useCallback(async (challengeToken: string, code: string): Promise<string> => {
    const data = await authTotpVerify(challengeToken, code) as AuthTokens;
    const raw = data as unknown as AuthSessionResponse;
    if (raw.requires_workspace && raw.setup_token) {
      throw new WorkspaceRequiredError(raw.setup_token, raw.email ?? '', raw.pending_invites ?? []);
    }
    const nextToken = applySession(data);
    try {
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch {
      setUser(buildFallbackUserFromLogin(data, data.email ?? ''));
    }
    return nextToken;
  }, [applySession]);

  const completeWorkspaceSetup = useCallback(async (data: AuthTokens): Promise<string> => {
    const nextToken = applySession(data);
    try {
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch {
      setUser(buildFallbackUserFromLogin(data, data.email ?? ''));
    }
    return nextToken;
  }, [applySession]);

  const setupAcceptInvite = useCallback(async (setupToken: string, inviteId: string): Promise<string> => {
    const data = await authWorkspaceSetupAcceptInvite(setupToken, inviteId) as AuthTokens;
    return completeWorkspaceSetup(data);
  }, [completeWorkspaceSetup]);

  const setupCreateWorkspace = useCallback(async (setupToken: string, workspaceName: string): Promise<string> => {
    const data = await authWorkspaceSetupCreate(setupToken, workspaceName) as AuthTokens;
    return completeWorkspaceSetup(data);
  }, [completeWorkspaceSetup]);

  const signup = useCallback(async (params: SignupParams): Promise<string> => {
    const data = await authSignup(params) as AuthTokens;
    const nextToken = applySession(data);
    try {
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    } catch {
      setUser(buildFallbackUserFromLogin(data, params.email));
    }
    return nextToken;
  }, [applySession]);

  const acceptInvite = useCallback(
    async (params: { token: string; password: string; displayName?: string }): Promise<string> => {
      const data = await authAcceptInvite(params) as AuthTokens;
      const nextToken = applySession(data);
      try {
        const me = await authMe(nextToken);
        setUser(normalizeAuthUser(me));
      } catch {
        setUser(buildFallbackUserFromLogin(data, data.email ?? ''));
      }
      return nextToken;
    },
    [applySession],
  );

  const hasPermission = useCallback((action: PermissionAction): boolean => {
    if (!user) return false;
    const tenantSubdomain = resolveTenantSubdomainFromHost();
    const role = tenantSubdomain
      ? mapTenantRoleToUserRole(user.memberships.find((membership) => membership.slug === tenantSubdomain)?.role ?? user.role)
      : user.role;
    return ROLE_PERMISSIONS[role]?.includes(action) ?? false;
  }, [user]);

  const currentTenantRole = (() => {
    if (!user) return null;
    const tenantSubdomain = resolveTenantSubdomainFromHost();
    if (!tenantSubdomain) return user.role;
    const membership = user.memberships.find((entry) => entry.slug === tenantSubdomain);
    if (!membership) return null;
    return mapTenantRoleToUserRole(membership.role);
  })();

  const hasTenantAccess = useCallback((tenantSubdomain: string): boolean => {
    if (!user) return false;
    const normalized = tenantSubdomain.trim().toLowerCase();
    if (!normalized) return false;
    return user.memberships.some((membership) => membership.slug === normalized);
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

  const patchLocalUser = useCallback((patch: Partial<Pick<User, 'name' | 'email' | 'jobTitle' | 'avatarUrl' | 'signatureUrl' | 'emailVerified' | 'totpEnabled'>>) => {
    setUser((prev) => prev ? { ...prev, ...patch } : prev);
  }, []);

  const switchStaffTenant = useCallback(
    async (tenantId: string) => {
      if (!token) throw new Error('Not authenticated');
      const session = await switchStaffTenantRequest(tenantId, token);
      const nextToken = applySession(session);
      const me = await authMe(nextToken);
      setUser(normalizeAuthUser(me));
    },
    [applySession, token],
  );

  const adoptWorkspaceSession = useCallback((accessToken: string) => {
    try {
      sessionStorage.setItem(ACCESS_TOKEN_FALLBACK_KEY, accessToken);
    } catch {
      // Ignore storage failures in private mode.
    }
    // Full reload so every context, cache and stream reconnects scoped to the
    // new tenant. The JWT in sessionStorage is the source of truth.
    window.location.assign('/');
  }, []);

  const switchWorkspaceTenant = useCallback(
    async (tenantId: string) => {
      if (!token) throw new Error('Not authenticated');
      const session = await authSwitchWorkspace(tenantId, token);
      const nextToken = session.authToken ?? session.access_token;
      if (!nextToken) throw new Error('No access token received');
      adoptWorkspaceSession(nextToken);
    },
    [adoptWorkspaceSession, token],
  );

  useEffect(() => {
    if (!user) {
      publishDashboardUserToWidget(null);
      return;
    }
    publishDashboardUserToWidget({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    });
  }, [user]);

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
      value={{
        user,
        token,
        isLoading,
        login,
        verifyTotp,
        setupAcceptInvite,
        setupCreateWorkspace,
        signup,
        acceptInvite,
        logout,
        sendPasswordReset,
        resetPassword,
        hasPermission,
        setUserRole,
        refreshUser,
        patchLocalUser,
        currentTenantRole,
        hasTenantAccess,
        isStaff: Boolean(user?.isStaff),
        switchStaffTenant,
        switchWorkspaceTenant,
        adoptWorkspaceSession,
      }}
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
