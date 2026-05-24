import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { ConnectedIntegrationsPreview } from '../components/integrations/ConnectedIntegrationsPreview'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { listTenantDocs, type TenantDocRow } from '../lib/docs-api'

export default function DataSources() {
  const { t } = useTranslation('nav')
  const [docs, setDocs] = useState<TenantDocRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void listTenantDocs().then((rows) => {
      if (!cancelled) {
        setDocs(rows.filter((d) => d.status !== 'archived'))
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageContent width="xl" className="flex flex-col gap-4 py-1">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('integrations.links.sources')}</CardTitle>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t('integrations.sources.description')}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingBlock variant="inline" label={t('integrations.sources.loading')} />
          ) : docs.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t('integrations.sources.emptyTitle')}
              description={t('integrations.sources.emptyDescription')}
              size="sm"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {docs.map((doc) => (
                <article
                  key={doc.id}
                  className="rounded-lg border border-border/60 bg-bg-elevated/40 p-4"
                >
                  <p className="text-sm font-medium text-text-heading">{doc.name}</p>
                  {doc.source_url ? (
                    <p className="mt-1 truncate text-xs text-text-muted">{doc.source_url}</p>
                  ) : null}
                  <Badge variant="success" className="mt-2">
                    {t('integrations.sources.activeForAgents')}
                  </Badge>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectedIntegrationsPreview />
    </PageContent>
  )
}
