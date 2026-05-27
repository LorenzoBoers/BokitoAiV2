import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { WorkforceDecisionList } from '../components/workforce/WorkforceDecisionList'
import { listMessages } from '../lib/messages-api'
import { listProjects } from '../lib/projects-api'

/**
 * Aggregate view of pending agent communications across all projects.
 */
export default function ProjectHubCommunication() {
  const { t } = useTranslation('nav')
  const [messages, setMessages] = useState<Awaited<ReturnType<typeof listMessages>>>([])
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof listProjects>>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [msgRows, projectRows] = await Promise.all([
        listMessages({ status: 'awaiting_human' }),
        listProjects(),
      ])
      setMessages(msgRows)
      setProjects(projectRows)
    } catch (err) {
      setMessages([])
      setProjects([])
      setError(err instanceof Error ? err.message : 'Could not load messages.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const projectById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.name)
    return map
  }, [projects])

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-text-muted">
        {t('projectHub.communication.description')}
      </p>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            {t('projectHub.communication.pendingTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingBlock label={t('project.messages.loading')} />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={t('projectHub.communication.empty')}
            />
          ) : (
            <WorkforceDecisionList
              messages={messages}
              onRefresh={load}
              showProjectContext
              projectNameById={projectById}
            />
          )}
        </CardContent>
      </Card>
      <div className="flex items-center justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link to="/messages">{t('projectHub.communication.openInbox')}</Link>
        </Button>
      </div>
    </div>
  )
}
