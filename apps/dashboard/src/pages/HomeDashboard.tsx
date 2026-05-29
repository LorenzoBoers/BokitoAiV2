import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  ArrowUpRight,
  FolderKanban,
  Inbox,
  Link2,
  MessageSquare,
  Plus,
  Sparkles,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty-state'
import { LoadingBlock } from '../components/ui/loading-block'
import { PageContent } from '../components/layout/PageContent'
import { ASSISTENT_DEFAULT_PATH } from '../lib/assistent-settings-path'
import { listProjects, type ProjectRow } from '../lib/projects-api'
import { listWorkLogs, type WorkLogRow } from '../lib/work-logs-api'
import { listMessages, type MessageRow } from '../lib/messages-api'
import { listAgents } from '../lib/agents-api'
import type { RuntimeAgent } from '../lib/workforce-api'
import { projectWorkforceRunUrl } from '../lib/workforce-run-urls'
import { repoStatusLabel, repoStatusVariant } from '../lib/repo-status'
import { Badge } from '../components/ui/badge'

function formatWhen(value?: string | number | null): string {
  if (value == null || value === '' || value === 0) return '-'
  const d = new Date(typeof value === 'number' ? value : value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

type HomeActivityRow = {
  id: string
  kind: 'run' | 'message'
  title: string
  summary?: string | null
  createdAt: number
  createdAtRaw?: string | number | null
  href: string
  projectName: string
  actor: string
  agent: string
  workstream: string
  action: string
}

function readString(payload: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!payload) return null
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function toTimestamp(value?: string | number | null): number {
  if (typeof value === 'number') {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export default function HomeDashboard() {
  const { t } = useTranslation('nav')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [runs, setRuns] = useState<WorkLogRow[]>([])
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false))
  }, [])

  useEffect(() => {
    Promise.all([listWorkLogs({ limit: 20 }), listMessages({}), listAgents()])
      .then(([runRows, messageRows, agentRows]) => {
        setRuns(runRows)
        setMessages(messageRows)
        setAgents(agentRows)
      })
      .catch(() => {
        setRuns([])
        setMessages([])
        setAgents([])
      })
      .finally(() => setLoadingActivity(false))
  }, [])

  const recentProjects = projects.slice(0, 5)
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents])

  const recentActivity = useMemo<HomeActivityRow[]>(() => {
    const fromRuns: HomeActivityRow[] = runs.map((run) => {
      const ts = toTimestamp(run.started_at ?? run.finished_at ?? null)
      const agentName = run.agent_id ? (agentById.get(run.agent_id) ?? run.agent_id) : '-'
      return {
        id: `run:${run.id}`,
        kind: 'run',
        title: run.task_subject?.trim() || t('workforce.runs.fallbackSubject'),
        summary: null,
        createdAt: ts,
        createdAtRaw: run.started_at ?? run.finished_at ?? null,
        href: projectWorkforceRunUrl(run.project_id, run.id),
        projectName: projectById.get(run.project_id) ?? run.project_id,
        actor: t('home.activity.actorSystem', { defaultValue: 'System' }),
        agent: agentName || '-',
        workstream: t('home.activity.unknown', { defaultValue: '-' }),
        action: `${t('home.activity.actionRun', { defaultValue: 'Run' })}: ${run.status}`,
      }
    })

    const fromMessages: HomeActivityRow[] = messages.map((msg) => {
      const payload = msg.payload
      const agentId = readString(payload, ['agent_id'])
      const agentNameFromPayload = readString(payload, ['agent_name'])
      const stream =
        readString(payload, ['stream_name', 'stream_slug', 'workstream_name', 'workstream_slug', 'stream', 'stream_id']) ??
        t('home.activity.unknown', { defaultValue: '-' })
      const actor =
        readString(payload, ['user_name', 'actor_name', 'created_by_name', 'author_name']) ??
        readString(payload, ['user_id', 'actor_id', 'created_by_user_id']) ??
        t('home.activity.actorAgent', { defaultValue: 'Agent' })
      const agent = agentNameFromPayload ?? (agentId ? (agentById.get(agentId) ?? agentId) : t('home.activity.unknown', { defaultValue: '-' }))
      const action = `${msg.message_type} (${msg.status})`
      const ts = toTimestamp(msg.created_at)
      const summary = msg.body?.trim() ? msg.body.trim() : null
      const title = msg.subject?.trim() || t('home.activity.fallbackMessage', { defaultValue: 'Message update' })
      const projectId = msg.project_id?.trim() || null
      const href = projectId ? `/project/${projectId}/communication` : '/messages'
      return {
        id: `message:${msg.id}`,
        kind: 'message',
        title,
        summary,
        createdAt: ts,
        createdAtRaw: msg.created_at,
        href,
        projectName: projectId ? (projectById.get(projectId) ?? projectId) : t('home.activity.crossProject', { defaultValue: 'Cross-project' }),
        actor,
        agent,
        workstream: stream,
        action,
      }
    })

    return [...fromRuns, ...fromMessages]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
  }, [runs, messages, agentById, projectById, t])

  return (
    <PageContent width="xl" className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-text-heading">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('home.description')}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/projects/new">
            <Plus size={16} />
            {t('home.quick.newProject')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/support/inbox/all">
            <Inbox size={16} />
            {t('home.quick.openInbox')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to="/integrations/marketplace">
            <Link2 size={16} />
            {t('home.quick.integrations')}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-auto justify-start gap-2 py-3">
          <Link to={ASSISTENT_DEFAULT_PATH}>
            <Sparkles size={16} />
            {t('home.quick.assistent')}
          </Link>
        </Button>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">{t('home.recentProjects.title')}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">{t('home.recentProjects.viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <LoadingBlock label={t('project.list.loading')} />
            ) : recentProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title={t('home.recentProjects.empty')}
                action={
                  <Button asChild size="sm">
                    <Link to="/projects/new">{t('project.list.create')}</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {recentProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/project/${p.id}/overview`}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 transition-colors hover:bg-bg-hover/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-heading">{p.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant={repoStatusVariant(p)} className="text-[10px]">
                            {repoStatusLabel(p)}
                          </Badge>
                        </div>
                      </div>
                      <ArrowUpRight
                        size={14}
                        className="shrink-0 text-text-muted group-hover:text-text-primary"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('home.inbox.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-text-muted">{t('home.inbox.description')}</p>
            <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
              <Link to="/support/inbox/unassigned">
                <MessageSquare size={14} />
                {t('support.links.unassigned')}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
              <Link to="/support/inbox/my">
                <Inbox size={14} />
                {t('support.links.myInbox')}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="w-full justify-start gap-2">
              <Link to="/support/inbox/all">
                <MessageSquare size={14} />
                {t('support.links.allMessages')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold">{t('home.activity.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingActivity ? (
              <LoadingBlock label={t('workforce.runs.loading')} />
            ) : recentActivity.length === 0 ? (
              <EmptyState icon={Activity} title={t('home.activity.empty')} />
            ) : (
              <ul className="divide-y divide-border/60">
                {recentActivity.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.href}
                      className="block py-2 text-sm hover:text-accent"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium text-text-heading">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-xs text-text-muted">{formatWhen(item.createdAtRaw)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">{item.projectName}</Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {t('home.activity.labels.actor')}: {item.actor}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {t('home.activity.labels.agent')}: {item.agent}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {t('home.activity.labels.workstream')}: {item.workstream}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {t('home.activity.labels.action')}: {item.action}
                        </Badge>
                      </div>
                      {item.summary ? (
                        <p className="mt-1 line-clamp-2 text-xs text-text-muted">{item.summary}</p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContent>
  )
}
