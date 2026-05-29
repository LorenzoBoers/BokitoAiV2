import { fetchAuthorizationServerMetadata, fetchProtectedResourceMetadata } from './discovery.js'
import { generatePkce, randomStateId } from './pkce.js'
import {
  globalMcpOAuthRedirectUri,
  loadStaticClientCredentials,
  oauthEnvPrefix,
} from './env.js'
import type {
  AuthorizationServerMetadata,
  OAuthProfile,
  OAuthStartResult,
  OAuthTokenResult,
  ProviderOAuthInput,
} from './types.js'

type ResolvedOAuthEndpoints = {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes: string[]
}

async function resolveEndpoints(
  provider: ProviderOAuthInput,
): Promise<ResolvedOAuthEndpoints> {
  const profile = provider.oauth_profile ?? {}
  if (profile.authorization_endpoint && profile.token_endpoint) {
    return {
      authorization_endpoint: profile.authorization_endpoint,
      token_endpoint: profile.token_endpoint,
      registration_endpoint: undefined,
      scopes: profile.scopes ?? [],
    }
  }

  const prm = await fetchProtectedResourceMetadata(provider.mcp_remote_url)
  const asUrls = prm?.authorization_servers ?? []
  const asUrl = asUrls[0]
  if (!asUrl) {
    throw new Error('Could not discover authorization server for MCP resource.')
  }

  const meta = await fetchAuthorizationServerMetadata(asUrl)
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
    throw new Error('Authorization server metadata missing required endpoints.')
  }

  return {
    authorization_endpoint: meta.authorization_endpoint,
    token_endpoint: meta.token_endpoint,
    registration_endpoint: meta.registration_endpoint,
    scopes: profile.scopes?.length ? profile.scopes : (meta.scopes_supported ?? []),
  }
}

function scopeString(scopes: string[]): string {
  return scopes.filter(Boolean).join(' ')
}

