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

/** Short user-facing Dutch text for OAuth redirect errors. Show `result.detail` separately (e.g. in `OauthRedirectAlert`). */
export function describeOAuthCallbackSummary(result: OAuthCallbackResult): string {
  const code = result.error ?? ''
  const who = result.provider ? providerFriendlyName(result.provider) : 'De provider'

  if (code === 'token_exchange') {
    return `${who} weigerde de token-stap na autorisatie. Meestal: redirect-URI in de identity-provider-app en in Xano staat niet exact op dezelfde waarde, of het client secret is onjuist of verlopen.`
  }

  const byCode: Record<string, string> = {
    microsoft_oauth_token:
      'Microsoft heeft geen geldig token afgegeven. Controleer client-id, geheim en redirect-URI in Azure en in Xano.',
    no_refresh_token:
      'Er is geen vernieuwingstoken ontvangen. Koppel opnieuw en verleen opnieuw toestemming (eventueel admin consent voor de tenant).',
    missing_oauth_env: 'De server mist OAuth-configuratie (Microsoft-omgevingsvariabelen).',
    unauthorized_client:
      'De Microsoft-app staat dit type account niet toe. Controleer ondersteunde accounttypen in Entra (inclusief consumeraccounts indien nodig).',
    invalid_grant:
      'Autorisatiecode ongeldig of verlopen. Start de koppeling opnieuw.',
    consent_required: 'De gebruiker moet opnieuw toestemming geven. Probeer de koppeling opnieuw.',
    google_oauth_token:
      'Google gaf geen geldig token terug. Controleer in Google Cloud en Xano de client-id, client secret en exact dezelfde redirect-URI.',
    google_profile:
      'Google-profiel kon niet worden opgehaald met het toegangstoken. Controleer of de scopes en consent-screen correct zijn ingesteld.',
    no_google_id:
      'Google heeft geen stabiel gebruikers-id teruggegeven. Controleer de OAuth-scopes (openid/email/profile) en probeer opnieuw.',
    no_mailbox_email:
      'Google gaf geen mailboxadres terug. Controleer of e-mailtoegang is toegestaan in de consent flow.',
    redirect_uri_mismatch:
      'De redirect-URI in Google Cloud komt niet exact overeen met de redirect-URI in Xano.',
    access_denied:
      'De gebruiker heeft de Google-toestemming geweigerd of geannuleerd.',
  }

  if (code && byCode[code]) return byCode[code]

  if (code) return `${who} koppelen mislukt (foutcode ${code}).`
  return `${who} koppelen mislukt.`
}

/** @deprecated Use `describeOAuthCallbackSummary` and show `result.detail` in the UI. */
export function describeOAuthCallbackError(result: OAuthCallbackResult): string {
  return describeOAuthCallbackSummary(result)
}

