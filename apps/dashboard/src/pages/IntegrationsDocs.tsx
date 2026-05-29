import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { REMOTE_MCP_PROVIDERS } from '../lib/mcp-remote-providers'
import PageContent from '../components/layout/PageContent'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

export default function IntegrationsDocs() {
  const { t } = useTranslation('nav')

  return (
    <PageContent width="lg">
      <div className="space-y-8 max-w-3xl">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('integrations.docs.overviewTitle')}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            {t('integrations.docs.overviewBody')}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('integrations.docs.remoteMcpTitle')}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            {t('integrations.docs.remoteMcpBody')}
          </p>
          <ol className="text-sm text-text-secondary space-y-2 list-decimal pl-5">
            <li>{t('integrations.docs.remoteMcpStep1')}</li>
            <li>{t('integrations.docs.remoteMcpStep2')}</li>
            <li>{t('integrations.docs.remoteMcpStep3')}</li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('integrations.docs.catalogTitle')}
          </h2>
          <p className="text-sm text-text-muted">{t('integrations.docs.catalogHint')}</p>
          <div className="space-y-2">
            {REMOTE_MCP_PROVIDERS.map((p) => (
              <Card
                key={p.slug}
                className="p-4 border-border/80 bg-bg-surface/95 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{p.name}</span>
                    <Badge variant="neutral" className="text-[10px]">
                      {t('integrations.kind.mcp')}
                    </Badge>
                    {p.wave === 1 ? (
                      <Badge variant="neutral" className="text-[10px]">
                        {t('integrations.docs.wave1')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-text-secondary">{p.description}</p>
                  <p className="text-[11px] font-mono text-text-muted break-all">{p.mcpRemoteUrl}</p>
                </div>
                <Link
                  to={`/integrations/marketplace?kind=mcp&connect=${p.staticId}`}
                  className="text-xs text-accent hover:underline shrink-0"
                >
                  {t('integrations.docs.openInMarketplace')}
                </Link>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('integrations.docs.existingTitle')}
          </h2>
          <ul className="text-sm text-text-secondary space-y-1.5 list-disc pl-5">
            <li>{t('integrations.docs.existingGithub')}</li>
            <li>{t('integrations.docs.existingInbox')}</li>
            <li>{t('integrations.docs.existingApiKeyMcp')}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-primary">
            {t('integrations.docs.adminTitle')}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            {t('integrations.docs.adminBody')}
          </p>
          <p className="text-xs text-text-muted font-mono break-all">
            GET /integrations/mcp/oauth/start
            <br />
            GET /integrations/mcp/oauth/callback
            <br />
            POST /integrations/worker/mcp-credentials
          </p>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-6">
          <h2 className="text-sm font-semibold text-text-primary">
            {t('integrations.docs.devTitle')}
          </h2>
          <p className="text-xs text-text-muted leading-relaxed">{t('integrations.docs.devBody')}</p>
          <ul className="text-xs text-text-muted space-y-1 font-mono">
            <li>apps/dashboard/docs/INTEGRATIONS.md</li>
            <li>xano-patches/v1/INTEGRATIONS-PLATFORM.md</li>
            <li>xano-patches/v1/integration-providers-seed.md</li>
            <li>apps/runtime/src/mcp-oauth/</li>
          </ul>
        </section>
      </div>
    </PageContent>
  )
}
