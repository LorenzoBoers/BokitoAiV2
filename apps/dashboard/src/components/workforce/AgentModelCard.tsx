import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/card'
import { useAuth } from '../../context/AuthContext'
import {
  getTenantModels,
  selectableChatModels,
  setAgentModel,
  type CatalogModel,
  type TenantModelRow,
} from '../../lib/models-api'
import { humanizeModelId, modelCostBand } from '../../lib/model-label'

type Props = {
  agentId: string
  currentModel?: string
  canEdit: boolean
  onChanged?: () => void
}

type ModelOption = TenantModelRow | CatalogModel

/** Model and runtime card on the agent detail page. */
export function AgentModelCard({ agentId, currentModel, canEdit, onChanged }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [models, setModels] = useState<ModelOption[]>([])
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
        setModels(selectableChatModels(data))
      })
      .catch(() => {
        if (!cancelled) setLoadError(t('workforce.agents.modelLoadError'))
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadKey, t])

  const current = models.find((m) => m.slug === currentModel || m.model_id === currentModel)
  const currentLabel = current?.display_name || humanizeModelId(currentModel)
  const providerLabel =
    current && 'provider_type' in current && current.provider_type
      ? current.provider_type
      : current && 'provider' in current
        ? current.provider
        : ''

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

  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Cpu size={15} className="text-accent" aria-hidden />
        <h3 className="text-base font-semibold text-text-heading">{t('workforce.agents.modelTitle')}</h3>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {t('workforce.agents.modelBody')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <select
            value={current?.slug ?? ''}
            onChange={(e) => void onSelect(e.target.value)}
            disabled={busy}
            className="min-w-[220px] rounded-lg border border-border/60 bg-bg-input px-3 py-2 text-[13px] text-text-primary disabled:opacity-50"
          >
            {!current ? <option value="">{currentLabel || t('workforce.agents.selectModel')}</option> : null}
            {models.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.display_name}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full border border-border/60 bg-bg-elevated/60 px-2.5 py-1 text-[12px] text-text-secondary">
            {currentLabel || t('workforce.agents.defaultModel')}
          </span>
        )}
        {current ? (
          <span
            className="text-[11px] text-text-muted"
            title={t('workforce.agents.modelCost', {
              input: (current.input_cost_per_mtok_cents / 100).toFixed(2),
              output: (current.output_cost_per_mtok_cents / 100).toFixed(2),
            })}
          >
            {providerLabel ? `${providerLabel} · ` : ''}
            {t(
              {
                low: 'workforce.agents.modelCostLow',
                medium: 'workforce.agents.modelCostMedium',
                high: 'workforce.agents.modelCostHigh',
              }[modelCostBand(current.input_cost_per_mtok_cents, current.output_cost_per_mtok_cents)],
            )}
          </span>
        ) : null}
      </div>

      {loadError ? (
        <p className="mt-2 text-[12px] text-status-error">
          {loadError}{' '}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="underline hover:text-text-primary"
          >
            {t('actions.retry', { ns: 'common' })}
          </button>
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[12px] text-status-error">{error}</p> : null}

      {canEdit ? (
        <p className="mt-2 text-[11px] text-text-muted">
          <Link to="/settings/models" className="text-accent hover:underline">
            {t('workforce.agents.openModels')}
          </Link>
        </p>
      ) : null}
    </Card>
  )
}
