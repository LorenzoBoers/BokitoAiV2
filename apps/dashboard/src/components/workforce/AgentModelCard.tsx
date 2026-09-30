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

  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Cpu size={15} className="text-accent" aria-hidden />
        <h3 className="text-base font-semibold text-text-heading">{t('workforce.agents.modelTitle')}</h3>
      </div>
      <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.modelBody')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <select
            value={current?.slug ?? ''}
            onChange={(e) => void onSelect(e.target.value)}
            disabled={busy || models.length <= 1}
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
          <p className="text-sm text-text-primary">
            {currentLabel}
            {providerLabel ? (
              <span className="ml-1.5 text-text-muted">({providerLabel})</span>
            ) : null}
          </p>
        )}
      </div>

      {loadError ? (
        <p className="mt-2 text-[12px] text-status-error">
          {loadError}{' '}
          <button type="button" className="underline" onClick={() => setReloadKey((k) => k + 1)}>
            {t('workforce.agents.retry')}
          </button>
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[12px] text-status-error">{error}</p> : null}

      <p className="mt-3 text-[12px] text-text-muted">
        <Link to="/settings/models" className="text-accent hover:underline">
          {t('workforce.agents.openModels')}
        </Link>
      </p>
    </Card>
  )
}
