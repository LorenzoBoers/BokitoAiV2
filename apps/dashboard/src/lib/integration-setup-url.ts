/** @deprecated Import from `integrations/registry` — re-exported for existing call sites. */
export {
  SLUG_TO_STATIC_ID,
  STATIC_ID_TO_SLUG,
} from './integrations/registry'

export type IntegrationHubStep = 'detail' | 'setup'

export function moduleSetupPath(
  slug: string,
  connect?: string | null,
  step?: IntegrationHubStep,
  tab?: 'overview' | 'connections' | 'sources' | 'setup' | null,
): string {
  const base = `/modules/${encodeURIComponent(slug)}`
  const params = new URLSearchParams()
  if (tab && tab !== 'overview') params.set('tab', tab)
  const packageSlug = connect?.trim()
  if (packageSlug) {
    params.set('connect', packageSlug)
    if (step === 'setup') params.set('step', 'setup')
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

export function isModuleSetupAction(actionType?: string | null): boolean {
  return actionType === 'setup_integration' || actionType === 'enable_module'
}

export function setupIntegrationHref(input: {
  module?: string | null
  provider?: string | null
}): string {
  const moduleSlug = input.module?.trim()
  const provider = input.provider?.trim()
  if (moduleSlug) return moduleSetupPath(moduleSlug, provider, provider ? 'setup' : undefined)
  if (provider) return `/settings/marketplace?connect=${encodeURIComponent(provider)}`
  return '/settings/marketplace'
}

export function buildIntegrationSetupReturnUrl(integrationId: string): string {
  const params = new URLSearchParams({
    connect: integrationId,
    step: 'detail',
  })
  const path = window.location.pathname
  const base = path.startsWith('/modules/') ? path : '/settings/marketplace'
  return `${window.location.origin}${base}?${params.toString()}`
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
