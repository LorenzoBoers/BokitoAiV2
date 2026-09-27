/** Relative paths on `APP_API_BASE` for the MCP OAuth authorization server. */

export const oauthRoutes = {
  consentContext: (requestId: string) =>
    `/oauth/consent-context?request_id=${encodeURIComponent(requestId)}`,
  consent: '/oauth/consent',
  deny: '/oauth/deny',
  register: '/oauth/register',
  authorize: '/oauth/authorize',
  token: '/oauth/token',
  revoke: '/oauth/revoke',
  grants: '/oauth/grants',
  revokeGrant: (clientId: string, tenantId: string) =>
    `/oauth/grants/${encodeURIComponent(clientId)}/${encodeURIComponent(tenantId)}`,
}
