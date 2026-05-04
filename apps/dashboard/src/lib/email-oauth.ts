export type OAuthProvider = 'outlook' | 'gmail'
export type Provider = OAuthProvider | 'smtp_imap'
export type ConnectionStatus = 'active' | 'error' | 'revoked'

export type OAuthProviderConfig = {
  id: OAuthProvider
  connectLabel: string
}

export const OAUTH_PROVIDERS: OAuthProviderConfig[] = [
  { id: 'outlook', connectLabel: 'Outlook koppelen' },
  { id: 'gmail', connectLabel: 'Gmail koppelen' },
]

export const PROVIDER_LABEL: Record<Provider, string> = {
  outlook: 'Outlook',
  gmail: 'Gmail',
  smtp_imap: 'SMTP / IMAP',
}

export type OAuthCallbackResult = {
  provider: OAuthProvider | null
  status: 'connected' | null
  error: string | null
  handled: boolean
}

export function toProvider(value: unknown): OAuthProvider | null {
  if (value === 'outlook' || value === 'gmail') return value
  return null
}

export function providerFriendlyName(provider: string): string {
  if (provider === 'outlook') return 'Outlook'
  if (provider === 'gmail') return 'Gmail'
  return provider
}

export function parseOAuthCallback(searchParams: URLSearchParams): OAuthCallbackResult {
  const oauthProvider = toProvider(searchParams.get('oauth_provider'))
  const oauthStatus = searchParams.get('oauth_status')
  const oauthError = searchParams.get('oauth_error')

  if (oauthProvider && oauthStatus === 'connected') {
    return { provider: oauthProvider, status: 'connected', error: null, handled: true }
  }
  if (oauthProvider && oauthError) {
    return { provider: oauthProvider, status: null, error: oauthError, handled: true }
  }

  // Backward compatibility for old Outlook query params.
  const legacyOutlookStatus = searchParams.get('outlook')
  const legacyOutlookError = searchParams.get('outlook_error')
  if (legacyOutlookStatus === 'connected') {
    return { provider: 'outlook', status: 'connected', error: null, handled: true }
  }
  if (legacyOutlookError) {
    return { provider: 'outlook', status: null, error: legacyOutlookError, handled: true }
  }

  return { provider: null, status: null, error: null, handled: false }
}

