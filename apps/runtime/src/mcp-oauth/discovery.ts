import type { AuthorizationServerMetadata, ProtectedResourceMetadata } from './types.js'

function resourceOrigin(resourceUrl: string): string {
  const u = new URL(resourceUrl)
  return u.origin
}

function wellKnownResourceUrl(resourceUrl: string): string {
  const u = new URL(resourceUrl)
  const base = `${u.origin}${u.pathname.replace(/\/mcp\/?$/, '').replace(/\/$/, '')}`
  return `${base}/.well-known/oauth-protected-resource`
}

export async function fetchProtectedResourceMetadata(
  mcpRemoteUrl: string,
): Promise<ProtectedResourceMetadata | null> {
  const candidates = [
    wellKnownResourceUrl(mcpRemoteUrl),
    `${resourceOrigin(mcpRemoteUrl)}/.well-known/oauth-protected-resource`,
  ]
  for (const url of [...new Set(candidates)]) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) continue
      return (await res.json()) as ProtectedResourceMetadata
    } catch {
      continue
    }
  }
  return null
}

export async function fetchAuthorizationServerMetadata(
  authorizationServer: string,
): Promise<AuthorizationServerMetadata | null> {
  const base = authorizationServer.replace(/\/+$/, '')
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) continue
      return (await res.json()) as AuthorizationServerMetadata
    } catch {
      continue
    }
  }
  return null
}
