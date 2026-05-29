import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { AiAvatar } from '../components/ui/AiAvatar'
import { LoadingBlock } from '../components/ui/loading-block'
import { EmptyState } from '../components/ui/empty-state'
import { PageContent } from '../components/layout/PageContent'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { agentType, filterPoAgents, filterUserAgents, sortAgentsByUpdated } from '../lib/workforce-nav-agents'
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
  const [poAgents, setPoAgents] = useState<RuntimeAgent[]>([])
  const [workerAgents, setWorkerAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listAgents()
      .then((rows) => {
        if (!cancelled) {
          setPoAgents(sortAgentsByUpdated(filterPoAgents(rows)))
          setWorkerAgents(sortAgentsByUpdated(filterUserAgents(rows)))
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPoAgents([])
          setWorkerAgents([])
          setError(e instanceof Error ? e.message : t('workforce.agents.loadError'))
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
      <p className="text-sm text-text-muted">{t('workforce.agents.listDescription')}</p>

      {loading ? (
        <LoadingBlock label={t('workforce.agents.loading')} />
      ) : error ? (
        <Card className="p-4">
          <p className="text-sm text-status-error">{error}</p>
        </Card>
      ) : poAgents.length === 0 && workerAgents.length === 0 ? (
        <EmptyState icon={Bot} title={t('workforce.agents.empty')} />
      ) : (
        <Card className="overflow-hidden divide-y divide-border/60">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.sections.po', { defaultValue: 'PO agents' })}
          </div>
          <ul>
            {poAgents.length === 0 ? (
              <li className="px-4 py-3 text-sm text-text-muted">{t('workforce.po.none')}</li>
            ) : (
              poAgents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/ai/agents/${agent.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AiAvatar name={agent.name} seed={agent.id} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{agent.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`workforce.agents.types.${agentType(agent)}`, { defaultValue: 'PO' })}
                          </Badge>
                          <p className="text-xs text-text-muted">
                            {agent.role_name || agent.role_slug || t('workforce.agents.roleUnknown')}
                          </p>
                        </div>
                        {agent.current_activity_summary ? (
                          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
                            {agent.current_activity_summary}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span className={cn('shrink-0 text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                      {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <div className="border-y border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.agents.sections.workers', { defaultValue: 'Worker agents' })}
          </div>
          <ul>
            {workerAgents.length === 0 ? (
              <li className="px-4 py-3 text-sm text-text-muted">{t('workforce.agents.empty')}</li>
            ) : (
              workerAgents.map((agent) => (
                <li key={agent.id}>
                  <Link
                    to={`/ai/agents/${agent.id}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/50"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <AiAvatar name={agent.name} seed={agent.id} size={28} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-heading">{agent.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {t(`workforce.agents.types.${agentType(agent)}`, { defaultValue: 'Worker' })}
                          </Badge>
                          <p className="text-xs text-text-muted">
                            {agent.role_name || agent.role_slug || t('workforce.agents.roleUnknown')}
                          </p>
                        </div>
                        {agent.current_activity_summary ? (
                          <p className="mt-1 line-clamp-2 text-sm text-text-secondary">
                            {agent.current_activity_summary}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span className={cn('shrink-0 text-xs font-medium capitalize', STATUS_CLASS[agent.status])}>
                      {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </Card>
      )}
    </PageContent>
  )
}
