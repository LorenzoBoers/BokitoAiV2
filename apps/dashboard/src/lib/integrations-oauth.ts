export interface IntegrationCallbackResult {
  handled: boolean
  connected: boolean
  provider: string | null
  error: string | null
  /** The login belonged to an account that was already connected; tokens were refreshed on it. */
  reused: boolean
}

/** Parse ?integration=connected&provider=github or legacy ?github=connected */
export function parseIntegrationCallback(params: URLSearchParams): IntegrationCallbackResult {
  const integration = params.get('integration')
  const integrationError = params.get('integration_error')
  const provider = params.get('provider')
  const reused = params.get('connection_reused') === '1'

  if (integrationError) {
    return {
      handled: true,
      connected: false,
      provider: provider ?? null,
      error: integrationError,
      reused: false,
    }
  }

  if (integration === 'connected') {
    return {
      handled: true,
      connected: true,
      provider: provider ?? 'github',
      error: null,
      reused,
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
      reused: false,
    }
  }
  if (github === 'connected') {
    return {
      handled: true,
      connected: true,
      provider: 'github',
      error: null,
      reused: false,
    }
  }

  return { handled: false, connected: false, provider: null, error: null, reused: false }
}