export async function buildMcpOAuthStart(
  provider: ProviderOAuthInput,
  options?: { state_id?: string },
): Promise<OAuthStartResult> {
  const redirectUri = globalMcpOAuthRedirectUri()
  if (!redirectUri) {
    throw new Error('MCP_OAUTH_CALLBACK_URL is not configured on runtime.')
  }

  const endpoints = await resolveEndpoints(provider)
  const { verifier, challenge } = generatePkce()
  const stateId = options?.state_id ?? randomStateId()
  const prefix = oauthEnvPrefix(provider.oauth_config_key, provider.slug)
  const profile = provider.oauth_profile ?? {}
  const useDcr =
    profile.client_registration_mode === 'dcr' ||
    (profile.supports_dcr !== false && profile.client_registration_mode !== 'static')

  let clientId: string
  let dcrClientId: string | undefined
  if (useDcr && endpoints.registration_endpoint) {
    const regRes = await fetch(endpoints.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Bokito Platform',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    })
    if (!regRes.ok) {
      const body = await regRes.text()
      throw new Error(`Dynamic client registration failed: ${regRes.status} ${body}`)
    }
    const reg = (await regRes.json()) as { client_id?: string }
    if (!reg.client_id) throw new Error('DCR response missing client_id.')
    clientId = reg.client_id
    dcrClientId = reg.client_id
  } else {
    const creds = loadStaticClientCredentials(prefix)
    if (!creds) {
      throw new Error(
        `OAuth client not configured for ${provider.slug}. Set ${prefix}_CLIENT_ID, _CLIENT_SECRET, _REDIRECT_URI.`,
      )
    }
    clientId = creds.client_id
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: stateId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const scope = scopeString(endpoints.scopes)
  if (scope) params.set('scope', scope)

  if (profile.resource_parameter) {
    params.set('resource', profile.resource_parameter)
  } else {
    try {
      const u = new URL(provider.mcp_remote_url)
      const resourceBase = `${u.origin}${u.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')}`
      if (profile.client_registration_mode === 'static' && provider.slug.includes('asana')) {
        params.set('resource', resourceBase || provider.mcp_remote_url)
      }
    } catch {
      /* ignore */
    }
  }

  const authorizeUrl = `${endpoints.authorization_endpoint}?${params.toString()}`

  return {
    state_id: stateId,
    code_verifier: verifier,
    code_challenge: challenge,
    authorize_url: authorizeUrl,
    oauth_client_id: dcrClientId,
  }
}

export async function exchangeMcpOAuthCode(input: {
  provider: ProviderOAuthInput
  code: string
  code_verifier: string
  oauth_client_id?: string
}): Promise<OAuthTokenResult> {
  const redirectUri = globalMcpOAuthRedirectUri()
  if (!redirectUri) throw new Error('MCP_OAUTH_CALLBACK_URL is not configured.')

  const endpoints = await resolveEndpoints(input.provider)
  const prefix = oauthEnvPrefix(input.provider.oauth_config_key, input.provider.slug)
  const creds = loadStaticClientCredentials(prefix)

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUri,
    code_verifier: input.code_verifier,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }

  if (creds) {
    body.set('client_id', creds.client_id)
    body.set('client_secret', creds.client_secret)
    const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64')
    headers.Authorization = `Basic ${basic}`
  } else if (input.oauth_client_id) {
    body.set('client_id', input.oauth_client_id)
  }

  const tokenRes = await fetch(endpoints.token_endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`)
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }

  if (!tokenJson.access_token) throw new Error('Token response missing access_token.')

  const expiresAt =
    tokenJson.expires_in != null
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : undefined

  const externalId = `mcp_${input.provider.slug}_${hashToken(tokenJson.access_token)}`
  const displayName = input.provider.slug.replace(/_/g, ' ')

  return {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_in: tokenJson.expires_in,
    token_type: tokenJson.token_type ?? 'Bearer',
    scope: tokenJson.scope,
    external_account_id: externalId,
    display_name: displayName,
    metadata: {
      scopes: tokenJson.scope,
      expires_at: expiresAt,
      mcp_remote_url: input.provider.mcp_remote_url,
      mcp_transport: input.provider.mcp_transport ?? 'streamable_http',
      token_type: tokenJson.token_type ?? 'Bearer',
    },
  }
}

export async function refreshMcpOAuthToken(input: {
  provider: ProviderOAuthInput
  refresh_token: string
}): Promise<OAuthTokenResult> {
  const endpoints = await resolveEndpoints(input.provider)
  const prefix = oauthEnvPrefix(input.provider.oauth_config_key, input.provider.slug)
  const creds = loadStaticClientCredentials(prefix)

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refresh_token,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }

  if (creds) {
    body.set('client_id', creds.client_id)
    body.set('client_secret', creds.client_secret)
    const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64')
    headers.Authorization = `Basic ${basic}`
  }

  const tokenRes = await fetch(endpoints.token_endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  })

  if (!tokenRes.ok) {
    throw new Error(`Token refresh failed: ${tokenRes.status}`)
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }

  if (!tokenJson.access_token) throw new Error('Refresh response missing access_token.')

  const expiresAt =
    tokenJson.expires_in != null
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : undefined

  return {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token ?? input.refresh_token,
    expires_in: tokenJson.expires_in,
    token_type: tokenJson.token_type ?? 'Bearer',
    scope: tokenJson.scope,
    external_account_id: `mcp_${input.provider.slug}`,
    display_name: input.provider.slug,
    metadata: {
      scopes: tokenJson.scope,
      expires_at: expiresAt,
      mcp_remote_url: input.provider.mcp_remote_url,
    },
  }
}

function hashToken(token: string): string {
  let h = 0
  for (let i = 0; i < token.length; i++) {
    h = (h << 5) - h + token.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(16)
}

export function providerInputFromRow(row: {
  slug: string
  mcp_remote_url?: string | null
  mcp_transport?: string | null
  oauth_config_key?: string | null
  oauth_profile?: OAuthProfile | null
}): ProviderOAuthInput {
  if (!row.mcp_remote_url?.trim()) {
    throw new Error(`Provider ${row.slug} has no mcp_remote_url.`)
  }
  return {
    slug: row.slug,
    mcp_remote_url: row.mcp_remote_url.trim(),
    mcp_transport: (row.mcp_transport as ProviderOAuthInput['mcp_transport']) ?? 'streamable_http',
    oauth_config_key: row.oauth_config_key,
    oauth_profile: row.oauth_profile ?? undefined,
  }
}
