import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, Cpu, Loader2, Plus, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
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

function pricePerMtok(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/Mtok`
}

export default function ModelsSettings() {
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
      setError(err instanceof Error ? err.message : 'Could not load models.')
    } finally {
      setLoading(false)
    }
  }, [token])

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
      setError(err instanceof Error ? err.message : 'Could not add provider.')
    } finally {
      setBusy(false)
    }
  }

  const handleEnablePresets = async (connectionId: string) => {
    if (!token || busy) return
    setBusy(true)
    try {
      await createTenantModel(token, { connection_id: connectionId, enable_presets: true })
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable preset models.')
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
      setError(err instanceof Error ? err.message : 'Could not update model.')
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
      setError(err instanceof Error ? err.message : 'Could not set default.')
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
      setError(err instanceof Error ? err.message : 'Could not add model.')
    } finally {
      setBusy(false)
    }
  }

  const handleTestConnection = async (connectionId: string) => {
    if (!token) return
    setTestResults((prev) => ({ ...prev, [connectionId]: 'Testing...' }))
    try {
      const result = await testProvider(token, connectionId)
      setTestResults((prev) => ({
        ...prev,
        [connectionId]: result.ok ? 'Connection OK' : result.message,
      }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [connectionId]: err instanceof Error ? err.message : 'Test failed',
      }))
    }
  }

  const handleDeleteProvider = async (connectionId: string) => {
    if (!token || busy) return
    setBusy(true)
    try {
      await deleteProvider(token, connectionId)
      flashSaved()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove provider.')
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
      setError(err instanceof Error ? err.message : 'Could not update provider.')
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

  return (
    <PageContent width="lg" className="space-y-7 py-1">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-bg-surface text-accent shadow-card">
          <Cpu size={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-text-heading">AI providers</h2>
          <p className="text-[12.5px] text-text-muted">
            Bokito AI runs your workspace by default. Optionally bring your own provider keys to
            take control over models and pay the provider directly.
          </p>
        </div>
      </div>

      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
      {saved ? (
        <p className="inline-flex items-center gap-1 text-[12px] text-status-success">
          <Check size={13} /> Saved
        </p>
      ) : null}

      {data?.managed ? <ManagedAiCard managed={data.managed} /> : null}

      {/* Providers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-text-heading">Your own providers</h3>
            <p className="text-[11.5px] text-text-muted">
              Optional. Models enabled on your own keys take precedence over Bokito AI; usage is
              then billed by the provider, not through Bokito. Keys are encrypted; only the last
              four characters are shown.
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
            Add provider
          </Button>
        </div>

        {showAddProvider ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-bg-elevated p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <Label>Provider type</Label>
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
                <Label>Label (optional)</Label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Production OpenAI" />
              </label>
            </div>
            {newProviderType === 'openai_compatible' ? (
              <label className="space-y-1.5">
                <Label>Base URL</Label>
                <Input
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                />
              </label>
            ) : null}
            <label className="space-y-1.5">
              <Label>API key</Label>
              <Input
                type="password"
                autoComplete="off"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void handleAddProvider()} disabled={busy || !newApiKey.trim()}>
                Save provider
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowAddProvider(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {connections.length === 0 ? (
          <p className="text-[12px] text-text-muted">
            No own providers configured. Your workspace runs on Bokito AI.
          </p>
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
                    <span className="text-[11px] font-normal text-text-muted">({conn.provider_type})</span>
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {conn.is_set ? `Key set ····${conn.last4}` : 'No key'}
                    {conn.base_url ? ` · ${conn.base_url}` : ''}
                  </p>
                  {testResults[conn.id] ? (
                    <p className="text-[11px] text-text-muted">{testResults[conn.id]}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestConnection(conn.id)}
                    className="rounded-full border border-border/60 px-3 py-1 text-[11.5px] text-text-secondary hover:text-accent"
                  >
                    Test
                  </button>
                  {conn.provider_type !== 'openai_compatible' ? (
                    <button
                      type="button"
                      onClick={() => void handleEnablePresets(conn.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/40 px-3 py-1 text-[11.5px] text-accent hover:bg-accent/5 disabled:opacity-50"
                    >
                      <Zap size={12} /> Enable presets
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
                    {conn.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteProvider(conn.id)}
                    disabled={busy}
                    className="rounded-full border border-border/60 px-3 py-1 text-[11.5px] text-text-muted hover:text-status-error disabled:opacity-50"
                  >
                    Remove
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
          <h3 className="text-[13px] font-semibold text-text-heading">Add custom model</h3>
          <p className="text-[11.5px] text-text-muted">
            For OpenAI-compatible providers, enter the model ID your endpoint expects.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={customModelConn}
              onChange={(e) => setCustomModelConn(e.target.value)}
              className="rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
            >
              <option value="">Select provider</option>
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
              placeholder="Model ID"
            />
            <Input
              value={customDisplayName}
              onChange={(e) => setCustomDisplayName(e.target.value)}
              placeholder="Display name (optional)"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleAddCustomModel()}
            disabled={busy || !customModelConn || !customModelId.trim()}
          >
            Add model
          </Button>
        </section>
      ) : null}

      {/* Tenant models */}
      {isTenantMode ? (
        <>
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold text-text-heading">Default models</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[11.5px] font-medium text-text-muted">Default chat model</span>
                <select
                  value={data.default_chat}
                  onChange={(e) => {
                    const model = chatModels.find((m) => m.slug === e.target.value)
                    if (model) void handleSetDefault(model, 'is_default_chat')
                  }}
                  className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
                >
                  <option value="">None</option>
                  {chatModels.filter((m) => m.enabled).map((m) => (
                    <option key={m.id} value={m.slug}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11.5px] font-medium text-text-muted">Default embedding model</span>
                <select
                  value={data.default_embedding}
                  onChange={(e) => {
                    const model = embeddingModels.find((m) => m.slug === e.target.value)
                    if (model) void handleSetDefault(model, 'is_default_embedding')
                  }}
                  className="w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
                >
                  <option value="">None</option>
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
            <h3 className="text-[13px] font-semibold text-text-heading">Models</h3>
            {tenantModels.length === 0 ? (
              <p className="text-[12px] text-text-muted">
                Enable preset models on a provider or add a custom model above.
              </p>
            ) : (
              <div className="space-y-2">
                {tenantModels.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-elevated px-3.5 py-2.5"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-text-heading">{m.display_name}</p>
                      <p className="text-[11px] text-text-muted">
                        {m.connection_label ?? m.provider_type} · {m.slug} · {m.model_id}
                        {m.kind === 'chat'
                          ? ` · in ${pricePerMtok(m.input_cost_per_mtok_cents)} · out ${pricePerMtok(m.output_cost_per_mtok_cents)}`
                          : ''}
                      </p>
                    </div>
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
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                ))}
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
  const statusBadge =
    managed.status === 'active' ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-[11.5px] font-medium text-status-success">
        Active
      </span>
    ) : managed.status === 'standby' ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-bg-hover/50 px-2.5 py-1 text-[11.5px] font-medium text-text-muted">
        Standby
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11.5px] font-medium text-amber-500">
        Not configured
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
            <p className="text-[13.5px] font-semibold text-text-heading">Bokito AI</p>
            <p className="max-w-xl text-[12px] text-text-muted">
              Managed by Bokito: we select and maintain the best model for each task
              automatically. Usage is metered per token for this workspace and counts toward your
              budget.
            </p>
          </div>
        </div>
        {statusBadge}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-surface px-2.5 py-1 text-text-secondary">
          Chat
          <span className="font-medium text-text-primary">{managed.chat.display_name}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-surface px-2.5 py-1 text-text-secondary">
          Embeddings
          <span className="font-medium text-text-primary">{managed.embedding.display_name}</span>
        </span>
        <Link
          to="/usage"
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
        >
          View usage <ArrowUpRight size={12} />
        </Link>
      </div>

      {managed.status === 'standby' ? (
        <p className="mt-2.5 text-[11.5px] text-text-muted">
          This workspace runs on your own provider keys below; Bokito AI stays available as
          fallback when you remove them.
        </p>
      ) : null}
      {managed.status === 'unconfigured' ? (
        <p className="mt-2.5 text-[11.5px] text-amber-500">
          No platform key is configured, so AI calls run in mock mode. Contact Bokito support or
          add your own provider key below.
        </p>
      ) : null}
      {managed.chat.key_source === 'tenant' && managed.status === 'active' ? (
        <p className="mt-2.5 text-[11.5px] text-text-muted">
          Runs on your own {managed.chat.provider} key (legacy), so usage is not billed through
          Bokito.
        </p>
      ) : null}
    </section>
  )
}

function StaffCatalogAdmin({ token }: { token: string | null }) {
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
      setError(err instanceof Error ? err.message : 'Could not load staff catalog.')
    }
  }, [token])

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
      setError('Markup must be at least 1.0')
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
        <h3 className="text-[13px] font-semibold text-text-heading">Platform administration (staff)</h3>
      </div>
      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}

      <div className="space-y-2">
        <p className="text-[11.5px] font-medium text-text-muted">Platform catalog (legacy fallback)</p>
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
              {m.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-[11.5px] font-medium text-text-muted">Bokito fallback keys</p>
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
                placeholder={ps?.is_set ? `Set ····${ps.last4} — replace` : 'Enter platform key'}
                className="min-w-[240px] flex-1 rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px]"
              />
              <button
                type="button"
                onClick={() => void saveKey(provider)}
                disabled={busy || !keyDrafts[provider].trim()}
                className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
              >
                Save
              </button>
              {ps?.is_set ? (
                <button
                  type="button"
                  onClick={() => void removeKey(provider)}
                  disabled={busy}
                  className="rounded-lg border border-border/60 px-3 py-2 text-[12.5px] text-text-secondary"
                >
                  Remove
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1.5">
          <span className="text-[11.5px] font-medium text-text-muted">Token resale markup (x)</span>
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
          className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
        >
          Save markup
        </button>
      </div>
    </section>
  )
}
