import { useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Link2, Plus } from 'lucide-react'
import { IntegrationKindNav } from '../components/integrations/IntegrationKindNav'
import { IntegrationHostLogo } from '../components/integrations/IntegrationHostLogo'
import { useConnectedIntegrationsSummary } from '../hooks/useConnectedIntegrationsSummary'
import {
  parseKindFilter,
  kindFilterToParam,
  marketplacePathWithKind,
  type IntegrationKindFilter,
} from '../lib/integration-kind-url'
import type { IntegrationKind } from '../lib/integration-kind'
import { useIntegrationBrand } from '../context/IntegrationBrandContext'
import { startGithubOAuth } from '../lib/github-api'
import { revokeIntegrationConnection } from '../lib/integrations-api'
import { revokeMcpConnection } from '../lib/mcp-integrations'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'

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
      className="flex flex-col items-start rounded-xl border border-border/60 bg-bg-surface px-4 py-3 text-left transition-colors hover:border-border hover:bg-bg-hover/40"
    >
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-2xl font-semibold text-text-heading tabular-nums mt-1">{count}</span>
    </button>
  )
}

export default function IntegrationsConnected() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const kindFilter = parseKindFilter(searchParams.get('kind'))

  const {
    loading,
    loadError,
    github,
    emailOutlook,
    emailGmail,
    mcpRows,
    counts,
    refresh,
  } = useConnectedIntegrationsSummary()

  const githubBrand = useIntegrationBrand('github')
  const outlookBrand = useIntegrationBrand('outlook')
  const gmailBrand = useIntegrationBrand('gmail')

  const setKindFilter = useCallback(
    (next: IntegrationKindFilter) => {
      const param = kindFilterToParam(next)
      const params = new URLSearchParams(searchParams)
      if (param) params.set('kind', param)
      else params.delete('kind')
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const kindCounts = useMemo(
    () => ({
      all: counts.all,
      inbox: counts.inbox,
      repository: counts.repository,
      mcp: counts.mcp,
    }),
    [counts],
  )

  const showSection = (kind: IntegrationKind) =>
    kindFilter === 'all' || kindFilter === kind

  const hasAnyConnection = counts.all > 0

  async function addGithubAccount() {
    const returnUrl = `${window.location.origin}/integrations/connected`
    const { authorize_url } = await startGithubOAuth(returnUrl)
    window.location.href = authorize_url
  }

  return (
    <PageContent width="xl" className="space-y-6">
      <p className="max-w-2xl text-sm text-text-secondary">
        {t('integrations.pageMeta.connected.description')}
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <IntegrationKindNav value={kindFilter} onChange={setKindFilter} counts={kindCounts} />
        <Button size="sm" className="shrink-0 gap-1.5" asChild>
          <Link to={marketplacePathWithKind(kindFilter)}>
            <Plus size={14} />
            {t('integrations.connected.addIntegration')}
          </Link>
        </Button>
      </div>

      {loadError ? (
        <p className="text-xs text-text-muted">{t(loadError, { defaultValue: loadError })}</p>
      ) : null}

      {kindFilter === 'all' && !loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
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
            label={t('integrations.kind.mcp')}
            count={counts.mcp}
            onClick={() => setKindFilter('mcp')}
          />
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label={t('integrations.connected.loading')} />
      ) : !hasAnyConnection ? (
        <EmptyState
          icon={Link2}
          title={t('integrations.connected.emptyAllTitle')}
          description={t('integrations.connected.emptyAllDescription')}
          action={
            <Button size="sm" asChild>
              <Link to="/integrations/marketplace">
                {t('integrations.connected.goToMarketplace')}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {showSection('inbox') ? (
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
                  <Button size="sm" variant="secondary" className="mt-4" asChild>
                    <Link to="/settings/inbox">{t('integrations.connections.manageInbox')}</Link>
                  </Button>
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
                    <Link to="/projects">{t('integrations.connected.openProjects')}</Link>
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
                  {github.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
                    >
                      <span className="text-sm">{c.github_login}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void revokeIntegrationConnection(c.id).then(refresh)}
                      >
                        {t('integrations.actions.disconnect')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </KindSection>
          ) : null}

          {showSection('mcp') ? (
            <KindSection title={t('integrations.kind.mcp')}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-xs text-text-secondary">{t('integrations.connected.mcpHint')}</p>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/integrations/mcp">{t('integrations.connected.manageMcp')}</Link>
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => navigate('/integrations/mcp?connect=custom_mcp')}
                  >
                    {t('integrations.mcp.servers.newConnection')}
                  </Button>
                </div>
              </div>
              {mcpRows.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">{t('integrations.mcp.servers.empty')}</p>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to={marketplacePathWithKind('mcp')}>
                      {t('integrations.connected.browseMcp')}
                    </Link>
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {mcpRows.map((row) => (
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void revokeMcpConnection(row.id).then(refresh)}
                      >
                        {t('integrations.actions.disconnect')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </KindSection>
          ) : null}
        </div>
      )}
    </PageContent>
  )
}
