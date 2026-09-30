import { authRoutes } from '../api/routes/auth.routes'
import { apiDeleteAuth, apiGetAuth } from './api'

export type SsoProviderId = 'google' | 'microsoft'

export type SsoProviderStatus = {
  id: SsoProviderId
  linked: boolean
  email: string
  configured: boolean
}

export type SsoIdentitiesPayload = {
  has_password: boolean
  providers: SsoProviderStatus[]
}

export async function getSsoIdentities(token: string): Promise<SsoIdentitiesPayload> {
  return apiGetAuth<SsoIdentitiesPayload>(authRoutes.sso.identities, token)
}

export async function startSsoLink(
  token: string,
  provider: SsoProviderId,
  returnUrl: string,
): Promise<{ authorize_url: string }> {
  const path = `${authRoutes.sso.linkStart(provider)}?return_url=${encodeURIComponent(returnUrl)}`
  return apiGetAuth<{ authorize_url: string }>(path, token)
}

export async function unlinkSsoProvider(
  token: string,
  provider: SsoProviderId,
): Promise<SsoIdentitiesPayload> {
  const result = await apiDeleteAuth<SsoIdentitiesPayload>(authRoutes.sso.unlink(provider), token)
  if (!result) {
    throw new Error('Unlink failed')
  }
  return result
}
