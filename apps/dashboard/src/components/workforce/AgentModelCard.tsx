import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/card'
import { ModelIcon, ModelOptionLabel } from '../ui/ModelIcon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useAuth } from '../../context/AuthContext'
import {
  AUTOMATIC_MODE,
  INHERIT_MODE,
  agentChatModeOptions,
  getTenantModels,
  normalizeAgentChatMode,
  setAgentModel,
  type SelectableChatModel,
} from '../../lib/models-api'
import { humanizeModelId } from '../../lib/model-label'

type Props = {
  agentId: string
  currentModel?: string
  canEdit: boolean
  onChanged?: () => void
}

/** Model and runtime card on the agent detail page. */
export function AgentModelCard({ agentId, currentModel, canEdit, onChanged }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [models, setModels] = useState<SelectableChatModel[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!token) return
    setLoadError(null)
    getTenantModels(token)
      .then((data) => {
        if (cancelled) return
        setModels(agentChatModeOptions(data))
      })
      .catch(() => {
        if (!cancelled) setLoadError(t('workforce.agents.modelLoadError'))
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadKey, t])

  const mode = normalizeAgentChatMode(currentModel)
  const current = models.find((m) => m.slug === mode || m.model_id === currentModel)
  const modeLabel = (slug: string) => {
    if (slug === INHERIT_MODE) return t('workforce.agents.modelMode.inherit')
    if (slug === AUTOMATIC_MODE) return t('workforce.agents.modelMode.automatic')
    return ''
  }
  const currentLabel =
    modeLabel(mode) || current?.display_name || humanizeModelId(currentModel)
  const providerLabel = current?.provider_type || current?.provider || ''

  const onSelect = useCallback(
    async (slug: string) => {
      if (!token || busy || !slug) return
      setBusy(true)
      setError(null)
      try {
        await setAgentModel(token, agentId, slug)
        onChanged?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('workforce.agents.modelUpdateError'))
      } finally {
        setBusy(false)
      }
    },
    [token, busy, agentId, onChanged, t],
  )

  const optionHint = (m: SelectableChatModel) => {
    if (m.slug === INHERIT_MODE) return t('workforce.agents.modelMode.inheritHint')
    if (m.slug === AUTOMATIC_MODE) return t('workforce.agents.modelMode.automaticHint')
    const tierKey =
      m.tier === 'lighter' || m.tier === 'heavier' || m.tier === 'standard'
        ? `workforce.agents.modelTier.${m.tier}`
        : ''
    return tierKey ? t(tierKey) : ''
  }

  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Cpu size={15} className="text-accent" aria-hidden />
        <h3 className="text-base font-semibold text-text-heading">{t('workforce.agents.modelTitle')}</h3>
      </div>
      <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.modelBody')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Select
            value={mode}
            onValueChange={(slug) => void onSelect(slug)}
            disabled={busy || models.length <= 1}
          >
            <SelectTrigger className="h-9 min-w-[220px] w-auto text-sm" aria-label={t('workforce.agents.modelTitle')}>
              <SelectValue placeholder={currentLabel || t('workforce.agents.selectModel')} />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => {
                const hint = optionHint(m)
                const name = modeLabel(m.slug) || m.display_name
                return (
                  <SelectItem key={m.slug} value={m.slug}>
                    {m.slug === AUTOMATIC_MODE || m.slug === INHERIT_MODE ? (
                      <span className="inline-flex items-center gap-2">
                        {m.slug === AUTOMATIC_MODE ? (
                          <Sparkles size={16} className="text-ai-ink" aria-hidden />
                        ) : (
                          <Cpu size={16} className="text-text-muted" aria-hidden />
                        )}
                        <span>
                          <span className="font-medium">{name}</span>
                          {hint ? (
                            <span className="ml-1.5 text-xs text-text-muted">{hint}</span>
                          ) : null}
                        </span>
                      </span>
                    ) : (
                      <ModelOptionLabel
                        slug={m.slug}
                        modelId={m.model_id}
                        provider={m.provider}
                        providerType={m.provider_type}
                        name={name}
                        hint={hint || undefined}
                      />
                    )}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm text-text-primary">
            {mode === AUTOMATIC_MODE ? (
              <Sparkles size={18} className="text-ai-ink" aria-hidden />
            ) : mode === INHERIT_MODE ? (
              <Cpu size={18} className="text-text-muted" aria-hidden />
            ) : (
              <ModelIcon
                slug={current?.slug || currentModel}
                modelId={current?.model_id}
                provider={current?.provider || providerLabel}
                providerType={current?.provider_type}
                size={18}
              />
            )}
            {currentLabel}
          </p>
        )}
        <Link to="/settings/models" className="text-xs font-medium text-accent hover:underline">
          {t('workforce.agents.openModels')}
        </Link>
      </div>

      {loadError ? (
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="mt-2 text-xs font-medium text-accent hover:underline"
        >
          {loadError}
        </button>
      ) : null}
      {error ? <p className="mt-2 text-xs text-status-error">{error}</p> : null}
    </Card>
  )
}
