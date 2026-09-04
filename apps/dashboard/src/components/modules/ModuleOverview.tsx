import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Lock,
  MessageSquare,
  PenLine,
} from 'lucide-react'
import { inboxPath } from '../../lib/messages-paths'
import { moduleHomePath, type IntegrationModuleRow } from '../../lib/integration-modules'
import { ModuleToolsetPanel } from '../integrations/ModuleToolsetPanel'
import { useAuth } from '../../context/AuthContext'
import {
  listModuleConnections,
  setModulePrefs,
  type ModuleConnectionsResponse,
} from '../../lib/module-api'
import { listModuleAgents, type ModuleAgentRow } from '../../lib/integrations-api'
import { AgentOptionRow } from '../ui/AgentOptionRow'
import { Badge } from '../ui/badge'
import { Switch } from '../ui/switch'

type Props = {
  module: IntegrationModuleRow
  /** Kept for call-site compatibility; connections load from the module API. */
  applications?: unknown
}

/** Generic overview panels on the single module page (any module slug). */
export function ModuleOverview({ module }: Props) {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'

  const [connections, setConnections] = useState<ModuleConnectionsResponse | null>(null)
  const [roster, setRoster] = useState<ModuleAgentRow[]>([])
  const [writesBusy, setWritesBusy] = useState(false)
  const [customerToolsBusy, setCustomerToolsBusy] = useState<string | null>(null)

  const loadConnections = useCallback(async () => {
    try {
      setConnections(await listModuleConnections(module.slug))
    } catch {
      setConnections(null)
    }
  }, [module.slug])

  useEffect(() => {
    void loadConnections()
    void listModuleAgents(module.slug)
      .then(setRoster)
      .catch(() => setRoster([]))
  }, [module.slug, loadConnections])

  const customerCards = (module.tool_cards ?? []).filter((card) => card.exposure === 'customer')
  const customerTools = connections?.prefs?.customer_tools ?? {}

  const toggleCustomerTool = async (verb: string, enabled: boolean) => {
    setCustomerToolsBusy(verb)
    try {
      await setModulePrefs(module.slug, {
        customer_tools: { ...customerTools, [verb]: enabled },
      })
      await loadConnections()
    } catch {
      toast.error(
        t('integrations.modules.workspace.customerToolsError', {
          defaultValue: 'Could not update customer chat tools.',
        }),
      )
    } finally {
      setCustomerToolsBusy(null)
    }
  }

  const connectedCount = (connections?.connections ?? []).filter((c) => c.ready).length
  const tenantWrites = Boolean(connections?.prefs?.writes_enabled)
  const writesActive = Boolean(connections?.writes_active)

  const toggleWrites = async (enabled: boolean) => {
    setWritesBusy(true)
    try {
      await setModulePrefs(module.slug, { writes_enabled: enabled })
      await loadConnections()
    } catch {
      toast.error(
        t('integrations.modules.workspace.writesError', {
          defaultValue: 'Could not update the write switch.',
        }),
      )
    } finally {
      setWritesBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-bg-surface p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {t('integrations.modules.workspace.status', { defaultValue: 'Status' })}
          </p>
          <p className="mt-1 text-sm font-medium text-text-heading">
            {connectedCount > 0
              ? t('integrations.modules.workspace.readyLive', {
                  defaultValue: 'Ready with live data',
                })
              : t('integrations.modules.workspace.readyNoData', {
                  defaultValue: 'Installed — link an integration for live data',
                })}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-bg-surface p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {t('integrations.modules.usesIntegrations', { defaultValue: 'Uses integrations' })}
          </p>
          <p className="mt-1 text-sm font-medium text-text-heading">
            {t('integrations.modules.workspace.integrationCount', {
              defaultValue: '{{count}} linked',
              count: connectedCount,
            })}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-bg-surface p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {t('integrations.modules.toolset', { defaultValue: 'AI toolset' })}
          </p>
          <p className="mt-1 text-sm font-medium text-text-heading">
            {t('integrations.modules.workspace.verbCount', {
              defaultValue: '{{count}} read actions',
              count: module.verbs?.length ?? module.verb_labels?.length ?? 0,
            })}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-border/60 bg-bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-bg-muted/40 text-text-secondary">
              {writesActive ? <PenLine size={15} aria-hidden /> : <Lock size={15} aria-hidden />}
            </span>
            <div>
              <p className="text-sm font-medium text-text-heading">
                {writesActive
                  ? t('integrations.modules.workspace.writesOn', {
                      defaultValue: 'Writes enabled — approved decisions execute',
                    })
                  : t('integrations.modules.workspace.writesOff', {
                      defaultValue: 'Writes disabled — retrieval only',
                    })}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {writesActive
                  ? t('integrations.modules.workspace.writesOnHint', {
                      defaultValue:
                        'Agents propose writes as decisions; on approval they are applied to the package.',
                    })
                  : tenantWrites
                    ? t('integrations.modules.workspace.writesPlatformOff', {
                        defaultValue:
                          'Enabled for this workspace, but writes are switched off platform-wide. Approvals resolve safely without writing.',
                      })
                    : t('integrations.modules.workspace.writesOffHint', {
                        defaultValue:
                          'Agents can read and propose. Approvals resolve safely without writing to the package.',
                      })}
              </p>
            </div>
          </div>
          {isAdmin ? (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              {t('integrations.modules.workspace.writesToggle', {
                defaultValue: 'Allow writes in this workspace',
              })}
              <Switch checked={tenantWrites} disabled={writesBusy} onCheckedChange={(v) => void toggleWrites(v)} />
            </label>
          ) : null}
        </div>
      </section>

      {customerCards.length > 0 ? (
        <section className="rounded-xl border border-border/60 bg-bg-surface p-4">
          <h2 className="text-sm font-semibold text-text-heading">
            {t('integrations.modules.workspace.customerToolsTitle', {
              defaultValue: 'Customer chat tools',
            })}
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            {t('integrations.modules.workspace.customerToolsHint', {
              defaultValue:
                "Off by default. When on, the website widget can look up this visitor's own records after they confirm a short email link.",
            })}
          </p>
          <ul className="mt-3 space-y-2">
            {customerCards.map((card) => (
              <li
                key={card.verb}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-heading">{card.label}</p>
                  <p className="text-xs text-text-muted">{card.description}</p>
                </div>
                {isAdmin ? (
                  <Switch
                    checked={Boolean(customerTools[card.verb])}
                    disabled={customerToolsBusy === card.verb}
                    onCheckedChange={(v) => void toggleCustomerTool(card.verb, v)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {roster.length > 0 ? (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-heading">
              {t('integrations.modules.agents.sectionTitle', { defaultValue: 'Assigned agents' })}
            </h2>
            <Link
              to={`${moduleHomePath(module)}?tab=setup`}
              className="text-xs text-accent hover:underline"
            >
              {t('integrations.modules.workspace.manageAgents', {
                defaultValue: 'Manage roster',
              })}
            </Link>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {roster.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-3 py-2.5"
              >
                <Link
                  to={`/agents/${row.agent_id}`}
                  className="min-w-0 flex-1 hover:opacity-90"
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
                    size={22}
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
                <Badge variant="neutral" className="px-1.5 py-0 text-[10px]">
                  {row.company_ids && row.company_ids.length > 0
                    ? t('integrations.modules.agents.scopeBadge', {
                        defaultValue: '{{count}} administration(s)',
                        count: row.company_ids.length,
                      })
                    : t('integrations.modules.agents.scopeAll', {
                        defaultValue: 'All administrations',
                      })}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-heading">
          {t('integrations.modules.workspace.domainsTitle', {
            defaultValue: 'What agents can work with',
          })}
        </h2>
        <ModuleToolsetPanel module={module} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-heading">
          {t('integrations.modules.workspace.actionsTitle', { defaultValue: 'Quick actions' })}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/agents"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-text-secondary hover:border-accent/40 hover:text-text-heading"
          >
            {t('integrations.connected.openAgents', { defaultValue: 'Open Agents' })}
          </Link>
          <Link
            to={inboxPath('open')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-text-secondary hover:border-accent/40 hover:text-text-heading"
          >
            <MessageSquare size={13} aria-hidden />
            {t('integrations.connected.openCommunication', { defaultValue: 'Open Communication' })}
          </Link>
          <Link
            to={`${moduleHomePath(module)}?tab=sources`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-text-secondary hover:border-accent/40 hover:text-text-heading"
          >
            {t('integrations.modules.workspace.sources', { defaultValue: 'Knowledge sources' })}
          </Link>
          <Link
            to="/settings/govern?tab=policy"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs text-text-secondary hover:border-accent/40 hover:text-text-heading"
          >
            {t('integrations.connected.openGovern', { defaultValue: 'Open Govern' })}
          </Link>
        </div>
      </section>
    </div>
  )
}
