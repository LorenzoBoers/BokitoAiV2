import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BookOpen,
  Building2,
  FileText,
  Landmark,
  Lock,
  MessageSquare,
  PenLine,
  Scale,
  Wallet,
} from 'lucide-react'
import { inboxPath } from '../../lib/messages-paths'
import { moduleHomePath, type IntegrationModuleRow } from '../../lib/integration-modules'
import type { IntegrationApplication } from '../../lib/integration-applications'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { moduleSetupPath } from '../../lib/integration-setup-url'
import { useAuth } from '../../context/AuthContext'
import {
  listModuleConnections,
  setModulePrefs,
  type ModuleConnectionsResponse,
} from '../../lib/module-api'
import { listModuleAgents, type ModuleAgentRow } from '../../lib/integrations-api'
import { Badge } from '../ui/badge'
import { Switch } from '../ui/switch'

type Props = {
  module: IntegrationModuleRow
  applications: IntegrationApplication[]
}

const DOMAIN_CARDS: Array<{
  icon: typeof Building2
  verbKey: string
  labelDefault: string
  hintDefault: string
}> = [
  {
    icon: Building2,
    verbKey: 'administrations',
    labelDefault: 'Administrations',
    hintDefault: 'Companies and ledgers agents can address.',
  },
  {
    icon: BookOpen,
    verbKey: 'contacts',
    labelDefault: 'Relations',
    hintDefault: 'Customers and suppliers via the accounting contract.',
  },
  {
    icon: FileText,
    verbKey: 'invoices_and_bills',
    labelDefault: 'Invoices and bills',
    hintDefault: 'Sales and purchase documents; writes stay decisions.',
  },
  {
    icon: Scale,
    verbKey: 'ledger',
    labelDefault: 'Ledger',
    hintDefault: 'Chart of accounts and journal lines.',
  },
  {
    icon: Wallet,
    verbKey: 'outstanding_balances',
    labelDefault: 'Outstanding',
    hintDefault: 'Open receivables and payables.',
  },
  {
    icon: Landmark,
    verbKey: 'bank_mutations',
    labelDefault: 'Bank mutations',
    hintDefault: 'Bank lines when the package exposes them.',
  },
]

/** Accounting-specific overview panels inside the universal module shell. */
export function AccountingModuleOverview({ module, applications }: Props) {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  const apps = applications.filter(
    (app) => app.module === module.slug && app.status !== 'coming_soon',
  )
  const connectedApps = apps.filter(
    (app) => app.status === 'connected' || (app.connectionCount ?? 0) > 0,
  )

  const [connections, setConnections] = useState<ModuleConnectionsResponse | null>(null)
  const [roster, setRoster] = useState<ModuleAgentRow[]>([])
  const [writesBusy, setWritesBusy] = useState(false)

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
            {connectedApps.length > 0
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
              count: connectedApps.length,
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
              count: module.verb_labels?.length ?? 0,
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

      {connections && connections.connections.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-text-heading">
            {t('integrations.modules.workspace.administrationsTitle', {
              defaultValue: 'Administrations',
            })}
          </h2>
          <ul className="space-y-2">
            {connections.connections.map((conn) => (
              <li key={conn.id} className="rounded-xl border border-border/60 bg-bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-text-heading">{conn.display_name}</p>
                  <Badge variant="neutral" className="px-1.5 py-0 text-[10px] uppercase">
                    {conn.vendor}
                  </Badge>
                  {conn.is_default ? (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {t('integrations.modules.workspace.defaultConnection', {
                        defaultValue: 'Default',
                      })}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={conn.ready ? 'secondary' : 'neutral'}
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {conn.ready
                      ? t('integrations.modules.workspace.connectionReady', {
                          defaultValue: 'Connected',
                        })
                      : t('integrations.modules.workspace.connectionNotReady', {
                          defaultValue: 'Credentials missing',
                        })}
                  </Badge>
                </div>
                {conn.companies.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {conn.companies.map((company) => {
                      const cid = String(company.id ?? '')
                      const isDefaultCompany =
                        Boolean(cid) && cid === String(conn.default_company_id ?? '')
                      return (
                        <li
                          key={cid || String(company.name)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-text-secondary"
                        >
                          <Building2 size={11} aria-hidden />
                          {String(company.name || cid)}
                          {isDefaultCompany ? (
                            <span className="text-[10px] text-accent">
                              {t('integrations.modules.workspace.defaultCompany', {
                                defaultValue: 'default',
                              })}
                            </span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-text-muted">
                    {t('integrations.modules.workspace.noCompanies', {
                      defaultValue: 'No administrations visible yet for this connection.',
                    })}
                  </p>
                )}
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
                  className="min-w-0 flex-1 truncate text-sm font-medium text-text-heading hover:text-accent hover:underline"
                >
                  {row.name}
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAIN_CARDS.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.verbKey}
                className="rounded-xl border border-border/60 bg-bg-surface p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-bg-muted/40 text-text-secondary">
                    <Icon size={15} aria-hidden />
                  </span>
                  <p className="text-sm font-medium text-text-heading">
                    {t(`integrations.modules.verbs.${card.verbKey}`, {
                      defaultValue: card.labelDefault,
                    })}
                  </p>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  {t(`integrations.modules.workspace.domainHints.${card.verbKey}`, {
                    defaultValue: card.hintDefault,
                  })}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text-heading">
            {t('integrations.modules.usesIntegrations', { defaultValue: 'Uses integrations' })}
          </h2>
          <Link
            to={`${moduleHomePath(module)}?tab=connections`}
            className="text-xs text-accent hover:underline"
          >
            {t('integrations.modules.workspace.manageIntegrations', {
              defaultValue: 'Manage connections',
            })}
          </Link>
        </div>
        {apps.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t('integrations.modules.workspace.noIntegrations', {
              defaultValue: 'No integrations listed for this module yet.',
            })}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {apps.map((app) => {
              const connected = app.status === 'connected' || (app.connectionCount ?? 0) > 0
              return (
                <li key={app.hostSlug}>
                  <Link
                    to={moduleSetupPath(module.slug, app.offers[0]?.integration.id || app.hostSlug, 'setup')}
                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-surface px-3 py-3 hover:border-accent/40"
                  >
                    <IntegrationHostLogo
                      logoUrl={app.brand.logoUrl}
                      logoDarkUrl={app.brand.logoDarkUrl}
                      initials={app.brand.initials}
                      color={app.brand.color}
                      name=""
                      hostSlug={app.brand.hostSlug}
                      size="sm"
                      className="rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-heading">{app.name}</p>
                      <p className="text-xs text-text-muted">
                        {connected
                          ? t('integrations.modules.integrationOn', { defaultValue: 'On' })
                          : t('integrations.modules.integrationOff', { defaultValue: 'Optional' })}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
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
