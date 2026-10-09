import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { useConfirm } from '../components/ui/confirm-dialog'
import { IconTile } from '../components/ui/icon-tile'
import { Input } from '../components/ui/input'
import { InsetPanel } from '../components/ui/inset-panel'
import { Label } from '../components/ui/label'
import { OptionCard, OptionCardGrid } from '../components/ui/option-card'
import { Switch } from '../components/ui/switch'
import { ModelIcon, ModelOptionLabel } from '../components/ui/ModelIcon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { DEFAULT_BRAND_MARK } from '../lib/tenant-branding'
import { providerTypeLabel } from '../lib/model-label'
import { useIsAdmin } from '../hooks/useIsAdmin'
import {
  AUTOMATIC_MODE,
  createProvider,
  createTenantModel,
  deleteProvider,
  deleteTenantModel,
  getTenantModels,
  setCustomModelsOptIn,
  setWorkspaceChatMode,
  testProvider,
  updateProvider,
  workspaceChatMode,
  type ManagedAiModel,
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
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const confirm = useConfirm()
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

  const handleWorkspaceMode = async (mode: string) => {
    if (!token || busy || !isAdmin) return
    const current = data ? workspaceChatMode(data) : ''
    if (mode === current) return
    setBusy(true)
    try {
      setData(await setWorkspaceChatMode(token, mode))
      flashSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('modelsPage.setDefaultError'))
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
    if (!(await confirm({ description: t('modelsPage.removeModelConfirm', { name: row.display_name }), destructive: true }))) return
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
    if (!(await confirm({ description: t('modelsPage.removeConfirm', { name }), destructive: true }))) return
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

  const managedTiers: ManagedAiModel[] =
    managed?.models && managed.models.length > 0
      ? managed.models
      : managed?.chat
        ? [managed.chat]
        : []

  const tierBodyKey = (tier: string | undefined) => {
    if (tier === 'lighter') return 'modelsPage.managed.tiers.lighterBody'
    if (tier === 'heavier') return 'modelsPage.managed.tiers.heavierBody'
    return 'modelsPage.managed.tiers.standardBody'
  }

  const formatMtok = (cents: number | undefined) => {
    const value = Math.max(0, Number(cents) || 0) / 100
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: value < 1 ? 2 : value < 10 ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(value)
  }

  const formatContextWindow = (tokens: number | undefined) => {
    const n = Math.max(0, Number(tokens) || 0)
    if (n <= 0) return null
    if (n >= 1_000_000) {
      return t('modelsPage.specs.contextM', { count: Math.round(n / 1_000_000) })
    }
    if (n >= 1000) {
      return t('modelsPage.specs.contextK', { count: Math.round(n / 1000) })
    }
    return t('modelsPage.specs.contextTokens', { count: n })
  }

  const tierSpecsLine = (tier: (typeof managedTiers)[number]) => {
    const parts: string[] = []
    const ctx = formatContextWindow(tier.context_window)
    if (ctx) parts.push(t('modelsPage.specs.context', { size: ctx }))
    if (tier.supports_tools) parts.push(t('modelsPage.specs.tools'))
    if (tier.supports_vision) parts.push(t('modelsPage.specs.vision'))
    return parts.length ? parts.join(' · ') : null
  }

  return (
    <PageContent width="lg" className="space-y-6 pb-12">
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

      {/* Bokito AI models + workspace default */}
      <section className="panel space-y-3 px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <img
              src={DEFAULT_BRAND_MARK}
              alt=""
              aria-hidden
              className="mt-0.5 h-8 w-8 shrink-0 rounded-full object-contain"
            />
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-sm font-semibold text-text-heading">{t('modelsPage.managed.title')}</h2>
              <p className="text-sm text-text-muted">{t('modelsPage.managed.bodyDefault')}</p>
            </div>
          </div>
          <Badge
            variant={
              managed?.status === 'active'
                ? 'success'
                : managed?.status === 'standby'
                  ? 'secondary'
                  : 'warning'
            }
            dot={managed?.status === 'active'}
          >
            {statusLabel}
          </Badge>
        </div>
        <p className="text-xs text-text-muted">{t('modelsPage.managed.workspaceDefaultHint')}</p>
        {(() => {
          const wsMode = data ? workspaceChatMode(data) : ''
          const automaticSelected = wsMode === AUTOMATIC_MODE
          const defaultBadge = <Badge variant="ai">{t('modelsPage.managed.tiers.defaultBadge')}</Badge>
          return (
            <OptionCardGrid columns={4}>
              <OptionCard
                tone="ai"
                selected={automaticSelected}
                readOnly={!isAdmin}
                disabled={busy}
                onClick={() => void handleWorkspaceMode(AUTOMATIC_MODE)}
                icon={<IconTile icon={Sparkles} tone="ai" size="sm" />}
                title={t('modelsPage.managed.automatic.title')}
                description={t('modelsPage.managed.automatic.body')}
                badge={automaticSelected ? defaultBadge : null}
                className="min-h-[9.5rem]"
              />
              {managedTiers.map((tier) => {
                const specs = tierSpecsLine(tier)
                const selected = wsMode === tier.slug
                return (
                  <OptionCard
                    key={tier.slug}
                    tone="ai"
                    selected={selected}
                    readOnly={!isAdmin}
                    disabled={busy}
                    onClick={() => void handleWorkspaceMode(tier.slug)}
                    icon={<ModelIcon slug={tier.slug} provider={tier.provider} size={28} />}
                    title={tier.display_name}
                    description={t(tierBodyKey(tier.tier))}
                    badge={selected ? defaultBadge : null}
                    className="min-h-[9.5rem]"
                  >
                    {specs ? <span className="text-xs text-text-secondary">{specs}</span> : null}
                    <span className="text-xs text-text-secondary">
                      {t('modelsPage.pricingInOut', {
                        in: formatMtok(tier.input_cost_per_mtok_cents),
                        out: formatMtok(tier.output_cost_per_mtok_cents),
                      })}
                    </span>
                    <Badge
                      variant={tier.ready ? 'success' : 'warning'}
                      dot={tier.ready}
                      className="mt-auto w-fit"
                    >
                      {tier.ready
                        ? t('modelsPage.managed.active')
                        : t('modelsPage.managed.notConfigured')}
                    </Badge>
                  </OptionCard>
                )
              })}
            </OptionCardGrid>
          )
        })()}
        <ul className="flex flex-wrap items-center gap-2">
          {(
            [
              { key: 'modelsPage.managed.usp.eu', icon: Globe2 },
              { key: 'modelsPage.managed.usp.current', icon: RefreshCw },
              { key: 'modelsPage.managed.usp.privacy', icon: ShieldCheck },
              { key: 'modelsPage.managed.usp.competitive', icon: Zap },
            ] as const
            ).map(({ key, icon }) => (
            <li key={key}>
              <Badge variant="neutral" icon={icon}>
                {t(key)}
              </Badge>
            </li>
          ))}
        </ul>
        {managed?.status === 'standby' ? (
          <p className="text-sm text-text-muted">{t('modelsPage.managed.standbyHintNew')}</p>
        ) : null}
        {managed?.status === 'unconfigured' ? (
          <p className="text-sm text-status-warning">{t('modelsPage.managed.mockModeHintShort')}</p>
        ) : null}
        {managedTiers.some((tier) => tier.fallback_active) ? (
          <p className="text-sm text-status-warning">{t('modelsPage.managed.fallbackNoticeSoft')}</p>
        ) : null}
      </section>

      {/* Models list */}
      {!custom?.allowed ? (
        <section className="rounded-lg border border-dashed border-border/70 bg-bg-elevated px-5 py-4">
          <h2 className="text-sm font-semibold text-text-heading">{t('modelsPage.custom.lockedTitle')}</h2>
          <p className="mt-1 text-sm text-text-muted">{t('modelsPage.custom.lockedBody')}</p>
        </section>
      ) : (
        <section className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h2 className="text-base font-semibold text-text-heading">{t('modelsPage.custom.title')}</h2>
              <p className="text-sm text-text-muted">{t('modelsPage.custom.body')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="models-custom-opt-in"
                checked={Boolean(custom.enabled)}
                disabled={busy}
                onCheckedChange={(checked) => void handleOptIn(checked)}
              />
              <Label htmlFor="models-custom-opt-in" className="cursor-pointer text-sm text-text-primary">
                {t('modelsPage.custom.optIn')}
              </Label>
            </div>
          </div>

          {custom.enabled ? (
            <div className="space-y-4 border-t border-border/50 pt-4">
              {chatModels.length === 0 && !wizardOpen ? (
                <p className="text-sm text-text-muted">{t('modelsPage.custom.empty')}</p>
              ) : null}

              {chatModels.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-bg-elevated px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <ModelIcon
                      slug={row.slug}
                      modelId={row.model_id}
                      providerType={row.provider_type}
                      size={24}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="truncate-fade text-sm font-medium text-text-heading">{row.display_name}</p>
                      <p className="truncate-fade font-mono text-xs text-text-muted">
                        {row.connection_label ||
                          (row.provider_type ? providerTypeLabel(row.provider_type) : '') ||
                          ''}
                        {row.model_id ? ` · ${row.model_id}` : ''}
                      </p>
                    </div>
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
                <InsetPanel className="space-y-3 p-4">
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
                        <Select value={providerType} onValueChange={(value) => setProviderType(value as ProviderType)}>
                          <SelectTrigger className="mt-1" aria-label={t('modelsPage.providerType')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVIDER_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                        <Select
                          value={pickedModelId || undefined}
                          onValueChange={(value) => {
                            setPickedModelId(value)
                            setCustomModelId('')
                            const preset = presetModels.find((m) => m.model_id === value || m.slug === value)
                            if (preset) setDisplayName(preset.display_name)
                          }}
                        >
                          <SelectTrigger className="mt-1" aria-label={t('modelsPage.custom.pickPreset')}>
                            <SelectValue placeholder={t('modelsPage.custom.pickPresetPlaceholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            {presetModels.map((m) => (
                              <SelectItem key={m.slug} value={m.model_id}>
                                <ModelOptionLabel
                                  slug={m.slug}
                                  modelId={m.model_id}
                                  name={`${m.display_name} (${m.model_id})`}
                                />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                </InsetPanel>
              )}
            </div>
          ) : null}
        </section>
      )}
    </PageContent>
  )
}
