import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { oauthRoutes } from '@/api/routes'
import { Loading } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { AuthLayout } from './AuthLayout'

type ConsentContext = {
  client_id: string
  client_name: string
  redirect_uris: string[]
  scopes: string[]
  workspace_name: string
}

const PARAMS = [
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const

export function OAuthConsentPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [ctx, setCtx] = useState<ConsentContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const clientId = params.get('client_id') ?? ''
  const requested = (params.get('scope') ?? '').split(' ').filter(Boolean)

  useEffect(() => {
    if (!clientId) {
      setError(t('oauth.missingClient'))
      return
    }
    api
      .get<ConsentContext>(oauthRoutes.consentContext, { client_id: clientId })
      .then(setCtx)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t('common.error')))
  }, [clientId, t])

  async function decide(approve: boolean) {
    setBusy(true)
    setError(null)
    const body: Record<string, string | boolean> = { approve }
    for (const key of PARAMS) {
      const v = params.get(key)
      if (v !== null) body[key] = v
    }
    try {
      const out = await api.post<{ redirect_to: string }>(oauthRoutes.consent, body)
      window.location.assign(out.redirect_to)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'))
      setBusy(false)
    }
  }

  const scopes = requested.length ? requested : ctx?.scopes ?? []
  const redirectHost = (() => {
    try {
      return new URL(params.get('redirect_uri') ?? '').host
    } catch {
      return params.get('redirect_uri') ?? ''
    }
  })()

  return (
    <AuthLayout title={t('oauth.title')}>
      {!ctx && !error && <Loading />}
      {ctx && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t('oauth.intro', { client: ctx.client_name || ctx.client_id, workspace: ctx.workspace_name })}
          </p>
          <div className="rounded-md border border-border bg-bg-subtle p-3">
            <div className="text-2xs uppercase tracking-wide text-text-muted">{t('oauth.scopes')}</div>
            <ul className="mt-2 space-y-1 text-sm">
              {scopes.map((s) => (
                <li key={s} className="flex items-baseline gap-2">
                  <code className="rounded bg-bg-root px-1 text-xs">{s}</code>
                  <span className="text-text-secondary">{t(`oauth.scope.${s}`, { defaultValue: s })}</span>
                </li>
              ))}
            </ul>
          </div>
          {redirectHost && (
            <p className="text-xs text-text-muted">{t('oauth.redirectHint', { host: redirectHost })}</p>
          )}
          <p className="text-xs text-text-muted">{t('oauth.policyHint')}</p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void decide(true)}>
              {t('oauth.allow')}
            </button>
            <button type="button" className="btn-outline flex-1" disabled={busy} onClick={() => void decide(false)}>
              {t('oauth.deny')}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-status-error">{error}</p>}
    </AuthLayout>
  )
}
