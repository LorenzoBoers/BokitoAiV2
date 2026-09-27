import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  denyMcpOAuthConsent,
  fetchMcpOAuthConsentContext,
  submitMcpOAuthConsent,
  type McpOAuthConsentContext,
} from '../lib/mcp-oauth-api'

const SCOPE_LABEL_KEYS: Record<string, string> = {
  messaging: 'oauthMcp.scopeLabels.messaging',
  workspace: 'oauthMcp.scopeLabels.workspace',
  projects: 'oauthMcp.scopeLabels.projects',
  agents: 'oauthMcp.scopeLabels.agents',
  delegation: 'oauthMcp.scopeLabels.delegation',
  cases: 'oauthMcp.scopeLabels.cases',
  triggers: 'oauthMcp.scopeLabels.triggers',
  channels: 'oauthMcp.scopeLabels.channels',
  integrations: 'oauthMcp.scopeLabels.integrations',
  govern: 'oauthMcp.scopeLabels.govern',
}

export default function OAuthMcpConsent() {
  const { t } = useTranslation('nav')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const requestId = searchParams.get('request_id') || ''

  const [ctx, setCtx] = useState<McpOAuthConsentContext | null>(null)
  const [tenantId, setTenantId] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!requestId) {
      setError(t('oauthMcp.missingRequest'))
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchMcpOAuthConsentContext(requestId)
        if (cancelled) return
        setCtx(data)
        const first = data.memberships[0]?.tenant_id || ''
        setTenantId(first)
        setSelectedScopes(
          data.scopes.length ? [...data.scopes] : [...data.scopes_supported],
        )
      } catch (err) {
        if (cancelled) return
        const status = (err as Error & { status?: number }).status
        if (status === 401) {
          const returnTo = `/oauth/mcp?request_id=${encodeURIComponent(requestId)}`
          navigate(`/login?return_to=${encodeURIComponent(returnTo)}`, { replace: true })
          return
        }
        setError((err as Error).message || t('oauthMcp.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requestId, navigate, t])

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }

  async function onAuthorize(e: FormEvent) {
    e.preventDefault()
    if (!ctx || !tenantId) return
    setSubmitting(true)
    setError('')
    try {
      const { redirect_to } = await submitMcpOAuthConsent({
        authorize_request_id: ctx.request_id,
        tenant_id: tenantId,
        scopes: selectedScopes,
      })
      window.location.assign(redirect_to)
    } catch (err) {
      setError((err as Error).message || t('oauthMcp.authorizeFailed'))
      setSubmitting(false)
    }
  }

  async function onDeny() {
    if (!ctx) return
    setSubmitting(true)
    setError('')
    try {
      const { redirect_to } = await denyMcpOAuthConsent({
        authorize_request_id: ctx.request_id,
        tenant_id: tenantId || undefined,
      })
      window.location.assign(redirect_to)
    } catch (err) {
      setError((err as Error).message || t('oauthMcp.denyFailed'))
      setSubmitting(false)
    }
  }

  let redirectHost = ''
  try {
    redirectHost = ctx ? new URL(ctx.redirect_uri).host || ctx.redirect_uri : ''
  } catch {
    redirectHost = ctx?.redirect_uri || ''
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-bg-surface p-6 shadow-card">
        <div className="mb-5 flex items-center gap-2 text-text-heading">
          <ShieldCheck size={20} className="text-text-muted" />
          <h1 className="text-[17px] font-semibold">{t('oauthMcp.title')}</h1>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <Loader2 size={16} className="animate-spin" />
            {t('oauthMcp.loading')}
          </div>
        ) : error && !ctx ? (
          <div className="space-y-3">
            <p className="text-[13px] text-destructive">{error}</p>
            <Link to="/login" className="text-[13px] text-accent underline">
              {t('oauthMcp.backToLogin')}
            </Link>
          </div>
        ) : ctx ? (
          <form onSubmit={onAuthorize} className="space-y-4">
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {t('oauthMcp.intro', {
                client: ctx.client_name || ctx.client_id,
                email: ctx.user.email,
              })}
            </p>
            {redirectHost ? (
              <p className="text-[11.5px] text-text-muted">
                {t('oauthMcp.redirectTo', { host: redirectHost })}
              </p>
            ) : null}

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-heading">
                {t('oauthMcp.pickWorkspace')}
              </label>
              {ctx.memberships.length === 0 ? (
                <p className="text-[13px] text-destructive">{t('oauthMcp.noWorkspaces')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {ctx.memberships.map((m) => (
                    <li key={m.tenant_id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[13px] hover:bg-bg-hover">
                        <input
                          type="radio"
                          name="tenant"
                          value={m.tenant_id}
                          checked={tenantId === m.tenant_id}
                          onChange={() => setTenantId(m.tenant_id)}
                        />
                        <Building2 size={14} className="text-text-muted" />
                        <span className="font-medium text-text-heading">{m.tenant_name}</span>
                        <span className="text-text-muted">({m.tenant_slug})</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-medium text-text-heading">
                {t('oauthMcp.scopesTitle')}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {(ctx.scopes_supported.length ? ctx.scopes_supported : selectedScopes).map(
                  (scope) => {
                    const labelKey = SCOPE_LABEL_KEYS[scope]
                    const label = labelKey ? t(labelKey) : scope
                    const on = selectedScopes.includes(scope)
                    return (
                      <li key={scope}>
                        <button
                          type="button"
                          onClick={() => toggleScope(scope)}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                            on
                              ? 'border-accent/50 bg-accent/10 text-accent'
                              : 'border-border/60 text-text-secondary hover:bg-bg-hover'
                          }`}
                        >
                          {label}
                        </button>
                      </li>
                    )
                  },
                )}
              </ul>
              {!selectedScopes.length ? (
                <p className="mt-1.5 text-[11.5px] text-amber-600">{t('oauthMcp.scopesFull')}</p>
              ) : null}
            </div>

            {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => void onDeny()}
              >
                {t('oauthMcp.deny')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !tenantId || ctx.memberships.length === 0}
              >
                {submitting ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                {t('oauthMcp.authorize')}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
