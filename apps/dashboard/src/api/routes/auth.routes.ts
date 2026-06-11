/**
 * Relative paths on the auth API group base (`AUTH_API_BASE` / `AUTH_API_BASE`).
 * Mirrors previous literals in `lib/api.ts` and profile/workspace calls.
 */
export const authRoutes = {
  session: {
    passwordResetRequest: '/auth/password-reset-request',
    passwordReset: '/auth/password-reset',
    verifyEmail: '/auth/verify-email',
    resendVerification: '/auth/resend-verification',
    refreshToken: '/auth/refresh',
    revoke: '/auth/revoke',
  },
  proxy: {
    login: '/login',
    refresh: '/refresh',
    me: '/me',
    logout: '/logout',
  },
  errorContext: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    me: '/auth/me',
    logout: '/auth/logout',
  },
  meWithTenantQuery(tenantSubdomain: string): string {
    const q = `tenant_subdomain=${encodeURIComponent(tenantSubdomain)}`
    return `/me?${q}`
  },
  users: {
    meAvatar: '/users/me/avatar',
    avatarLegacy: '/avatar',
  },
  profile: {
    patch: '/profile',
    changePassword: '/change-password',
  },
  workspaceBranding(workspaceId: number | string): string {
    return `/workspaces/${workspaceId}/branding`
  },
  staff: {
    login: '/staff-login',
    switchTenant: '/switch-tenant',
    tenants: '/tenants',
  },
} as const
