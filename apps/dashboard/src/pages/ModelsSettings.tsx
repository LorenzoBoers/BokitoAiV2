import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Eye, EyeOff, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { providerTypeLabel } from '../lib/model-label'
import {
  createProvider,
  createTenantModel,
  deleteProvider,
  deleteTenantModel,
  getTenantModels,
  setCustomModelsOptIn,
  setDataRegionPolicy,
  testProvider,
  updateProvider,
  type ProviderType,
  type TenantModelRow,
  type TenantModelsPayload,
} from '../lib/models-api'

const PROVIDER_TYPE_OPTIONS: { value: ProviderType; labelKey: string }[] = [
  { value: 'mistral', labelKey: 'modelsPage.providers.mistral' },
  { value: 'anthropic', labelKey: 'modelsPage.providers.anthropic' },
  { value: 'openai', labelKey: 'modelsPage.providers.openai' },
  { value: 'openai_compatible', labelKey: 'modelsPage.providers.openaiCompatible' },
]

export default function ModelsSettings() {
  const { t } = useTranslation('nav')
  const { token, currentTenantRole } = useAuth()
  const isOwnerOrAdmin = currentTenantRole === 'owner' || currentTenantRole === 'admin'
  const [data, setData] = useState<TenantModelsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [providerType, setProviderType] = useState<ProviderType>('mistral')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [pickedModelId, setPickedModelId] = useState('')
  const [customModelId, setCustomModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [testMessage, setTestMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      setData(await getTenantModels(token))
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

  const custom = data?.custom_models
  const managed = data?.managed
  const presets = custom?.presets ?? data?.presets
  const needsBaseUrl = providerType === 'openai_compatible'
  const presetModels = useMemo(() => {
    if (!presets) return []
    return (presets[providerType]?.models ?? []).filter((m) => (m.kind || 'chat') !== 'embedding')
  }, [presets, providerType])

  const chatModels = useMemo(
    () => (custom?.models ?? []).filter((row) => (row.kind || 'chat') !== 'embedding'),
    [custom?.models],
  )

  const resetWizard = () => {
    setWizardOpen(false)
    setStep(1)
    setProviderType('mistral')
    setLabel('')
    setBaseUrl('')
    setApiKey('')
    setConnectionId(null)
    setPickedModelId('')
    setCustomModelId('')
    setDisplayName('')
    setTestMessage(null)
  }

  const handleOptIn = async (enabled: boolean) => {
    if (!token || busy) return
    setBusy(true)
    try {
      setData(await setCustomModelsOptIn(token, enabled))
      flashSaved()
      if (!enabled) resetWizard()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.updateModelError'))
    } finally {
      setBusy(false)
    }
  }

  const handleRegionPolicy = async (allowUs: boolean) => {
    if (!token || busy) return
    setBusy(true)
    try {
      setData(await setDataRegionPolicy(token, allowUs ? 'allowed' : 'blocked'))
      flashSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.updateModelError'))
    } finally {
      setBusy(false)
    }
  }

  const handleCreateProvider = async () => {
    if (!token || busy || !apiKey.trim()) return
    if (needsBaseUrl && !baseUrl.trim()) {
      toast.error(t('modelsPage.baseUrlRequired'))
      return
    }
    setBusy(true)
    setTestMessage(null)
    try {
      const conn = await createProvider(token, {
        provider_type: providerType,
        label: label.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      })
      setConnectionId(conn.id)
      const result = await testProvider(token, conn.id)
      setTestMessage(result.ok ? t('modelsPage.connectionOk') : result.message || t('modelsPage.testFailed'))
      if (result.ok) setStep(3)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.addProviderError'))
    } finally {
      setBusy(false)
    }
  }

  const handleAddModel = async () => {
    if (!token || busy || !connectionId) return
    const modelId = (pickedModelId || customModelId).trim()
    if (!modelId) return
    const preset = presetModels.find((m) => m.model_id === modelId || m.slug === modelId)
    setBusy(true)
    try {
      await createTenantModel(token, {
        connection_id: connectionId,
        model_id: modelId,
        display_name: displayName.trim() || preset?.display_name || modelId,
        kind: 'chat',
        slug: preset?.slug || undefined,
        enabled: true,
        is_default_chat: true,
        is_default_embedding: false,
      })
      flashSaved()
      resetWizard()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.addModelError'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveModel = async (row: TenantModelRow) => {
    if (!token || busy) return
    if (!window.confirm(t('modelsPage.removeModelConfirm', { name: row.display_name }))) return
    setBusy(true)
    try {
      await deleteTenantModel(token, row.id)
      flashSaved()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.updateModelError'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveProvider = async (id: string, name: string) => {
    if (!token || busy) return
    if (!window.confirm(t('modelsPage.removeConfirm', { name }))) return
    setBusy(true)
    try {
      await deleteProvider(token, id)
      flashSaved()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.removeProviderError'))
    } finally {
      setBusy(false)
    }
  }

  const handleRotateKey = async (id: string, key: string) => {
    if (!token || busy || !key.trim()) return
    setBusy(true)
    try {
      await updateProvider(token, id, { api_key: key.trim() })
      flashSaved()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.updateProviderError'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <PageContent width="md" className="flex items-center gap-2 py-16 text-sm text-text-muted">
        <Loader2 size={16} className="animate-spin" />
        {t('modelsPage.loading', { defaultValue: 'Loading…' })}
      </PageContent>
    )
  }

  const statusLabel =
    managed?.status === 'active'
      ? t('modelsPage.managed.active')
      : managed?.status === 'standby'
        ? t('modelsPage.managed.standby')
        : t('modelsPage.managed.notConfigured')

  const dataRegion = data?.data_region
  const allowUs = dataRegion?.non_eu_platform_models === 'allowed'
  const chat = managed?.chat

  return (
    <PageContent width="md" className="space-y-6 pb-12">
      <ContentHeader
        guide="models"
        title={t('modelsPage.pageTitle')}
        subtitle={t('modelsPage.pageSubtitle')}
        className="mb-0"
        meta={
          saved ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-success">
              <Check size={12} />
              {t('modelsPage.saved')}
            </span>
          ) : null
        }
      />
      {error ? <p className="text-sm text-status-error">{error}</p> : null}

      {/* Bokito AI banner */}
      <section className="rounded-lg border border-border/70 bg-bg-surface px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-ai/10 text-ai-ink">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-text-heading">{t('modelsPage.managed.title')}</h2>
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  {t('modelsPage.managed.euHint')}
                </span>
              </div>
              <p className="text-sm text-text-muted">{t('modelsPage.managed.bodyDefault')}</p>
            </div>
          </div>
          <span
            className={
              managed?.status === 'active'
                ? 'rounded-full bg-status-success/15 px-2.5 py-0.5 text-xs font-semibold text-status-success'
                : managed?.status === 'standby'
                  ? 'rounded-full bg-bg-hover px-2.5 py-0.5 text-xs font-semibold text-text-secondary'
                  : 'rounded-full bg-status-warning/15 px-2.5 py-0.5 text-xs font-semibold text-status-warning'
            }
          >
            {statusLabel}
          </span>
        </div>
        {managed?.status === 'standby' ? (
          <p className="mt-2 text-sm text-text-muted">{t('modelsPage.managed.standbyHintNew')}</p>
        ) : null}
        {managed?.status === 'unconfigured' ? (
          <p className="mt-2 text-sm text-status-warning">{t('modelsPage.managed.mockModeHintShort')}</p>
        ) : null}
        {chat?.fallback_active ? (
          <p className="mt-2 text-sm text-status-warning">{t('modelsPage.managed.fallbackNoticeSoft')}</p>
        ) : null}
      </section>

      {/* Models list */}
      {!custom?.allowed ? (
        <section className="rounded-lg border border-dashed border-border/70 bg-bg-elevated/40 px-5 py-4">
          <h2 className="text-sm font-semibold text-text-heading">{t('modelsPage.custom.lockedTitle')}</h2>
          <p className="mt-1 text-sm text-text-muted">{t('modelsPage.custom.lockedBody')}</p>
        </section>
      ) : (
        <section className="space-y-4 rounded-lg border border-border/70 bg-bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold text-text-heading">{t('modelsPage.custom.title')}</h2>
              <p className="text-sm text-text-muted">{t('modelsPage.custom.body')}</p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={Boolean(custom.enabled)}
                disabled={busy}
                onChange={(e) => void handleOptIn(e.target.checked)}
              />
              {t('modelsPage.custom.optIn')}
            </label>
          </div>

          {custom.enabled ? (
            <div className="space-y-4 border-t border-border/50 pt-4">
              {chatModels.length === 0 && !wizardOpen ? (
                <p className="text-sm text-text-muted">{t('modelsPage.custom.empty')}</p>
              ) : null}

              {chatModels.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-bg-elevated/50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate-fade text-sm font-medium text-text-heading">{row.display_name}</p>
                    <p className="truncate-fade font-mono text-xs text-text-muted">
                      {row.connection_label ||
                        (row.provider_type ? providerTypeLabel(row.provider_type) : '') ||
                        ''}
                      {row.model_id ? ` · ${row.model_id}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void handleRemoveModel(row)}
                    className="gap-1 text-text-muted"
                  >
                    <Trash2 size={13} />
                    {t('modelsPage.remove')}
                  </Button>
                </div>
              ))}

              {(custom.connections ?? []).map((conn) => (
                <div
                  key={conn.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs text-text-muted"
                >
                  <span>
                    {conn.label || providerTypeLabel(conn.provider_type)}
                    {conn.is_set ? ` · ${t('modelsPage.keySet', { last4: conn.last4 })}` : ''}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        const next = window.prompt(t('modelsPage.apiKeyPlaceholder'))
                        if (next) void handleRotateKey(conn.id, next)
                      }}
                    >
                      {t('modelsPage.custom.replaceKey')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleRemoveProvider(conn.id, conn.label || conn.provider_type)}
                    >
                      {t('modelsPage.remove')}
                    </Button>
                  </div>
                </div>
              ))}

              {!wizardOpen ? (
                <Button type="button" size="sm" className="gap-1.5" disabled={busy} onClick={() => setWizardOpen(true)}>
                  <Plus size={14} />
                  {t('modelsPage.custom.addModel')}
                </Button>
              ) : (
                <div className="space-y-3 rounded-lg border border-border/60 bg-bg-elevated/40 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text-heading">
                      {t('modelsPage.custom.wizardTitle', { step })}
                    </p>
                    <Button type="button" size="sm" variant="ghost" onClick={resetWizard}>
                      {t('modelsPage.cancel')}
                    </Button>
                  </div>

                  {step === 1 ? (
                    <div className="space-y-3">
                      <div>
                        <Label>{t('modelsPage.providerType')}</Label>
                        <select
                          value={providerType}
                          onChange={(e) => setProviderType(e.target.value as ProviderType)}
                          className="mt-1 w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-sm"
                        >
                          {PROVIDER_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {t(opt.labelKey)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>
                          {needsBaseUrl ? t('modelsPage.labelOptionalCustom') : t('modelsPage.labelOptional')}
                        </Label>
                        <Input
                          value={label}
                          onChange={(e) => setLabel(e.target.value)}
                          placeholder={t('modelsPage.labelPlaceholder')}
                          className="mt-1"
                        />
                      </div>
                      {needsBaseUrl ? (
                        <div>
                          <Label>{t('modelsPage.baseUrl')}</Label>
                          <Input
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder={t('modelsPage.baseUrlPlaceholder')}
                            className="mt-1"
                          />
                        </div>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        disabled={needsBaseUrl && !baseUrl.trim()}
                        onClick={() => setStep(2)}
                      >
                        {t('modelsPage.custom.next')}
                      </Button>
                    </div>
                  ) : null}

                  {step === 2 ? (
                    <div className="space-y-3">
                      <div>
                        <Label>{t('modelsPage.apiKey')}</Label>
                        <div className="mt-1 flex gap-2">
                          <Input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={t('modelsPage.apiKeyPlaceholder')}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setShowKey((v) => !v)}
                            aria-label={showKey ? t('modelsPage.hideKey') : t('modelsPage.showKey')}
                          >
                            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                          </Button>
                        </div>
                      </div>
                      {testMessage ? <p className="text-xs text-text-muted">{testMessage}</p> : null}
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setStep(1)}>
                          {t('modelsPage.custom.back')}
                        </Button>
                        <Button type="button" size="sm" disabled={busy || !apiKey.trim()} onClick={() => void handleCreateProvider()}>
                          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                          {t('modelsPage.custom.saveAndTest')}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {step === 3 ? (
                    <div className="space-y-3">
                      <div>
                        <Label>{t('modelsPage.custom.pickPreset')}</Label>
                        <select
                          value={pickedModelId}
                          onChange={(e) => {
                            setPickedModelId(e.target.value)
                            setCustomModelId('')
                            const preset = presetModels.find(
                              (m) => m.model_id === e.target.value || m.slug === e.target.value,
                            )
                            if (preset) setDisplayName(preset.display_name)
                          }}
                          className="mt-1 w-full rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-sm"
                        >
                          <option value="">{t('modelsPage.custom.pickPresetPlaceholder')}</option>
                          {presetModels.map((m) => (
                            <option key={m.slug} value={m.model_id}>
                              {m.display_name} ({m.model_id})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label>{t('modelsPage.custom.orCustomId')}</Label>
                        <Input
                          value={customModelId}
                          onChange={(e) => {
                            setCustomModelId(e.target.value)
                            setPickedModelId('')
                          }}
                          placeholder={t('modelsPage.modelIdPlaceholder')}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>{t('modelsPage.displayNamePlaceholder')}</Label>
                        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1" />
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => setStep(2)}>
                          {t('modelsPage.custom.back')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || !(pickedModelId || customModelId).trim()}
                          onClick={() => void handleAddModel()}
                        >
                          {t('modelsPage.addModel')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      {/* Data processing — secondary */}
      <details className="group rounded-lg border border-border/50 bg-bg-elevated/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-text-secondary marker:content-none [&::-webkit-details-marker]:hidden">
          <span>{t('modelsPage.region.title')}</span>
          <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-border/40 px-4 py-3">
          <p className="text-sm text-text-muted">{t('modelsPage.region.body')}</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-bg-surface/60 px-3 py-3 text-sm text-text-primary">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border"
              checked={allowUs}
              disabled={busy || !isOwnerOrAdmin}
              onChange={(e) => void handleRegionPolicy(e.target.checked)}
            />
            <span className="space-y-0.5">
              <span className="block font-medium">{t('modelsPage.region.allowUs')}</span>
              <span className="block text-sm text-text-muted">{t('modelsPage.region.allowUsHint')}</span>
            </span>
          </label>
          {dataRegion && dataRegion.non_eu_models_in_use.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-text-primary">{t('modelsPage.region.inUseTitle')}</p>
              <ul className="flex flex-wrap gap-2">
                {dataRegion.non_eu_models_in_use.map((slug) => (
                  <li
                    key={slug}
                    className="rounded-md border border-border/60 px-3 py-1.5 text-sm text-text-primary"
                  >
                    {slug}
                  </li>
                ))}
              </ul>
              {!allowUs ? (
                <p className="text-xs text-text-muted">{t('modelsPage.region.inUseBlockedHint')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </PageContent>
  )
}
