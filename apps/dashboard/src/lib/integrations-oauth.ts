export interface IntegrationCallbackResult {
  handled: boolean
  connected: boolean
  provider: string | null
  error: string | null
}

/** Parse ?integration=connected&provider=github or legacy ?github=connected */
export function parseIntegrationCallback(params: URLSearchParams): IntegrationCallbackResult {
  const integration = params.get('integration')
  const integrationError = params.get('integration_error')
  const provider = params.get('provider')

  if (integrationError) {
    return {
      handled: true,
      connected: false,
      provider: provider ?? null,
      error: integrationError,
    }
  }

  if (integration === 'connected') {
    return {
      handled: true,
      connected: true,
      provider: provider ?? 'github',
      error: null,
    }
  }

  const github = params.get('github')
  const githubError = params.get('github_error')
  if (githubError) {
    return {
      handled: true,
      connected: false,
      provider: 'github',
      error: githubError,
    }
  }
  if (github === 'connected') {
    return {
      handled: true,
      connected: true,
      provider: 'github',
      error: null,
    }
  }

  return { handled: false, connected: false, provider: null, error: null }
}
