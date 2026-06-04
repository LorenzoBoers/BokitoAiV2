import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bot, FolderKanban, MessageSquare, PlayCircle } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { projectOrchestratorPath } from '../components/layout/portal-nav'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { listMessages, type MessageRow } from '../lib/messages-api'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'

export default function WorkforceOverview() {
  const { t } = useTranslation(['nav', 'common'])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [runningLogs, setRunningLogs] = useState<WorkLogRow[]>([])
  const [pendingMessages, setPendingMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectRows, runningRows, pendingRows] = await Promise.all([
        listProjects(),
        listWorkLogs({ status: 'running', limit: 25 }),
        listMessages({ status: 'awaiting_human' }),
      ])
      setProjects(projectRows)
      setRunningLogs(runningRows)
      setPendingMessages(pendingRows)
    } catch (err) {
      setProjects([])
      setRunningLogs([])
      setPendingMessages([])
      setError(formatApiErrorMessage(err, t('workforce.overview.loadError', { defaultValue: 'Could not load workforce overview.' })))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const projectsWithPo = useMemo(
    () => projects.filter((project) => Boolean(project.po_agent_id)).length,
    [projects],
  )
  const projectsMissingPo = Math.max(0, projects.length - projectsWithPo)

  if (loading) {
    return (
      <PageContent width="xl" className="py-1">
        <LoadingBlock label={t('workforce.overview.loading', { defaultValue: 'Loading workforce overview…' })} />
      </PageContent>
    )
  }

  return (
    <PageContent width="xl" className="space-y-4 py-1">
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/70 p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.overview.cards.projects', { defaultValue: 'Projects' })}
          </p>
          <p className="mt-2 text-2xl font-semibold text-text-heading">{projects.length}</p>
          <p className="mt-1 text-xs text-text-muted">
            {t('workforce.overview.cards.projectsHint', { defaultValue: 'Total active projects in this workspace.' })}
          </p>
        </Card>

        <Card className="border-border/70 p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.overview.cards.poCoverage', { defaultValue: 'Orchestrator coverage' })}
          </p>
          <p className="mt-2 text-2xl font-semibold text-text-heading">
            {projectsWithPo}/{projects.length}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {projectsMissingPo > 0
              ? t('workforce.overview.cards.poMissingHint', {
                  count: projectsMissingPo,
                  defaultValue: '{{count}} projects still need an orchestrator.',
                })
              : t('workforce.overview.cards.poCompleteHint', { defaultValue: 'All projects have an orchestrator.' })}
          </p>
        </Card>

        <Card className="border-border/70 p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.overview.cards.running', { defaultValue: 'Running now' })}
          </p>
          <p className="mt-2 text-2xl font-semibold text-text-heading">{runningLogs.length}</p>
          <p className="mt-1 text-xs text-text-muted">
            {t('workforce.overview.cards.runningHint', { defaultValue: 'Active agent runs across all projects.' })}
          </p>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="border-border/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-heading">
              {t('workforce.overview.projectsTitle', { defaultValue: 'Projects needing orchestrator setup' })}
            </h3>
            <Badge variant="secondary">{projectsMissingPo}</Badge>
          </div>
          <div className="mt-3 space-y-2">
            {projectsMissingPo === 0 ? (
              <p className="text-sm text-text-muted">
                {t('workforce.overview.projectsEmpty', { defaultValue: 'No projects are missing an orchestrator.' })}
              </p>
            ) : (
              projects
                .filter((project) => !project.po_agent_id)
                .slice(0, 5)
                .map((project) => (
                  <Link
                    key={project.id}
                    to={projectOrchestratorPath(project.id)}
                    className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-bg-hover/55"
                  >
                    <span className="truncate text-sm text-text-primary">{project.name}</span>
                    <span className="text-xs text-status-warning">
                      {t('workforce.projects.poMissing', { defaultValue: 'Orchestrator required' })}
                    </span>
                  </Link>
                ))
            )}
          </div>
        </Card>

        <Card className="border-border/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-heading">
              {t('workforce.overview.attentionTitle', { defaultValue: 'Needs attention' })}
            </h3>
            <Badge variant="warning">{pendingMessages.length}</Badge>
          </div>
          <p className="mt-2 text-sm text-text-muted">
            {t('workforce.overview.attentionHint', {
              defaultValue: 'Messages awaiting human decision across all projects.',
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to="/projects/communication">
                <MessageSquare size={14} className="mr-1.5" />
                {t('workforce.overview.openCommunication', { defaultValue: 'Open communication' })}
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/workforce/agents">
                <Bot size={14} className="mr-1.5" />
                {t('workforce.links.agents', { defaultValue: 'Agent library' })}
              </Link>
            </Button>
          </div>
        </Card>
      </section>

      <section className="flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link to="/projects">
            <FolderKanban size={14} className="mr-1.5" />
            {t('workforce.overview.openProjectHub', { defaultValue: 'Open project hub' })}
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link to="/workforce/agents">
            <PlayCircle size={14} className="mr-1.5" />
            {t('workforce.overview.manageAgents', { defaultValue: 'Manage agents' })}
          </Link>
        </Button>
      </section>
    </PageContent>
  )
}
