import { useCallback, useEffect, useState } from 'react'
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

type Props = {
  agentId: string
  currentModel?: string
  canEdit: boolean
  onChanged?: () => void
}

type ModelOption = TenantModelRow | CatalogModel

/** Model and runtime card on the agent detail page. */
export function AgentModelCard({ agentId, currentModel, canEdit, onChanged }: Props) {
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
        if (!cancelled) setLoadError('Could not load the model list.')
      })
    return () => {
      cancelled = true
    }
  }, [token, reloadKey])

  const current = models.find((m) => m.slug === currentModel || m.model_id === currentModel)

  const onSelect = useCallback(
    async (slug: string) => {
      if (!token || busy || !slug) return
      setBusy(true)
      setError(null)
      try {
        await setAgentModel(token, agentId, slug)
        onChanged?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update model.')
      } finally {
        setBusy(false)
      }
    },
    [token, busy, agentId, onChanged],
  )

  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-2">
        <Cpu size={15} className="text-accent" aria-hidden />
        <h3 className="text-base font-semibold text-text-heading">Model and runtime</h3>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        The model this agent uses for reasoning and chat.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <select
            value={current?.slug ?? ''}
            onChange={(e) => void onSelect(e.target.value)}
            disabled={busy}
            className="min-w-[220px] rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary disabled:opacity-50"
          >
            {!current ? <option value="">{currentModel || 'Select a model'}</option> : null}
            {models.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.display_name}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full border border-border/60 bg-bg-elevated/60 px-2.5 py-1 text-[12px] text-text-secondary">
            {current?.display_name ?? currentModel ?? 'Default'}
          </span>
        )}
        {current ? (
          <span className="text-[11px] text-text-muted">
            {'provider_type' in current && current.provider_type
              ? current.provider_type
              : 'provider' in current
                ? current.provider
                : ''}{' '}
            · in ${(current.input_cost_per_mtok_cents / 100).toFixed(2)}/Mtok · out $
            {(current.output_cost_per_mtok_cents / 100).toFixed(2)}/Mtok
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
            Retry
          </button>
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[12px] text-status-error">{error}</p> : null}

      {canEdit ? (
        <p className="mt-2 text-[11px] text-text-muted">
          Manage providers and models in{' '}
          <Link to="/settings/models" className="text-accent hover:underline">
            workspace model settings
          </Link>
          .
        </p>
      ) : null}
    </Card>
  )
}
