/**
 * Relative paths on the auth API group base (`AUTH_API_BASE` / `AUTH_API_BASE`).
 * Mirrors previous literals in `lib/api.ts` and profile/workspace calls.
 */
export const authRoutes = {
  session: {
    passwordResetRequest: '/password-reset-request',
    passwordReset: '/password-reset',
    verifyEmail: '/verify-email',
    resendVerification: '/resend-verification',
    refreshToken: '/refresh',
    revoke: '/revoke',
    switchWorkspace: '/switch-workspace',
  },
  sso: {
    microsoftStart: '/microsoft/start',
  },
  proxy: {
    login: '/login',
    signup: '/signup',
    refresh: '/refresh',
    me: '/me',
    logout: '/logout',
    acceptInvite: '/accept-invite',
    inviteInfo: '/invite-info',
  },
  errorContext: {
    login: '/auth/login',
    signup: '/auth/signup',
    refresh: '/auth/refresh',
    me: '/auth/me',
    logout: '/auth/logout',
    microsoftStart: '/auth/microsoft/start',
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
    deleteAccount: '/delete-account',
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
