export type StaticClientCredentials = {
  client_id: string
  client_secret: string
  redirect_uri: string
}

export function oauthEnvPrefix(oauthConfigKey: string | null | undefined, slug: string): string {
  if (oauthConfigKey?.trim()) return oauthConfigKey.trim().toUpperCase()
  return slug.replace(/[^a-z0-9]+/gi, '_').toUpperCase()
}

export function loadStaticClientCredentials(prefix: string): StaticClientCredentials | null {
  const client_id = process.env[`${prefix}_CLIENT_ID`]?.trim()
  const client_secret = process.env[`${prefix}_CLIENT_SECRET`]?.trim()
  const redirect_uri = process.env[`${prefix}_REDIRECT_URI`]?.trim()
  if (!client_id || !client_secret || !redirect_uri) return null
  return { client_id, client_secret, redirect_uri }
}

export function globalMcpOAuthRedirectUri(): string {
  return (
    process.env.MCP_OAUTH_CALLBACK_URL?.trim() ||
    process.env.BOKITO_MCP_OAUTH_CALLBACK_URL?.trim() ||
    ''
  )
}
