import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Link2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import {
  parseKindFilter,
  kindFilterToParam,
  marketplacePathWithKind,
  readLastIntegrationKind,
  writeLastIntegrationKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import { Input } from '../components/ui/input'
import type { IntegrationKind } from '../lib/integration-kind'
import { useIntegrationBrand } from '../context/IntegrationBrandContext'
import { startGithubOAuth } from '../lib/github-api'
import {
  listModuleCompanies,
  revokeIntegrationConnection,
  type AccountingCompanyRow,
} from '../lib/integrations-api'
import { MODULE_BY_PROVIDER_SLUG } from '../lib/integration-applications'
import { revokeMcpConnection, type McpIntegrationRow } from '../lib/mcp-integrations'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { CardGridSkeleton } from '../components/ui/skeleton'
import { PageContent } from '../components/layout/PageContent'
import { PageGuideBanner } from '../components/layout/PageGuideBanner'
import IntegrationsTabs from '../components/shell/IntegrationsTabs'
import { inboxPath } from '../lib/messages-paths'

function KindSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
      <Card className="p-4">{children}</Card>
    </section>
  )
}

function SummaryCard({
  label,
  count,
  onClick,
}: {
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start rounded-xl border border-border/60 bg-bg-surface px-4 py-3 text-left transition-colors hover:border-border hover:bg-bg-hover/40 shadow-card"
    >
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-2xl font-semibold text-text-heading tabular-nums mt-1">{count}</span>
    </button>
  )
}

function McpRowList({
  rows,
  onDisconnect,
}: {
  rows: McpIntegrationRow[]
  onDisconnect: (connectionId: string) => Promise<void>
}) {
  const { t } = useTranslation('nav')
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <IntegrationHostLogo
              logoUrl={row.logoUrl}
              logoDarkUrl={row.logoDarkUrl}
              initials={row.initials}
              color={row.brandColor}
              name={row.providerName}
              hostSlug={row.hostSlug}
              size="sm"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{row.displayName}</p>
              <p className="text-[11px] text-text-muted truncate">{row.endpoint}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void onDisconnect(row.id)}>
            {t('integrations.actions.disconnect')}
          </Button>
        </li>
      ))}
    </ul>
  )
}

