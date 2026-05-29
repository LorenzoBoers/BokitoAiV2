export type McpTransport = 'streamable_http' | 'sse'

export type OAuthProfile = {
  supports_dcr?: boolean
  client_registration_mode?: 'dcr' | 'static'
  scopes?: string[]
  /** RFC 8707 resource indicator (e.g. Asana v2 base URL). */
  resource_parameter?: string
  authorization_endpoint?: string
  token_endpoint?: string
  revocation_endpoint?: string
}

export type ProviderOAuthInput = {
  slug: string
  mcp_remote_url: string
  mcp_transport?: McpTransport
  oauth_config_key?: string | null
  oauth_profile?: OAuthProfile | null
}

export type OAuthStartResult = {
  state_id: string
  code_verifier: string
  code_challenge: string
  authorize_url: string
  /** Set when using dynamic client registration. */
  oauth_client_id?: string
}

export type OAuthTokenResult = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
  external_account_id: string
  display_name: string
  metadata?: Record<string, unknown>
}

export type ProtectedResourceMetadata = {
  resource?: string
  authorization_servers?: string[]
  bearer_methods_supported?: string[]
}

export type AuthorizationServerMetadata = {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  revocation_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
}
