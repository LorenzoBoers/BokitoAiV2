import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { Card } from '../components/ui/card'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { cn } from '../lib/utils'

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

export default function AiAgents() {
  const { t } = useTranslation('nav')
  const isAdmin = useIsAdmin()
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows)
      })
      .catch((e) => {
        if (!cancelled) {
          setAgents([])
          setError(e instanceof Error ? e.message : t('ai.agents.loadError'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  if (!isAdmin) {
    return <Navigate to="/messages" replace />
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      <p className="text-sm text-text-muted">{t('ai.agents.listDescription')}</p>

      {loading ? (
        <LoadingBlock label={t('ai.agents.loading')} />
      ) : error ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">{error}</p>
        </Card>
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} title={t('ai.agents.empty')} />
      ) : (
        <Card className="overflow-hidden divide-y divide-border/60">
          <ul>
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link
                  to={`/ai/agents/${agent.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-text-heading">{agent.name}</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {agent.role_name || agent.role_slug || t('ai.agents.roleUnknown')}
                    </p>
                    {agent.current_activity_summary ? (
                      <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
                        {agent.current_activity_summary}
                      </p>
                    ) : null}
                  </div>
                  <span className={cn('shrink-0 text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                    {t(`ai.agents.status.${agent.status}`, { defaultValue: agent.status })}
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
