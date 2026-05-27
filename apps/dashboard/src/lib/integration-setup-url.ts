/** @deprecated Import from `integrations/registry` — re-exported for existing call sites. */
export {
  SLUG_TO_STATIC_ID,
  STATIC_ID_TO_SLUG,
} from './integrations/registry'

export type IntegrationHubStep = 'detail' | 'setup'

export function buildIntegrationSetupReturnUrl(integrationId: string): string {
  const params = new URLSearchParams({
    connect: integrationId,
    step: 'detail',
  })
  return `${window.location.origin}/integrations/marketplace?${params.toString()}`
}

export function parseHubConnectParam(searchParams: URLSearchParams): {
  integrationId: string | null
  step: IntegrationHubStep
} {
  const connect = searchParams.get('connect')?.trim() || null
  const stepRaw = searchParams.get('step')
  const step: IntegrationHubStep = stepRaw === 'setup' ? 'setup' : 'detail'
  return { integrationId: connect, step }
}

const OAUTH_CALLBACK_KEYS = [
  'integration',
  'integration_error',
  'provider',
  'github',
  'github_error',
  'oauth_provider',
  'oauth_status',
  'oauth_error',
  'oauth_detail',
  'aad_detail',
  'outlook',
  'outlook_error',
] as const

/** Remove OAuth callback query keys while preserving hub `connect` / `step` / `kind`. */
export function stripOAuthCallbackParams(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  for (const key of OAUTH_CALLBACK_KEYS) {
    next.delete(key)
  }
  return next
}
