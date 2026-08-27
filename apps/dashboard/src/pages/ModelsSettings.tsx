import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Check, Copy, Cpu, Eye, EyeOff, Loader2, Plus, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { modelCostBand, providerTypeLabel } from '../lib/model-label'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  createProvider,
  createTenantModel,
  deleteProvider,
  getProviders,
  getTenantModels,
  staffDeletePlatformKey,
  staffGetPlatformKeys,
  staffListModels,
  staffSetMarkup,
  staffSetPlatformKey,
  staffUpsertModel,
  testProvider,
  updateProvider,
  updateTenantModel,
  type CatalogModel,
  type LlmProvider,
  type ManagedAiStatus,
  type PlatformKeysPayload,
  type ProviderConnection,
  type ProviderType,
  type TenantModelRow,
  type TenantModelsPayload,
} from '../lib/models-api'

const PROVIDER_TYPE_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai_compatible', label: 'OpenAI-compatible' },
]

function pricePerMillion(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function ModelsSettings() {
  const { t } = useTranslation('nav')
  const { token, isStaff } = useAuth()
  const [data, setData] = useState<TenantModelsPayload | null>(null)
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const [showAddProvider, setShowAddProvider] = useState(false)
  const [newProviderType, setNewProviderType] = useState<ProviderType>('anthropic')
  const [newLabel, setNewLabel] = useState('')
  const [newBaseUrl, setNewBaseUrl] = useState('')
  const [newApiKey, setNewApiKey] = useState('')
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  const [customModelConn, setCustomModelConn] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [customDisplayName, setCustomDisplayName] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelQuery, setModelQuery] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const [modelsPayload, providersPayload] = await Promise.all([
        getTenantModels(token),
        getProviders(token),
      ])
      setData(modelsPayload)
      setConnections(providersPayload.connections)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.loadError'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  const flashSaved = () => {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const handleAddProvider = async () => {
    if (!token || busy) return
    setBusy(true)
    setError(null)
    try {
      await createProvider(token, {
        provider_type: newProviderType,
        label: newLabel,
        base_url: newBaseUrl,
        api_key: newApiKey,
      })
      setShowAddProvider(false)
      setNewLabel('')
      setNewBaseUrl('')
      setNewApiKey('')
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.addProviderError'))
    } finally {
      setBusy(false)
    }
  }

  const handleEnablePresets = async (connectionId: string) => {
    if (!token || busy) return
    if (!window.confirm(t('modelsPage.enablePresetsConfirm'))) return
    setBusy(true)
    try {
      await createTenantModel(token, { connection_id: connectionId, enable_presets: true })
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.enablePresetsError'))
    } finally {
      setBusy(false)
    }
  }

  const handleToggleModel = async (model: TenantModelRow) => {
    if (!token || busy) return
    setBusy(true)
    try {
      await updateTenantModel(token, model.id, { enabled: !model.enabled })
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.updateModelError'))
    } finally {
      setBusy(false)
    }
  }

  const handleSetDefault = async (model: TenantModelRow, field: 'is_default_chat' | 'is_default_embedding') => {
    if (!token || busy) return
    setBusy(true)
    try {
      await updateTenantModel(token, model.id, { [field]: true })
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.setDefaultError'))
    } finally {
      setBusy(false)
    }
  }

  const handleAddCustomModel = async () => {
    if (!token || busy || !customModelConn || !customModelId.trim()) return
    setBusy(true)
    try {
      await createTenantModel(token, {
        connection_id: customModelConn,
        model_id: customModelId.trim(),
        display_name: customDisplayName.trim() || customModelId.trim(),
        kind: 'chat',
      })
      setCustomModelId('')
      setCustomDisplayName('')
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.addModelError'))
    } finally {
      setBusy(false)
    }
  }

  const handleTestConnection = async (connectionId: string) => {
    if (!token) return
    setTestResults((prev) => ({ ...prev, [connectionId]: t('modelsPage.testing') }))
    try {
      const result = await testProvider(token, connectionId)
      setTestResults((prev) => ({
        ...prev,
        [connectionId]: result.ok ? t('modelsPage.connectionOk') : result.message,
      }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [connectionId]: err instanceof Error ? err.message : t('modelsPage.testFailed'),
      }))
    }
  }

  const handleDeleteProvider = async (connectionId: string, label: string) => {
    if (!token || busy) return
    if (!window.confirm(t('modelsPage.removeConfirm', { name: label }))) return
    setBusy(true)
    try {
      await deleteProvider(token, connectionId)
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.removeProviderError'))
    } finally {
      setBusy(false)
    }
  }

  const handleToggleProvider = async (conn: ProviderConnection) => {
    if (!token || busy) return
    setBusy(true)
    try {
      await updateProvider(token, conn.id, { enabled: !conn.enabled })
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.updateProviderError'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <PageContent width="lg" className="py-10">
        <div className="flex justify-center text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      </PageContent>
    )
  }

  const tenantModels = data?.source === 'tenant' ? data.models : []
  const chatModels = tenantModels.filter((m) => m.kind === 'chat')
  const embeddingModels = tenantModels.filter((m) => m.kind === 'embedding')
  const isTenantMode = data?.source === 'tenant'
  const modelNeedle = modelQuery.trim().toLowerCase()
  const visibleModels = modelNeedle
    ? tenantModels.filter((m) =>
        `${m.display_name} ${m.slug} ${m.model_id} ${m.connection_label ?? ''} ${m.provider_type}`
          .toLowerCase()
          .includes(modelNeedle),
      )
    : tenantModels

  return (
    <PageContent width="lg" className="space-y-7 py-1">
      <PageGuideBanner page="models" />
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-bg-surface text-accent shadow-card">
          <Cpu size={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-text-heading">{t('modelsPage.pageTitle')}</h2>
          <p className="text-[12.5px] text-text-muted">
            {t('modelsPage.pageSubtitle')}
          </p>
        </div>
      </div>

      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
      {saved ? (
        <p className="inline-flex items-center gap-1 text-[12px] text-status-success">
          <Check size={13} /> {t('modelsPage.saved')}
        </p>
      ) : null}

      {data?.managed ? <ManagedAiCard managed={data.managed} /> : null}

      {/* Providers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-text-heading">{t('modelsPage.ownProvidersTitle')}</h3>
            <p className="text-[11.5px] text-text-muted">
              {t('modelsPage.ownProvidersBody')}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowAddProvider((v) => !v)}
            disabled={busy}
          >
            <Plus size={14} className="mr-1" />
            {t('modelsPage.addProvider')}
          </Button>
        </div>

        {showAddProvider ? (
          <form
            className="space-y-3 rounded-lg border border-border/60 bg-bg-elevated p-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleAddProvider()
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <Label>{t('modelsPage.providerType')}</Label>
                <select
                  value={newProviderType}
                  onChange={(e) => setNewProviderType(e.target.value as ProviderType)}
                  className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
                >
                  {PROVIDER_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <Label>{t('modelsPage.labelOptional')}</Label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t('modelsPage.labelPlaceholder')} />
              </label>
            </div>
            {newProviderType === 'openai_compatible' ? (
              <label className="space-y-1.5">
                <Label>{t('modelsPage.baseUrl')}</Label>
                <Input
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  placeholder={t('modelsPage.baseUrlPlaceholder')}
                />
              </label>
            ) : null}
            <label className="space-y-1.5">
              <Label>{t('modelsPage.apiKey')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="off"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder={t('modelsPage.apiKeyPlaceholder')}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={showApiKey ? t('modelsPage.hideKey') : t('modelsPage.showKey')}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              </div>
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !newApiKey.trim()}>
                {t('modelsPage.saveProvider')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowAddProvider(false)}>
                {t('modelsPage.cancel')}
              </Button>
            </div>
          </form>
        ) : null}

        {connections.length === 0 ? (
          <div>
            <p className="text-[12px] text-text-muted">{t('modelsPage.noProviders')}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <Link to="/settings/setup" className="text-[12px] font-medium text-accent hover:underline">
                {t('modelsPage.openSetup')}
              </Link>
              <Link to="/agents" className="text-[12px] font-medium text-accent hover:underline">
                {t('modelsPage.openAgents')}
              </Link>
              <Link to="/cockpit/usage" className="text-[12px] font-medium text-accent hover:underline">
                {t('modelsPage.openUsage')}
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-elevated px-3.5 py-2.5"
              >
                <div>
                  <p className="text-[13px] font-medium text-text-heading">
                    {conn.label}{' '}
                    <span className="text-[11px] font-normal text-text-muted">({providerTypeLabel(conn.provider_type)})</span>
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {conn.is_set ? t('modelsPage.keySet', { last4: conn.last4 }) : t('modelsPage.noKey')}
                    {conn.base_url ? ` · ${conn.base_url}` : ''}
                  </p>
                  {testResults[conn.id] ? (
                    <p
                      className={`text-[11px] ${
                        testResults[conn.id] === t('modelsPage.connectionOk')
                          ? 'text-status-success'
                          : testResults[conn.id] === t('modelsPage.testing')
                            ? 'text-text-muted'
                            : 'text-status-error'
                      }`}
                    >
                      {testResults[conn.id]}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestConnection(conn.id)}
                    className="rounded-full border border-border/60 px-3 py-1 text-[11.5px] text-text-secondary hover:text-accent"
                  >
                    {t('modelsPage.test')}
                  </button>
                  {conn.provider_type !== 'openai_compatible' ? (
                    <button
                      type="button"
                      onClick={() => void handleEnablePresets(conn.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/40 px-3 py-1 text-[11.5px] text-accent hover:bg-accent/5 disabled:opacity-50"
                    >
                      <Zap size={12} /> {t('modelsPage.enablePresets')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleToggleProvider(conn)}
                    disabled={busy}
                    className={`rounded-full border px-3 py-1 text-[11.5px] font-medium disabled:opacity-50 ${
                      conn.enabled
                        ? 'border-status-success/40 bg-status-success/10 text-status-success'
                        : 'border-border/60 text-text-muted'
                    }`}
                  >
                    {conn.enabled ? t('modelsPage.enabled') : t('modelsPage.disabled')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteProvider(conn.id, conn.label)}
                    disabled={busy}
                    className="rounded-full border border-border/60 px-3 py-1 text-[11.5px] text-text-muted hover:text-status-error disabled:opacity-50"
                  >
                    {t('modelsPage.remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Custom model for compatible providers */}
      {connections.some((c) => c.provider_type === 'openai_compatible') ? (
        <section className="space-y-3 rounded-lg border border-border/60 bg-bg-elevated p-4">
          <h3 className="text-[13px] font-semibold text-text-heading">{t('modelsPage.addCustomModelTitle')}</h3>
          <p className="text-[11.5px] text-text-muted">
            {t('modelsPage.addCustomModelBody')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={customModelConn}
              onChange={(e) => setCustomModelConn(e.target.value)}
              className="rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
            >
              <option value="">{t('modelsPage.selectProvider')}</option>
              {connections
                .filter((c) => c.provider_type === 'openai_compatible')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
            <Input
              value={customModelId}
              onChange={(e) => setCustomModelId(e.target.value)}
              placeholder={t('modelsPage.modelIdPlaceholder')}
            />
            <Input
              value={customDisplayName}
              onChange={(e) => setCustomDisplayName(e.target.value)}
              placeholder={t('modelsPage.displayNamePlaceholder')}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleAddCustomModel()}
            disabled={busy || !customModelConn || !customModelId.trim()}
          >
            {t('modelsPage.addModel')}
          </Button>
        </section>
      ) : null}

      {/* Tenant models */}
      {isTenantMode ? (
        <>
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold text-text-heading">{t('modelsPage.defaultModels')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[11.5px] font-medium text-text-muted">{t('modelsPage.defaultChatModel')}</span>
                <select
                  value={data.default_chat}
                  onChange={(e) => {
                    const model = chatModels.find((m) => m.slug === e.target.value)
                    if (model) void handleSetDefault(model, 'is_default_chat')
                  }}
                  className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
                >
                  <option value="">{t('modelsPage.none')}</option>
                  {chatModels.filter((m) => m.enabled).map((m) => (
                    <option key={m.id} value={m.slug}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11.5px] font-medium text-text-muted">{t('modelsPage.defaultEmbeddingModel')}</span>
                <select
                  value={data.default_embedding}
                  onChange={(e) => {
                    const model = embeddingModels.find((m) => m.slug === e.target.value)
                    if (model) void handleSetDefault(model, 'is_default_embedding')
                  }}
                  className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
                >
                  <option value="">{t('modelsPage.none')}</option>
                  {embeddingModels.filter((m) => m.enabled).map((m) => (
                    <option key={m.id} value={m.slug}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-text-heading">{t('modelsPage.modelsTitle')}</h3>
              {tenantModels.length > 0 ? (
                <Input
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  placeholder={t('modelsPage.searchModels')}
                  className="h-8 max-w-xs text-[12.5px]"
                />
              ) : null}
            </div>
            {tenantModels.length === 0 ? (
              <div>
                <p className="text-[12px] text-text-muted">{t('modelsPage.modelsEmpty')}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  <Link to="/agents" className="text-[12px] font-medium text-accent hover:underline">
                    {t('modelsPage.openAgents')}
                  </Link>
                  <Link to="/settings/govern?tab=policy" className="text-[12px] font-medium text-accent hover:underline">
                    {t('modelsPage.openGovern')}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleModels.length === 0 ? (
                  <div>
                    <p className="text-[12px] text-text-muted">{t('modelsPage.noModelMatches')}</p>
                    <button
                      type="button"
                      className="mt-1 text-[12px] font-medium text-accent hover:underline"
                      onClick={() => setModelQuery('')}
                    >
                      {t('modelsPage.clearFilter')}
                    </button>
                  </div>
                ) : (
                  visibleModels.map((m) => {
                    const band = m.kind === 'chat' ? modelCostBand(m.input_cost_per_mtok_cents, m.output_cost_per_mtok_cents) : null
                    const priceTitle =
                      m.kind === 'chat'
                        ? t('modelsPage.pricingInOut', {
                            in: pricePerMillion(m.input_cost_per_mtok_cents),
                            out: pricePerMillion(m.output_cost_per_mtok_cents),
                          })
                        : undefined
                    return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-elevated px-3.5 py-2.5"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-text-heading">{m.display_name}</p>
                      <p className="text-[11px] text-text-muted" title={priceTitle}>
                        {m.connection_label ?? providerTypeLabel(m.provider_type)}
                        {band ? ` · ${t(`modelsPage.costBand.${band}`)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(m.model_id)
                        toast.success(t('modelsPage.copiedModel'))
                      }}
                      className="rounded-full border border-border/60 px-2 py-1 text-text-muted hover:text-accent"
                      aria-label={t('modelsPage.copyModel')}
                      title={m.model_id}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleModel(m)}
                      disabled={busy}
                      className={`rounded-full border px-3 py-1 text-[11.5px] font-medium disabled:opacity-50 ${
                        m.enabled
                          ? 'border-status-success/40 bg-status-success/10 text-status-success'
                          : 'border-border/60 text-text-muted'
                      }`}
                    >
                      {m.enabled ? t('modelsPage.enabled') : t('modelsPage.disabled')}
                    </button>
                    </div>
                  </div>
                    )
                  })
                )}
              </div>
            )}
          </section>
        </>
      ) : null}

      {isStaff ? <StaffCatalogAdmin token={token} /> : null}
    </PageContent>
  )
}

function ManagedAiCard({ managed }: { managed: ManagedAiStatus }) {
  const { t } = useTranslation('nav')
  const statusBadge =
    managed.status === 'active' ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-[11.5px] font-medium text-status-success">
        {t('modelsPage.managed.active')}
      </span>
    ) : managed.status === 'standby' ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-bg-hover/50 px-2.5 py-1 text-[11.5px] font-medium text-text-muted">
        {t('modelsPage.managed.standby')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11.5px] font-medium text-amber-500">
        {t('modelsPage.managed.notConfigured')}
      </span>
    )

  return (
    <section className="rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.06] to-transparent p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Sparkles size={18} />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-text-heading">{t('modelsPage.managed.title')}</p>
            <p className="max-w-xl text-[12px] text-text-muted">
              {t('modelsPage.managed.body')}
            </p>
          </div>
        </div>
        {statusBadge}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-surface px-2.5 py-1 text-text-secondary">
          {t('modelsPage.managed.chat')}
          <span className="font-medium text-text-primary">{managed.chat.display_name}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-surface px-2.5 py-1 text-text-secondary">
          {t('modelsPage.managed.embeddings')}
          <span className="font-medium text-text-primary">{managed.embedding.display_name}</span>
        </span>
        <Link
          to="/cockpit/usage"
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
        >
          {t('modelsPage.managed.viewUsage')} <ArrowUpRight size={12} />
        </Link>
      </div>

      {managed.status === 'standby' ? (
        <p className="mt-2.5 text-[11.5px] text-text-muted">
          {t('modelsPage.managed.standbyHint')}
        </p>
      ) : null}
      {managed.status === 'unconfigured' ? (
        <p className="mt-2.5 text-[11.5px] text-amber-500">
          {t('modelsPage.managed.mockModeHint')}
        </p>
      ) : null}
      {managed.chat.key_source === 'tenant' && managed.status === 'active' ? (
        <p className="mt-2.5 text-[11.5px] text-text-muted">
          {t('modelsPage.managed.legacyKeyHint', { provider: managed.chat.provider })}
        </p>
      ) : null}
    </section>
  )
}

function StaffCatalogAdmin({ token }: { token: string | null }) {
  const { t } = useTranslation('nav')
  const [models, setModels] = useState<CatalogModel[]>([])
  const [keys, setKeys] = useState<PlatformKeysPayload | null>(null)
  const [markupDraft, setMarkupDraft] = useState('')
  const [keyDrafts, setKeyDrafts] = useState<Record<LlmProvider, string>>({ anthropic: '', openai: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [m, k] = await Promise.all([staffListModels(token), staffGetPlatformKeys(token)])
      setModels(m.items)
      setKeys(k)
      setMarkupDraft(String(k.markup ?? ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modelsPage.staffCatalogError'))
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  const toggleEnabled = async (model: CatalogModel) => {
    if (!token || !model.id) return
    setBusy(true)
    try {
      await staffUpsertModel(token, { enabled: !model.enabled }, model.id)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async (provider: LlmProvider) => {
    const value = keyDrafts[provider].trim()
    if (!token || !value) return
    setBusy(true)
    try {
      const next = await staffSetPlatformKey(token, provider, value)
      setKeys(next)
      setKeyDrafts((prev) => ({ ...prev, [provider]: '' }))
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async (provider: LlmProvider) => {
    if (!token) return
    setBusy(true)
    try {
      await staffDeletePlatformKey(token, provider)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const saveMarkup = async () => {
    if (!token) return
    const value = Number(markupDraft)
    if (!Number.isFinite(value) || value < 1) {
      setError(t('modelsPage.staff.markupError'))
      return
    }
    setBusy(true)
    try {
      await staffSetMarkup(token, value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-accent/30 bg-accent/[0.03] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-accent" />
        <h3 className="text-[13px] font-semibold text-text-heading">{t('modelsPage.staff.title')}</h3>
      </div>
      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}

      <div className="space-y-2">
        <p className="text-[11.5px] font-medium text-text-muted">{t('modelsPage.staff.catalogTitle')}</p>
        {models.map((m) => (
          <div
            key={m.slug}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-elevated px-3.5 py-2.5"
          >
            <div>
              <p className="text-[13px] font-medium text-text-heading">
                {m.display_name}{' '}
                <span className="text-[11px] text-text-muted">
                  ({m.slug} · {m.kind})
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleEnabled(m)}
              disabled={busy}
              className={`rounded-full border px-3 py-1 text-[11.5px] font-medium disabled:opacity-50 ${
                m.enabled
                  ? 'border-status-success/40 bg-status-success/10 text-status-success'
                  : 'border-border/60 text-text-muted'
              }`}
            >
              {m.enabled ? t('modelsPage.enabled') : t('modelsPage.disabled')}
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-[11.5px] font-medium text-text-muted">{t('modelsPage.staff.fallbackKeysTitle')}</p>
        {(['anthropic', 'openai'] as const).map((provider) => {
          const ps = keys?.providers.find((p) => p.provider === provider)
          return (
            <div key={provider} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-[12.5px] text-text-secondary">{provider}</span>
              <input
                type="password"
                autoComplete="off"
                value={keyDrafts[provider]}
                onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [provider]: e.target.value }))}
                placeholder={ps?.is_set ? t('modelsPage.staff.platformKeyReplace', { last4: ps.last4 }) : t('modelsPage.staff.platformKeyPlaceholder')}
                className="min-w-[240px] flex-1 rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
              />
              <button
                type="button"
                onClick={() => void saveKey(provider)}
                disabled={busy || !keyDrafts[provider].trim()}
                className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-accent-fg disabled:opacity-50"
              >
                {t('modelsPage.staff.save')}
              </button>
              {ps?.is_set ? (
                <button
                  type="button"
                  onClick={() => void removeKey(provider)}
                  disabled={busy}
                  className="rounded-lg border border-border/60 px-3 py-2 text-[12.5px] text-text-secondary"
                >
                  {t('modelsPage.remove')}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1.5">
          <span className="text-[11.5px] font-medium text-text-muted">{t('modelsPage.staff.markupLabel')}</span>
          <input
            type="number"
            step="0.05"
            min="1"
            value={markupDraft}
            onChange={(e) => setMarkupDraft(e.target.value)}
            className="w-32 rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveMarkup()}
          disabled={busy}
          className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-accent-fg disabled:opacity-50"
        >
          {t('modelsPage.staff.saveMarkup')}
        </button>
      </div>
    </section>
  )
}
