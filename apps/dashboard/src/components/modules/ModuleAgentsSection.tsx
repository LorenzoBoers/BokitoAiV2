import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Loader2, Settings2, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionRow } from '../ui/AgentOptionRow'
import { AgentSelect } from '../ui/AgentSelect'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import type { AgentVisualFields } from '../ui/AgentOptionRow'
import {
  addModuleAgent,
  listModuleCompanies,
  listModuleAgents,
  removeModuleAgent,
  setModuleAgentDefault,
  updateModuleAgentAccess,
  type ModuleAgentRow,
} from '../../lib/integrations-api'

/**
 * Module agent roster: only these agents get the module tools.
 * At least one is required before finishing setup; one is marked default for setup chat.
 */
export function ModuleAgentsSection({
  moduleSlug,
  agents,
  onChanged,
}: {
  moduleSlug: string
  agents: AgentVisualFields[]
  onChanged?: () => void
}) {
  const { t } = useTranslation(['nav', 'common'])
  const [roster, setRoster] = useState<ModuleAgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([])

  const load = useCallback(async () => {
    try {
      setRoster(await listModuleAgents(moduleSlug))
    } catch {
      setRoster([])
    } finally {
      setLoading(false)
    }
  }, [moduleSlug])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    void listModuleCompanies(moduleSlug)
      .then((data) => {
        if (!cancelled) {
          setCompanies(
            (data.companies ?? []).map((c) => ({ id: String(c.id), name: c.name || String(c.id) })),
          )
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [moduleSlug])

  const available = useMemo(() => {
    const taken = new Set(roster.map((row) => row.agent_id))
    return agents.filter((agent) => !taken.has(agent.id))
  }, [agents, roster])

  const notify = () => {
    onChanged?.()
  }

  const add = async (agentId: string) => {
    setAdding(true)
    try {
      await addModuleAgent(moduleSlug, agentId, roster.length === 0)
      await load()
      notify()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(
          err,
          t('integrations.modules.agents.addError', {
            defaultValue: 'Could not assign this agent.',
          }),
        ),
      )
    } finally {
      setAdding(false)
    }
  }

  const makeDefault = async (agentId: string) => {
    setBusyId(agentId)
    try {
      await setModuleAgentDefault(moduleSlug, agentId, true)
      await load()
      notify()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(
          err,
          t('integrations.modules.agents.defaultError', {
            defaultValue: 'Could not set the default agent.',
          }),
        ),
      )
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (agentId: string) => {
    setBusyId(agentId)
    try {
      await removeModuleAgent(moduleSlug, agentId)
      await load()
      notify()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(
          err,
          t('integrations.modules.agents.removeError', {
            defaultValue: 'Could not remove this agent.',
          }),
        ),
      )
    } finally {
      setBusyId(null)
    }
  }

  const updateAccess = async (
    agentId: string,
    body: { company_ids?: string[]; clear_company_scope?: boolean; can_write?: boolean },
  ) => {
    setBusyId(agentId)
    try {
      const updated = await updateModuleAgentAccess(moduleSlug, agentId, body)
      setRoster((rows) => rows.map((row) => (row.agent_id === agentId ? updated : row)))
      notify()
    } catch (err) {
      toast.error(
        formatApiErrorMessage(
          err,
          t('integrations.modules.agents.accessError', {
            defaultValue: 'Could not update module access for this agent.',
          }),
        ),
      )
    } finally {
      setBusyId(null)
    }
  }

  const toggleCompany = (row: ModuleAgentRow, companyId: string) => {
    const current = row.company_ids ?? []
    const next = current.includes(companyId)
      ? current.filter((id) => id !== companyId)
      : [...current, companyId]
    if (next.length === 0) {
      void updateAccess(row.agent_id, { clear_company_scope: true })
    } else {
      void updateAccess(row.agent_id, { company_ids: next })
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs text-text-muted">
          {t('integrations.modules.agents.label', { defaultValue: 'Assigned agents' })}
        </Label>
        <p className="mt-0.5 text-xs text-text-muted">
          {t('integrations.modules.agents.hint', {
            defaultValue:
              'At least one agent is required. Only assigned agents can use this module’s tools.',
          })}
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-text-muted">
          {t('integrations.modules.agents.loading', { defaultValue: 'Loading agents…' })}
        </p>
      ) : roster.length === 0 ? (
        <div className="space-y-1.5">
          <p className="text-sm text-text-muted">
            {t('integrations.modules.agents.empty', {
              defaultValue: 'No agents assigned yet. Add one to continue setup.',
            })}
          </p>
          <Link to="/agents" className="text-xs font-medium text-accent hover:underline">
            {t('integrations.modules.agents.openAgents', { defaultValue: 'Open Agents' })}
          </Link>
        </div>
      ) : (
        <ul className="space-y-1">
          {roster.map((row) => (
            <li key={row.id} className="rounded-md border border-border/50 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Link
                    to={`/agents/${row.agent_id}`}
                    className="min-w-0 hover:opacity-90"
                  >
                    <AgentOptionRow
                      agent={{
                        id: row.agent_id,
                        name: row.name,
                        avatar_kind: row.avatar_kind,
                        avatar_icon: row.avatar_icon,
                        avatar_color: row.avatar_color,
                        avatar_image_url: row.avatar_image_url,
                      }}
                      size={20}
                    />
                  </Link>
                  {row.is_default ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {t('integrations.modules.agents.defaultBadge', { defaultValue: 'Default' })}
                    </Badge>
                  ) : null}
                  {row.can_write ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {t('integrations.modules.agents.writeBadge', { defaultValue: 'Write' })}
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
                      {t('integrations.modules.agents.readOnlyBadge', { defaultValue: 'Read-only' })}
                    </Badge>
                  )}
                  {row.company_ids && row.company_ids.length > 0 ? (
                    <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
                      {t('integrations.modules.agents.scopeBadge', {
                        defaultValue: '{{count}} administration(s)',
                        count: row.company_ids.length,
                      })}
                    </Badge>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {moduleSlug === 'accounting' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      disabled={busyId !== null}
                      title={t('integrations.modules.agents.access', {
                        defaultValue: 'Access: scope and write permission',
                      })}
                      onClick={() =>
                        setAccessOpenId((open) => (open === row.id ? null : row.id))
                      }
                    >
                      <Settings2 size={12} />
                    </Button>
                  ) : null}
                  {!row.is_default ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      disabled={busyId !== null}
                      title={t('integrations.modules.agents.makeDefault', {
                        defaultValue: 'Make default for setup chat',
                      })}
                      onClick={() => void makeDefault(row.agent_id)}
                    >
                      {busyId === row.agent_id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Star size={12} />
                      )}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-text-muted hover:text-status-error"
                    disabled={busyId !== null}
                    title={t('integrations.modules.agents.remove', { defaultValue: 'Remove' })}
                    onClick={() => void remove(row.agent_id)}
                  >
                    {busyId === row.agent_id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <X size={12} />
                    )}
                  </Button>
                </span>
              </div>
              {accessOpenId === row.id && moduleSlug === 'accounting' ? (
                <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-text-primary">
                        {t('integrations.modules.agents.canWrite', {
                          defaultValue: 'Write access',
                        })}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {t('integrations.modules.agents.canWriteHint', {
                          defaultValue:
                            'Allow proposing accounting writes. Applying still needs human approval and the workspace write switch.',
                        })}
                      </p>
                    </div>
                    <Switch
                      checked={row.can_write}
                      disabled={busyId !== null}
                      onCheckedChange={(checked) =>
                        void updateAccess(row.agent_id, { can_write: checked })
                      }
                    />
                  </div>
                  {companies.length > 1 ? (
                    <div>
                      <p className="text-xs font-medium text-text-primary">
                        {t('integrations.modules.agents.scopeTitle', {
                          defaultValue: 'Administration scope',
                        })}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {t('integrations.modules.agents.scopeHint', {
                          defaultValue: 'No selection = access to all administrations.',
                        })}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {companies.map((company) => {
                          const selected = (row.company_ids ?? []).includes(company.id)
                          return (
                            <button
                              key={company.id}
                              type="button"
                              disabled={busyId !== null}
                              className={
                                selected
                                  ? 'rounded-full border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] text-accent'
                                  : 'rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-text-secondary hover:border-accent/40'
                              }
                              onClick={() => toggleCompany(row, company.id)}
                            >
                              {company.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <AgentSelect
          agents={available}
          value=""
          disabled={adding}
          placeholder={t('integrations.modules.agents.addPlaceholder', {
            defaultValue: 'Assign an agent…',
          })}
          onValueChange={(value) => void add(value)}
        />
      ) : null}
      {roster.some((row) => row.is_default) ? (
        <Button asChild variant="outline" size="sm" className="mt-1">
          <Link
            to={talkToAssistantPath(
              t('integrations.modules.setup.assistantPrefill', {
                name: t(`integrations.modules.${moduleSlug}.name`, { defaultValue: moduleSlug }),
              }),
              roster.find((row) => row.is_default)?.agent_id,
            )}
          >
            {t('integrations.modules.agents.chatSetup', {
              defaultValue: 'Continue setup with default agent',
            })}
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

export default ModuleAgentsSection