export default function IntegrationsConnected() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFromUrl = searchParams.get('kind')
  const kindFilter = kindFromUrl == null ? readLastIntegrationKind() : parseKindFilter(kindFromUrl)
  const [query, setQuery] = useState('')

  const {
    loading,
    loadError,
    github,
    emailOutlook,
    emailGmail,
    mcpRows,
    calendarRows,
    counts,
    refresh,
  } = useConnectedIntegrationsSummary()

  const githubBrand = useIntegrationBrand('github')
  const outlookBrand = useIntegrationBrand('outlook')
  const gmailBrand = useIntegrationBrand('gmail')

  const setKindFilter = useCallback(
    (next: IntegrationKindFilter) => {
      writeLastIntegrationKind(next)
      const param = kindFilterToParam(next)
      const params = new URLSearchParams(searchParams)
      if (param) params.set('kind', param)
      else params.delete('kind')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (kindFromUrl == null && kindFilter !== 'all') {
      const params = new URLSearchParams(searchParams)
      params.set('kind', kindFilter)
      setSearchParams(params, { replace: true })
    }
  }, [kindFromUrl, kindFilter, searchParams, setSearchParams])

  const kindCounts = useMemo(
    () => ({
      all: counts.all,
      inbox: counts.inbox,
      repository: counts.repository,
      calendar: counts.calendar,
      mcp: counts.mcp,
    }),
    [counts],
  )

  const showSection = (kind: IntegrationKind) =>
    kindFilter === 'all' || kindFilter === kind

  const hasAnyConnection = counts.all > 0
  const needle = query.trim().toLowerCase()
  const visibleGithub = useMemo(
    () => (needle ? github.filter((c) => c.github_login.toLowerCase().includes(needle)) : github),
    [github, needle],
  )
  const visibleMcp = useMemo(
    () =>
      needle
        ? mcpRows.filter((row) =>
            `${row.displayName} ${row.providerName} ${row.endpoint}`.toLowerCase().includes(needle),
          )
        : mcpRows,
    [mcpRows, needle],
  )
  const accountingMcp = useMemo(
    () => visibleMcp.filter((row) => MODULE_BY_PROVIDER_SLUG[row.providerSlug] === 'accounting'),
    [visibleMcp],
  )
  const otherMcp = useMemo(
    () => visibleMcp.filter((row) => MODULE_BY_PROVIDER_SLUG[row.providerSlug] !== 'accounting'),
    [visibleMcp],
  )

  const [accountingCompanies, setAccountingCompanies] = useState<AccountingCompanyRow[]>([])
  useEffect(() => {
    if (accountingMcp.length === 0) {
      setAccountingCompanies([])
      return
    }
    let cancelled = false
    void listModuleCompanies('accounting')
      .then((res) => {
        if (!cancelled) setAccountingCompanies(res.companies ?? [])
      })
      .catch(() => {
        if (!cancelled) setAccountingCompanies([])
      })
    return () => {
      cancelled = true
    }
  }, [accountingMcp.length])
  const inboxMatches =
    !needle ||
    'outlook microsoft 365 gmail google'.includes(needle) ||
    t('integrations.kind.inbox').toLowerCase().includes(needle)

  async function addGithubAccount() {
    const returnUrl = `${window.location.origin}/modules/connected`
    const { authorize_url } = await startGithubOAuth(returnUrl)
    window.location.href = authorize_url
  }

  const handleDisconnectGithub = async (connectionId: string) => {
    if (
      !window.confirm(
        t('integrations.actions.disconnectConfirm'),
      )
    ) {
      return
    }
    try {
      await revokeIntegrationConnection(connectionId)
      toast.success(t('integrations.actions.disconnected'))
      await refresh()
    } catch {
      toast.error(t('integrations.actions.disconnectFailed'))
    }
  }

  const handleDisconnectMcp = async (connectionId: string) => {
    if (
      !window.confirm(
        t('integrations.actions.disconnectConfirm'),
      )
    ) {
      return
    }
    try {
      await revokeMcpConnection(connectionId)
      toast.success(t('integrations.actions.disconnected'))
      await refresh()
    } catch {
      toast.error(t('integrations.actions.disconnectFailed'))
    }
  }

  return (
    <PageContent width="xl" className="space-y-6">
      <PageGuideBanner page="integrations" />
      <IntegrationsTabs />
      <p className="max-w-2xl text-sm text-text-secondary">
        {t('integrations.pageMeta.connected.description')}
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <IntegrationKindNav value={kindFilter} onChange={setKindFilter} counts={kindCounts} />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('integrations.connected.searchPlaceholder')}
            className="h-8 w-52 text-sm"
          />
        <Button size="sm" className="shrink-0 gap-1.5" asChild>
          <Link to={marketplacePathWithKind(kindFilter)}>
            <Plus size={14} />
            {t('integrations.connected.addIntegration')}
          </Link>
        </Button>
        </div>
      </div>

      {loadError ? (
        <p className="text-xs text-text-muted">{loadError}</p>
      ) : null}

      {kindFilter === 'all' && !loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label={t('integrations.kind.inbox')}
            count={counts.inbox}
            onClick={() => setKindFilter('inbox')}
          />
          <SummaryCard
            label={t('integrations.kind.repository')}
            count={counts.repository}
            onClick={() => setKindFilter('repository')}
          />
          <SummaryCard
            label={t('integrations.kind.calendar')}
            count={counts.calendar}
            onClick={() => setKindFilter('calendar')}
          />
          <SummaryCard
            label={t('integrations.kind.mcp')}
            count={counts.mcp}
            onClick={() => setKindFilter('mcp')}
          />
        </div>
      ) : null}

      {loading ? (
        <CardGridSkeleton />
      ) : !hasAnyConnection && kindFilter === 'all' ? (
        <EmptyState
          icon={Link2}
          title={t('integrations.connected.emptyAllTitle')}
          description={t('integrations.connected.emptyAllDescription')}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button size="sm" asChild>
                <Link to="/modules/marketplace">
                  {t('integrations.connected.goToMarketplace')}
                </Link>
              </Button>
              <Link to="/settings/setup" className="text-xs font-medium text-accent hover:underline">
                {t('integrations.connected.setupGuideHint')}
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          {needle && visibleGithub.length === 0 && visibleMcp.length === 0 && !inboxMatches ? (
            <p className="text-sm text-text-muted">{t('integrations.connected.noSearchMatches')}</p>
          ) : null}

          {showSection('inbox') && inboxMatches ? (
            <KindSection title={t('integrations.kind.inbox')}>
              {emailOutlook === 0 && emailGmail === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">{t('integrations.connected.emptyInbox')}</p>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to={marketplacePathWithKind('inbox')}>
                      {t('integrations.connected.browseInbox')}
                    </Link>
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <IntegrationHostLogo
                          logoUrl={outlookBrand.logoUrl}
                          logoDarkUrl={outlookBrand.logoDarkUrl}
                          initials={outlookBrand.initials}
                          color={outlookBrand.color}
                          name="Microsoft 365"
                          size="sm"
                        />
                        <span>Microsoft 365 / Outlook</span>
                      </div>
                      <Badge variant={emailOutlook > 0 ? 'success' : 'neutral'}>
                        {emailOutlook > 0
                          ? t('integrations.connections.mailboxCount', { count: emailOutlook })
                          : t('integrations.connections.notConnected')}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <IntegrationHostLogo
                          logoUrl={gmailBrand.logoUrl}
                          logoDarkUrl={gmailBrand.logoDarkUrl}
                          initials={gmailBrand.initials}
                          color={gmailBrand.color}
                          name="Google Workspace"
                          size="sm"
                        />
                        <span>Google Workspace / Gmail</span>
                      </div>
                      <Badge variant={emailGmail > 0 ? 'success' : 'neutral'}>
                        {emailGmail > 0
                          ? t('integrations.connections.mailboxCount', { count: emailGmail })
                          : t('integrations.connections.notConnected')}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" asChild>
                      <Link to="/settings/channels">{t('integrations.connections.manageInbox')}</Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link to={inboxPath('open')}>{t('integrations.connected.openInbox')}</Link>
                    </Button>
                  </div>
                </>
              )}
            </KindSection>
          ) : null}

          {showSection('repository') ? (
            <KindSection title={t('integrations.kind.repository')}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <IntegrationHostLogo
                    logoUrl={githubBrand.logoUrl}
                    logoDarkUrl={githubBrand.logoDarkUrl}
                    initials={githubBrand.initials}
                    color={githubBrand.color}
                    name="GitHub"
                    size="sm"
                  />
                  <span className="text-sm font-medium text-text-heading">GitHub</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/agents">{t('integrations.connected.openAgents')}</Link>
                  </Button>
                  <Button size="sm" onClick={() => void addGithubAccount()}>
                    {github.length === 0
                      ? t('integrations.actions.setupConnection')
                      : t('integrations.actions.addAccount')}
                  </Button>
                </div>
              </div>
              {github.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">{t('integrations.connections.noGithub')}</p>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to={marketplacePathWithKind('repository')}>
                      {t('integrations.connected.browseRepository')}
                    </Link>
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {visibleGithub.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
                    >
                      <span className="text-sm">{c.github_login}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleDisconnectGithub(c.id)}
                      >
                        {t('integrations.actions.disconnect')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </KindSection>
          ) : null}

          {showSection('calendar') ? (
            <KindSection title={t('integrations.kind.calendar')}>
              {calendarRows.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">
                    {t('integrations.connected.emptyCalendar', {
                      defaultValue: 'No calendar connected yet. Sync Google or Outlook into Agenda.',
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" asChild>
                      <Link to={marketplacePathWithKind('calendar')}>
                        {t('integrations.connected.browseCalendar', {
                          defaultValue: 'Browse calendars',
                        })}
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/agenda">{t('agendaPage.openAgenda')}</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="space-y-2">
                    {calendarRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{row.display_name}</p>
                          <p className="text-[11px] text-text-muted truncate">
                            {row.provider}
                            {typeof row.event_count === 'number'
                              ? ` · ${t('agendaPage.calendar.eventCount', { count: row.event_count })}`
                              : ''}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/agenda">{t('integrations.actions.manage')}</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    <Button size="sm" variant="secondary" asChild>
                      <Link to="/agenda">{t('agendaPage.openAgenda')}</Link>
                    </Button>
                  </div>
                </>
              )}
            </KindSection>
          ) : null}

          {showSection('mcp') ? (
            <KindSection title={t('integrations.kind.mcp')}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-xs text-text-secondary">{t('integrations.connected.mcpHint')}</p>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/modules/tools">{t('integrations.connected.manageMcp')}</Link>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => navigate('/modules/tools?connect=custom_mcp')}
                  >
                    {t('integrations.mcp.servers.newConnection')}
                  </Button>
                </div>
              </div>
              {mcpRows.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">{t('integrations.mcp.servers.empty')}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" asChild>
                      <Link to={marketplacePathWithKind('mcp')}>
                        {t('integrations.connected.browseMcp')}
                      </Link>
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link to="/settings/govern?tab=policy">
                        {t('integrations.connected.openGovern')}
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {accountingMcp.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Link
                          to="/modules/accounting"
                          className="text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-accent"
                        >
                          {t('integrations.modules.accounting.name')}
                        </Link>
                        <Badge variant="neutral">
                          {t('integrations.modules.moduleBadge', { defaultValue: 'Module' })}
                        </Badge>
                      </div>
                      <McpRowList rows={accountingMcp} onDisconnect={handleDisconnectMcp} />
                      {accountingCompanies.length > 1 ? (
                        <div className="rounded-lg border border-border/40 px-3 py-2">
                          <p className="text-[11px] font-medium text-text-muted">
                            {t('integrations.modules.companies', {
                              defaultValue: 'Administrations ({{count}})',
                              count: accountingCompanies.length,
                            })}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {accountingCompanies.map((c) => (
                              <span
                                key={`${c.connection_id ?? ''}-${c.id}`}
                                className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-text-secondary"
                                title={c.vendor ?? undefined}
                              >
                                {c.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : accountingCompanies.length === 1 ? (
                        <p className="px-1 text-[11px] text-text-muted">
                          {t('integrations.modules.singleCompany', {
                            defaultValue: 'Administration: {{name}}',
                            name: accountingCompanies[0].name,
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {otherMcp.length > 0 ? (
                    <div className="space-y-2">
                      {accountingMcp.length > 0 ? (
                        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                          {t('integrations.modules.sectionOther')}
                        </p>
                      ) : null}
                      <McpRowList rows={otherMcp} onDisconnect={handleDisconnectMcp} />
                    </div>
                  ) : null}
                </div>
              )}
            </KindSection>
          ) : null}
        </div>
      )}
    </PageContent>
  )
}
