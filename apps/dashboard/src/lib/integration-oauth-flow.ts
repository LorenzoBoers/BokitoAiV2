import { startOAuthConnection } from './email-api'
import { startGithubOAuth } from './github-api'
import {
  getRegistryEntryByPlatformSlug,
  getRegistryEntryByStaticId,
  type IntegrationOAuthStrategy,
  type ProviderRegistryEntry,
} from './integrations/registry'
import { startIntegrationOAuth } from './integrations-api'

export async function startProviderOAuth(
  entry: ProviderRegistryEntry,
  returnUrl: string,
  options?: { authToken?: string | null; projectId?: string },
): Promise<string> {
  const strategy = entry.oauthStrategy
  if (!strategy) {
    throw new Error('OAuth is not configured for this provider.')
  }

  switch (strategy) {
    case 'github': {
      const { authorize_url } = await startGithubOAuth(returnUrl, options?.projectId)
      return authorize_url
    }
    case 'inbox': {
      const provider = entry.inboxOAuthProvider
      if (!provider) {
        throw new Error('Inbox OAuth provider is not configured.')
      }
      const token = options?.authToken
      if (!token) {
        throw new Error('LOGIN_REQUIRED')
      }
      return startOAuthConnection(token, provider, returnUrl)
    }
    case 'platform': {
      const { authorize_url } = await startIntegrationOAuth(
        entry.platformSlug,
        returnUrl,
        options?.projectId,
      )
      return authorize_url
    }
    default: {
      const _exhaustive: never = strategy
      throw new Error(`Unsupported OAuth strategy: ${String(_exhaustive)}`)
    }
  }
}

export function oauthStrategyForSlug(platformSlug: string): IntegrationOAuthStrategy | undefined {
  return getRegistryEntryByPlatformSlug(platformSlug)?.oauthStrategy
}

export function inboxOAuthProviderForStaticId(staticId: string) {
  return getRegistryEntryByStaticId(staticId)?.inboxOAuthProvider
}
