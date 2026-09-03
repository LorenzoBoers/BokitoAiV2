import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, X } from 'lucide-react'
import { Button } from '../ui/button'
import { getAllowances, updateAgentPassport, type GovernToolRow } from '../../lib/govern-api'
import { toolCategoryLabel } from '../../lib/govern-labels'
import { humanizeLabel } from '../../lib/labels'
import { cn } from '../../lib/utils'

type Props = {
  agentId: string
  allowedTools: string[]
  canEdit: boolean
  onSaved: (allowedTools: string[]) => void
}

/**
 * Shows and edits the agent passport tool allowlist. An empty allowlist means
 * "all tools, gated by workspace allowances"; a non-empty list restricts the
 * agent to exactly those tools.
 */
export function AgentToolsPicker({ agentId, allowedTools, canEdit, onSaved }: Props) {
  const { t } = useTranslation('nav')
  const [editing, setEditing] = useState(false)
  const [available, setAvailable] = useState<GovernToolRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set(allowedTools))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelected(new Set(allowedTools))
  }, [allowedTools])

  useEffect(() => {
    if (available !== null) return
    getAllowances()
      .then((res) => setAvailable(res.tools))
      .catch(() => setAvailable([]))
  }, [available])

  const byCategory = useMemo(() => {
    const groups = new Map<string, GovernToolRow[]>()
    for (const tool of available ?? []) {
      const list = groups.get(tool.category) ?? []
      list.push(tool)
      groups.set(tool.category, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [available])

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const save = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const list = [...selected].sort()
      await updateAgentPassport(agentId, { allowed_tools: list })
      onSaved(list)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workforce.agents.toolsSaveError'))
    } finally {
      setBusy(false)
    }
  }, [agentId, selected, onSaved, t])

  if (!editing) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.allowedTools')}
          </p>
          {canEdit ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
              onClick={() => setEditing(true)}
            >
              <Pencil size={11} aria-hidden />
              {t('workforce.agents.editTools')}
            </button>
          ) : null}
          <Link
            to="/settings/govern?tab=policy"
            className="text-[11px] text-accent hover:underline"
          >
            {t('workforce.agents.openGovern')}
          </Link>
          <Link
            to="/connections/connected"
            className="text-[11px] text-accent hover:underline"
          >
            {t('workforce.agents.openIntegrations')}
          </Link>
        </div>
        {allowedTools.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {allowedTools.map((tool) => (
              <span
                key={tool}
                title={tool}
                className="rounded-full border border-border/60 bg-bg-elevated/60 px-2 py-0.5 text-[11px] text-text-secondary"
              >
                {humanizeLabel(tool)}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-1">
            <p className="text-sm text-text-muted">
              {t('workforce.agents.allToolsByPolicy')}
            </p>
            {available && available.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[...new Set(available.map((tool) => tool.category))].map((category) => (
                  <span
                    key={category}
                    className="rounded-full border border-border/60 bg-bg-elevated/60 px-2 py-0.5 text-[11px] text-text-secondary"
                  >
                    {toolCategoryLabel(category, t)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {t('workforce.agents.allowedTools')}
        </p>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            <X size={13} className="mr-1" aria-hidden />
            {t('workforce.agents.cancelTools')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void save()} disabled={busy}>
            {t('workforce.agents.saveTools')}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {t('workforce.agents.toolsPickerHint')}
      </p>
      {error ? <p className="mt-1 text-xs text-status-error">{error}</p> : null}
      {available === null ? (
        <p className="mt-2 text-sm text-text-muted">
          {t('workforce.agents.toolsLoading')}
        </p>
      ) : (
        <div className="mt-2 max-h-72 space-y-3 overflow-y-auto pr-1">
          {byCategory.map(([category, tools]) => (
            <div key={category}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                {toolCategoryLabel(category, t)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {tools.map((tool) => {
                  const active = selected.has(tool.name)
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      title={tool.description}
                      onClick={() => toggle(tool.name)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                        active
                          ? 'border-accent/50 bg-accent/12 text-accent'
                          : 'border-border/60 bg-bg-elevated/60 text-text-secondary hover:border-border',
                      )}
                    >
                      {humanizeLabel(tool.name)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
