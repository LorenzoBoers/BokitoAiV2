import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, ExternalLink, Loader2 } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { listAgents } from '../lib/agents-api'
import { listMcpIntegrationRows } from '../lib/mcp-integrations'
import { listProjects } from '../lib/projects-api'
import { listTriggers } from '../lib/orchestration-api'
import { listThreads } from '../lib/inbox-api'
import { useAuth } from '../context/AuthContext'

type Step = {
  id: string
  title: string
  description: string
  href: string
  done: boolean
}

export default function IntegrationSetupPage() {
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [steps, setSteps] = useState<Step[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [agents, mcpRows, projects, triggers, threads] = await Promise.all([
        listAgents().catch(() => []),
        listMcpIntegrationRows().catch(() => []),
        listProjects().catch(() => []),
        listTriggers().catch(() => []),
        token
          ? listThreads(token, { perPage: 50 }).catch(() => ({ items: [] as Awaited<ReturnType<typeof listThreads>>['items'] }))
          : Promise.resolve({ items: [] as Awaited<ReturnType<typeof listThreads>>['items'] }),
      ])
      const webhookTriggers = triggers.filter((t) => t.kind === 'webhook')
      const projectWithPo = projects.some((p) => Boolean(p.po_agent_id))
      const linkedThread = threads.items.some((t) => Boolean(t.projectId))

      setSteps([
        {
          id: 'agent',
          title: 'Create a worker agent',
          description: 'Add an agent that will handle external events and tool calls.',
          href: '/agents',
          done: agents.length > 0,
        },
        {
          id: 'mcp',
          title: 'Connect an MCP server',
          description: 'Register a custom MCP server reachable from the Bokito API container, then test the connection.',
          href: '/settings/mcp?connect=custom_mcp',
          done: mcpRows.length > 0,
        },
        {
          id: 'webhook',
          title: 'Create a webhook trigger',
          description: 'Add a webhook schedule on Agenda, copy the hook URL and secret into your external system.',
          href: '/agenda',
          done: webhookTriggers.length > 0,
        },
        {
          id: 'project',
          title: 'Create a project and link an orchestrator',
          description: 'Group operational threads under a project with a linked orchestrator agent.',
          href: '/settings/projects',
          done: projects.length > 0 && projectWithPo,
        },
        {
          id: 'thread',
          title: 'Link a thread to the project',
          description: 'Open an internal thread and assign it to the project from the agent context panel.',
          href: '/communication/runs/all',
          done: linkedThread,
        },
        {
          id: 'test',
          title: 'Send a test webhook',
          description: 'Use Test ping on the webhook trigger to verify end-to-end delivery.',
          href: '/agenda',
          done: webhookTriggers.some((t) => Boolean(t.last_run_at)),
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const completed = steps.filter((s) => s.done).length

  return (
    <PageContent>
      <ContentHeader
        title="Integration setup"
        subtitle="Connect an external system to Bokito using agents, MCP, webhooks, and projects."
      />

      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-text-muted py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking workspace status...
              </div>
            ) : (
              <>
                <p className="text-sm text-text-secondary">
                  {completed} of {steps.length} steps complete
                </p>
                <ol className="space-y-3">
                  {steps.map((step, index) => (
                    <li
                      key={step.id}
                      className="flex gap-3 rounded-lg border border-border/70 p-3"
                    >
                      <span className="mt-0.5 shrink-0 text-text-muted">
                        {step.done ? (
                          <CheckCircle2 size={18} className="text-status-success" />
                        ) : (
                          <Circle size={18} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-heading">
                          {index + 1}. {step.title}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">{step.description}</p>
                        <Button asChild variant="ghost" size="sm" className="h-auto px-0 mt-1 text-accent hover:text-accent">
                          <Link to={step.href}>
                            Open
                            <ExternalLink size={12} className="ml-1" />
                          </Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-text-muted">
          External systems copy credentials from the webhook panel and MCP settings into their own environment.
          See <Link to="/settings/mcp" className="text-accent hover:underline">MCP settings</Link> and{' '}
          <Link to="/agenda" className="text-accent hover:underline">Agenda automations</Link> for live values.
        </p>
      </div>
    </PageContent>
  )
}
