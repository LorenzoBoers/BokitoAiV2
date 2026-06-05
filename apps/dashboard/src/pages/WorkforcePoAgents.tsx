import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { filterPoAgents, resolvePoNavTarget, sortAgentsByUpdated } from '../lib/workforce-nav-agents'
import { cn } from '../lib/utils'

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

export default function WorkforcePoAgents() {
  const { t } = useTranslation(['nav', 'common'])
  const isAdmin = useIsAdmin()
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAgents(await listAgents())
    } catch (e) {
      setAgents([])
      setError(e instanceof Error ? e.message : t('workforce.agents.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const poAgents = useMemo(() => sortAgentsByUpdated(filterPoAgents(agents)), [agents])
  const singleTarget = useMemo(() => resolvePoNavTarget(agents), [agents])

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  if (!loading && singleTarget && !singleTarget.endsWith('/po')) {
    return <Navigate to={singleTarget} replace />
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <p className="text-sm text-text-muted">
        {t('workforce.pageMeta.po.description', {
          defaultValue: 'Product-owner orchestrators across projects.',
        })}
      </p>

      {loading ? (
        <LoadingBlock label={t('workforce.agents.loading')} />
      ) : error ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">{error}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
            {t('common:actions.retry')}
          </Button>
        </Card>
      ) : poAgents.length === 0 ? (
        <EmptyState icon={Bot} title={t('workforce.po.none')} />
      ) : (
        <Card className="overflow-hidden divide-y divide-border/60">
          <ul>
            {poAgents.map((agent) => (
              <li key={agent.id}>
                <Link
                  to={`/os/agents/${agent.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-text-heading">{agent.name}</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {agent.role_name || agent.role_slug || t('workforce.agents.roleUnknown')}
                    </p>
                  </div>
                  <span className={cn('text-xs capitalize', STATUS_CLASS[agent.status])}>
                    {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageContent>
  )
}
