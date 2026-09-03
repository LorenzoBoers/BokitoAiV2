import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { buildApiTokenCurl } from '../lib/api-token-curl'
import { isHttpsUrl } from '../lib/https-url'
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  type ApiTokenRow,
} from '../lib/govern-api'
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  testWebhook,
  updateWebhook,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../lib/webhooks-api'

// REST scopes checked by /api/public/v1; the rest are MCP tool categories
// checked by /api/mcp. An empty selection = full access.
const TOKEN_SCOPE_GROUPS: { labelKey: 'restApi' | 'mcpTools'; scopes: string[] }[] = [
  { labelKey: 'restApi', scopes: ['signals:read', 'signals:write'] },
  {
    labelKey: 'mcpTools',
    scopes: ['messaging', 'workspace', 'agents', 'channels', 'triggers', 'integrations', 'govern'],
  },
]

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-'
}

function ApiTokensSection() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [tokens, setTokens] = useState<ApiTokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await listApiTokens()
      setTokens(data.items)
    } catch {
      setTokens([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }

  function toggleGroup(groupScopes: string[]) {
    setScopes((prev) => {
      const allOn = groupScopes.every((scope) => prev.includes(scope))
      if (allOn) return prev.filter((scope) => !groupScopes.includes(scope))
      return [...new Set([...prev, ...groupScopes])]
    })
  }

  function formatLastUsed(iso: string | null): string {
    if (!iso) return t('developersPage.neverUsed')
    const then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return t('developersPage.neverUsed')
    const delta = Date.now() - then
    if (delta < 60_000) return t('developersPage.justNow')
    if (delta < 3_600_000) return t('developersPage.minutesAgo', { count: Math.floor(delta / 60_000) })
    if (delta < 86_400_000) return t('developersPage.hoursAgo', { count: Math.floor(delta / 3_600_000) })
    return t('developersPage.daysAgo', { count: Math.floor(delta / 86_400_000) })
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const created = await createApiToken(trimmed, scopes)
      setCreatedToken(created.token ?? null)
      setName('')
      setScopes([])
      setShowAdd(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('developersPage.createError'))
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(token: ApiTokenRow) {
    if (!window.confirm(t('developersPage.revokeConfirm', { name: token.name }))) return
    try {
      await revokeApiToken(token.id)
      toast.success(t('developersPage.revoked'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('developersPage.revokeError'))
    }
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-heading">
            <KeyRound size={15} className="text-text-muted" />
            {t('developersPage.tokensTitle')}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
            {t('developersPage.tokensBody')}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus size={14} className="mr-1" /> {t('developersPage.newToken')}
        </Button>
      </div>

      {showAdd ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <div>
            <Label htmlFor="token-name">{t('developersPage.tokenName')}</Label>
            <Input
              id="token-name"
              placeholder={t('developersPage.tokenNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label>{t('developersPage.scopes')}</Label>
            <div className="mt-1 space-y-2">
              {TOKEN_SCOPE_GROUPS.map((group) => (
                <div key={group.labelKey}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-text-muted">
                      {t(`developersPage.${group.labelKey}`)}
                    </p>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-accent hover:underline"
                      onClick={() => toggleGroup(group.scopes)}
                    >
                      {group.labelKey === 'restApi'
                        ? t('developersPage.selectAllRest')
                        : t('developersPage.selectAllMcp')}
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {group.scopes.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => toggleScope(scope)}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                          scopes.includes(scope)
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'border-border/60 text-text-secondary hover:bg-bg-hover'
                        }`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {scopes.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-amber-600">{t('developersPage.fullAccessWarning')}</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              {busy ? t('developersPage.creating') : t('developersPage.create')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              {t('developersPage.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {createdToken ? (
        <div className="mt-4 space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <p className="text-[12px] text-text-secondary">{t('developersPage.created')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-[11.5px]">{createdToken}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(createdToken)
                toast.success(t('developersPage.copied'))
              }}
            >
              <Copy size={13} className="mr-1" />
              {t('developersPage.copy')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(buildApiTokenCurl(createdToken, window.location.origin))
                toast.success(t('developersPage.copiedCurl'))
              }}
            >
              {t('developersPage.copyCurl')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreatedToken(null)}>
              {t('developersPage.dismissToken')}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-[12.5px] text-text-muted">
          <Loader2 size={14} className="animate-spin" /> {t('developersPage.loading')}
        </div>
      ) : tokens.length === 0 ? (
        <div className="mt-4">
          <p className="text-[12.5px] text-text-muted">{t('developersPage.empty')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {showAdd ? null : (
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
                <Plus size={14} className="mr-1" />
                {t('developersPage.newToken')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => navigate('/connections/connected')}>
              {t('developersPage.openIntegrations')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {tokens.filter((row) => showRevoked || !row.revoked_at).map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-bg-surface px-4 py-3 shadow-card"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-text-heading">
                  {row.name}{' '}
                  <span className="font-mono text-[11px] text-text-muted">{row.token_prefix}…</span>
                  {row.revoked_at ? (
                    <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[10.5px] font-medium text-red-500">
                      {t('developersPage.revokedBadge')}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[11.5px] text-text-muted">
                  {row.scopes.length ? row.scopes.join(', ') : t('developersPage.fullAccess')}
                  {row.last_used_at
                    ? ` · ${t('developersPage.lastUsed', { time: formatLastUsed(row.last_used_at) })}`
                    : ` · ${t('developersPage.neverUsed')}`}
                </p>
              </div>
              {!row.revoked_at ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => handleRevoke(row)}
                  aria-label={t('developersPage.revokeAria')}
                >
                  <Trash2 size={13} />
                </Button>
              ) : null}
            </div>
          ))}
          {tokens.some((row) => row.revoked_at) ? (
            <button
              type="button"
              className="text-[11.5px] font-medium text-accent hover:underline"
              onClick={() => setShowRevoked((v) => !v)}
            >
              {showRevoked ? t('developersPage.hideRevoked') : t('developersPage.showRevoked')}
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}

function StatusPill({ endpoint }: { endpoint: WebhookEndpoint }) {
  const { t } = useTranslation('nav')
  if (!endpoint.last_status) {
    return <span className="text-[11px] text-text-muted">{t('developersPage.webhooks.noDeliveriesYet')}</span>
  }
  const ok = endpoint.last_status !== 'failed'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
        ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
      }`}
    >
      {ok
        ? t('developersPage.webhooks.lastDelivery', { status: endpoint.last_status })
        : t('developersPage.webhooks.lastFailed')}
    </span>
  )
}

export default function DeveloperSettings() {
  const { t } = useTranslation('nav')
  const [items, setItems] = useState<WebhookEndpoint[]>([])
  const [eventCatalog, setEventCatalog] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newEvents, setNewEvents] = useState<string[]>(['*'])
  const [busy, setBusy] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listWebhooks()
      setItems(data.items)
      setEventCatalog(data.events)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('developersPage.webhooks.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  function toggleNewEvent(event: string) {
    setNewEvents((prev) => {
      if (event === '*') return ['*']
      const withoutAll = prev.filter((e) => e !== '*')
      const next = withoutAll.includes(event)
        ? withoutAll.filter((e) => e !== event)
        : [...withoutAll, event]
      return next.length ? next : ['*']
    })
  }

  async function handleCreate() {
    const url = newUrl.trim()
    if (!url) return
    if (!isHttpsUrl(url, { allowLocalHttp: true })) {
      toast.error(t('developersPage.webhooks.invalidUrl'))
      return
    }
    setBusy(true)
    try {
      await createWebhook({ url, description: newDescription.trim(), events: newEvents })
      setNewUrl('')
      setNewDescription('')
      setNewEvents(['*'])
      setShowAdd(false)
      toast.success(t('developersPage.webhooks.added'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('developersPage.webhooks.addError'))
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleActive(endpoint: WebhookEndpoint) {
    try {
      await updateWebhook(endpoint.id, { active: !endpoint.active })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('developersPage.webhooks.updateError'))
    }
  }

  async function handleDelete(endpoint: WebhookEndpoint) {
    if (!window.confirm(t('developersPage.webhooks.removeConfirm', { url: endpoint.url }))) return
    try {
      await deleteWebhook(endpoint.id)
      toast.success(t('developersPage.webhooks.removed'))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('developersPage.webhooks.removeError'))
    }
  }

  async function handleTest(endpoint: WebhookEndpoint) {
    try {
      const result = await testWebhook(endpoint.id)
      if (result.status === 'delivered') {
        toast.success(t('developersPage.webhooks.testOk', { code: result.status_code }))
      } else {
        toast.error(t('developersPage.webhooks.testFail', { count: result.attempts, error: result.error }))
      }
      await load()
      if (expandedId === endpoint.id) await loadDeliveries(endpoint.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('developersPage.webhooks.testError'))
    }
  }

  async function loadDeliveries(endpointId: string) {
    try {
      const data = await listWebhookDeliveries(endpointId)
      setDeliveries((prev) => ({ ...prev, [endpointId]: data.items }))
    } catch {
      // Listing failures leave the previous rows in place.
    }
  }

  async function handleToggleDeliveries(endpointId: string) {
    if (expandedId === endpointId) {
      setExpandedId(null)
      return
    }
    setExpandedId(endpointId)
    await loadDeliveries(endpointId)
  }

  async function handleCopySecret(endpoint: WebhookEndpoint) {
    if (!endpoint.secret) return
    try {
      await navigator.clipboard.writeText(endpoint.secret)
      setCopiedId(endpoint.id)
      toast.success(t('developersPage.webhooks.copiedSecret'))
      window.setTimeout(() => setCopiedId(null), 1600)
    } catch {
      toast.error(t('developersPage.webhooks.copyError'))
    }
  }

  return (
    <PageContent>
      <div className="max-w-3xl space-y-8">
        <section>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-text-heading">{t('developersPage.webhooks.title')}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                {t('developersPage.webhooks.body')}
              </p>
            </div>
            <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
              <Plus size={14} className="mr-1" /> {t('developersPage.webhooks.add')}
            </Button>
          </div>

          {showAdd ? (
            <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
              <div>
                <Label htmlFor="wh-url">{t('developersPage.webhooks.url')}</Label>
            <Input
              id="wh-url"
              placeholder={t('developersPage.webhooks.urlPlaceholder')}
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="wh-desc">{t('developersPage.webhooks.description')}</Label>
                <Input
                  id="wh-desc"
                  placeholder={t('developersPage.webhooks.descriptionPlaceholder')}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
              <div>
                <Label>{t('developersPage.webhooks.events')}</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleNewEvent('*')}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                      newEvents.includes('*')
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-border/60 text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    {t('developersPage.webhooks.allEvents')}
                  </button>
                  {eventCatalog.map((event) => (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleNewEvent(event)}
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                        newEvents.includes(event)
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-border/60 text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      {event}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={busy || !newUrl.trim()}>
                  {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                  {t('developersPage.webhooks.create')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
                  {t('developersPage.webhooks.cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 flex items-center gap-2 text-[12.5px] text-text-muted">
              <Loader2 size={14} className="animate-spin" /> {t('developersPage.webhooks.loading')}
            </div>
          ) : error ? (
            <p className="mt-6 text-[12.5px] text-red-500">{error}</p>
          ) : items.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-10 text-center">
              <WebhookIcon size={20} className="text-text-muted" />
              <p className="text-[12.5px] text-text-muted">
                {t('developersPage.webhooks.empty')}
              </p>
              <Link
                to="/settings/communication"
                className="text-[12px] font-medium text-accent hover:underline"
              >
                {t('developersPage.webhooks.emptyCommunicationLink')}
              </Link>
              {showAdd ? null : (
                <Button size="sm" variant="secondary" className="mt-1" onClick={() => setShowAdd(true)}>
                  <Plus size={14} className="mr-1" />
                  {t('developersPage.webhooks.add')}
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {items.map((endpoint) => (
                <div
                  key={endpoint.id}
                  className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px] text-text-primary">
                        {endpoint.url}
                      </p>
                      {endpoint.description ? (
                        <p className="text-[11.5px] text-text-muted">{endpoint.description}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusPill endpoint={endpoint} />
                      <Button size="sm" variant="ghost" onClick={() => handleTest(endpoint)}>
                        <Send size={13} className="mr-1" /> {t('developersPage.webhooks.test')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleActive(endpoint)}
                      >
                        {endpoint.active ? t('developersPage.webhooks.disable') : t('developersPage.webhooks.enable')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => handleDelete(endpoint)}
                        aria-label={t('developersPage.webhooks.removeAria')}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {!endpoint.active ? (
                      <span className="rounded-full bg-bg-surface-hover px-2 py-0.5 text-[10.5px] font-medium text-text-muted">
                        {t('developersPage.webhooks.disabled')}
                      </span>
                    ) : null}
                    {endpoint.events.map((event) => (
                      <span
                        key={event}
                        className="rounded-full border border-border/60 px-2 py-0.5 text-[10.5px] text-text-secondary"
                      >
                        {event === '*' ? t('developersPage.webhooks.allEvents') : event}
                      </span>
                    ))}
                  </div>
                  {endpoint.secret ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-[11px] text-text-muted">{t('developersPage.webhooks.signingSecret')}</span>
                      <code className="rounded bg-bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                        {endpoint.secret.slice(0, 12)}...
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopySecret(endpoint)}
                        className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary"
                      >
                        {copiedId === endpoint.id ? (
                          <>
                            <Check size={11} /> {t('developersPage.webhooks.copied')}
                          </>
                        ) : (
                          <>
                            <Copy size={11} /> {t('developersPage.webhooks.copy')}
                          </>
                        )}
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleToggleDeliveries(endpoint.id)}
                    className="mt-2 text-[11.5px] font-medium text-accent hover:underline"
                  >
                    {expandedId === endpoint.id
                      ? t('developersPage.webhooks.hideDeliveries')
                      : t('developersPage.webhooks.showDeliveries')}
                  </button>
                  {expandedId === endpoint.id ? (
                    <div className="mt-2 overflow-hidden rounded-lg border border-border/60">
                      {(deliveries[endpoint.id] || []).length === 0 ? (
                        <p className="px-3 py-2.5 text-[11.5px] text-text-muted">
                          {t('developersPage.webhooks.noDeliveries')}
                        </p>
                      ) : (
                        <table className="w-full text-[11.5px]">
                          <thead>
                            <tr className="border-b border-border/60 text-left text-text-muted">
                              <th className="px-3 py-1.5 font-medium">{t('developersPage.webhooks.colEvent')}</th>
                              <th className="px-3 py-1.5 font-medium">{t('developersPage.webhooks.colStatus')}</th>
                              <th className="px-3 py-1.5 font-medium">{t('developersPage.webhooks.colAttempts')}</th>
                              <th className="px-3 py-1.5 font-medium">{t('developersPage.webhooks.colTime')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(deliveries[endpoint.id] || []).map((delivery) => (
                              <tr key={delivery.id} className="border-b border-border/40 last:border-0">
                                <td className="px-3 py-1.5 font-mono">{delivery.event}</td>
                                <td className="px-3 py-1.5">
                                  <span
                                    className={
                                      delivery.status === 'delivered'
                                        ? 'text-emerald-500'
                                        : delivery.status === 'failed'
                                          ? 'text-red-500'
                                          : 'text-text-muted'
                                    }
                                  >
                                    {delivery.status}
                                    {delivery.status_code ? ` (${delivery.status_code})` : ''}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5">{delivery.attempts}</td>
                                <td className="px-3 py-1.5 text-text-muted">
                                  {formatTime(delivery.created_at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <ApiTokensSection />

        <section className="rounded-xl border border-border/60 bg-bg-surface p-4 shadow-card">
          <h2 className="text-[15px] font-semibold text-text-heading">{t('developersPage.publicTitle')}</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
            {t('developersPage.publicBody')}
          </p>
          <Button size="sm" variant="secondary" className="mt-3" asChild>
            <Link to="/settings/govern?tab=policy">{t('developersPage.openGovernPolicy')}</Link>
          </Button>
        </section>
      </div>
    </PageContent>
  )
}
