export type OAuthProvider = 'outlook' | 'gmail'
export type Provider = OAuthProvider | 'smtp_imap'
export type ConnectionStatus = 'active' | 'error' | 'revoked'

export type OAuthProviderConfig = {
  id: OAuthProvider
  connectLabel: string
}

export const OAUTH_PROVIDERS: OAuthProviderConfig[] = [
  { id: 'outlook', connectLabel: 'Connect Outlook' },
  { id: 'gmail', connectLabel: 'Connect Gmail' },
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
  /** Decoded `aad_detail` or other provider error text from the redirect query string. */
  detail: string | null
  handled: boolean
}

function decodeQueryDetail(value: string | null): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
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
  const globalDetail = decodeQueryDetail(searchParams.get('oauth_detail') ?? searchParams.get('aad_detail'))

  if (oauthProvider && oauthStatus === 'connected') {
    return { provider: oauthProvider, status: 'connected', error: null, detail: null, handled: true }
  }
  if (oauthProvider && oauthError) {
    return { provider: oauthProvider, status: null, error: oauthError, detail: globalDetail, handled: true }
  }

  // Backward compatibility for old Outlook query params.
  const legacyOutlookStatus = searchParams.get('outlook')
  const legacyOutlookError = searchParams.get('outlook_error')
  if (legacyOutlookStatus === 'connected') {
    return { provider: 'outlook', status: 'connected', error: null, detail: null, handled: true }
  }
  if (legacyOutlookError) {
    return { provider: 'outlook', status: null, error: legacyOutlookError, detail: globalDetail, handled: true }
  }

  return { provider: null, status: null, error: null, detail: null, handled: false }
}

/** Dev-only: readable OAuth redirect logging (avoids collapsed "Object" in Chrome). */
export function logOAuthRedirectDebugInDev(searchParams: URLSearchParams, callback: OAuthCallbackResult): void {
  if (!import.meta.env.DEV || !callback.handled) return
  console.info('[OAuth redirect debug]')
  console.info('  raw query:', searchParams.toString() || '(leeg)')
  console.info('  provider:', callback.provider ?? '(geen)')
  console.info('  error code:', callback.error ?? '(geen)')
  console.info(
    '  detail (aad/oauth):',
    callback.detail ?? '(geen — Xano stuurt geen aad_detail/oauth_detail mee in de redirect)',
  )
}

/** Short user-facing text for OAuth redirect errors. Show `result.detail` separately (e.g. in `OauthRedirectAlert`). */
export function describeOAuthCallbackSummary(result: OAuthCallbackResult): string {
  const code = result.error ?? ''
  const who = result.provider ? providerFriendlyName(result.provider) : 'The provider'

  if (code === 'token_exchange') {
    return `${who} rejected the token step after authorization. Usually: redirect URI in the identity provider app and in Xano do not match exactly, or the client secret is wrong or expired.`
  }

  const byCode: Record<string, string> = {
    microsoft_oauth_token:
      'Microsoft did not return a valid token. Check client ID, secret, and redirect URI in Azure and Xano.',
    no_refresh_token:
      'No refresh token was received. Reconnect and grant consent again (admin consent for the tenant may be required).',
    missing_oauth_env: 'The server is missing OAuth configuration (Microsoft environment variables).',
    unauthorized_client:
      'The Microsoft app does not allow this account type. Check supported account types in Entra (including consumer accounts if needed).',
    invalid_grant:
      'Authorization code is invalid or expired. Start the connection again.',
    consent_required: 'The user must grant consent again. Try connecting again.',
    google_oauth_token:
      'Google did not return a valid token. Check client ID, client secret, and matching redirect URI in Google Cloud and Xano.',
    google_profile:
      'Could not fetch Google profile with the access token. Check scopes and consent screen configuration.',
    no_google_id:
      'Google did not return a stable user ID. Check OAuth scopes (openid/email/profile) and try again.',
    no_mailbox_email:
      'Google did not return a mailbox address. Check that email access is allowed in the consent flow.',
    redirect_uri_mismatch:
      'The redirect URI in Google Cloud does not exactly match the redirect URI in Xano.',
    access_denied:
      'The user denied or cancelled Google consent.',
  }

  if (code && byCode[code]) return byCode[code]

  if (code) return `Failed to connect ${who} (error code ${code}).`
  return `Failed to connect ${who}.`
}

/** @deprecated Use `describeOAuthCallbackSummary` and show `result.detail` in the UI. */
export function describeOAuthCallbackError(result: OAuthCallbackResult): string {
  return describeOAuthCallbackSummary(result)
}

