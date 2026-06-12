import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Bot, FolderKanban, Loader2, X } from 'lucide-react'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listAgentTasks } from '../../lib/orchestration-api'
import { listAgents } from '../../lib/agents-api'
import { USE_SIGNAL_INBOX } from '../../lib/signals-api'
import { isInternalThread, threadCounterpartyName } from '../../lib/message-composer'
import type { InboxThread } from '../../lib/inbox-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import { AiAvatar } from '../ui/AiAvatar'
import { OrchestrationPanel } from './OrchestrationPanel'
import ContactPanel from './ContactPanel'

type Props = {
  thread: InboxThread
  onClose: () => void
}

type PanelTab = 'contact' | 'orchestration'

const STATUS_CLASS: Record<string, string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  inactive: 'text-text-muted',
  error: 'text-status-error',
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
  )
}

function AgentContextCard({ agent, channelLabel }: { agent: RuntimeAgent; channelLabel: string }) {
  return (
    <Link
      to={`/agents/${agent.id}`}
      className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2.5 transition-colors hover:border-accent/50"
    >
      <AiAvatar name={agent.name} seed={agent.id} size={32} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-heading">{agent.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
          <Bot size={11} />
          {agent.role_name || agent.role_slug || 'Agent'}
        </span>
        <span
          className={`mt-1 inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold capitalize ${
            STATUS_CLASS[agent.status] ?? 'text-text-muted'
          }`}
        >
          {agent.status}
        </span>
        {agent.current_activity_summary ? (
          <span className="mt-2 flex items-start gap-1.5 text-[11px] text-text-secondary">
            <Activity size={11} className="mt-0.5 shrink-0 text-text-muted" />
            <span className="line-clamp-3">{agent.current_activity_summary}</span>
          </span>
        ) : null}
        <span className="mt-2 block text-[10.5px] text-text-muted">Kanaal: {channelLabel}</span>
      </span>
    </Link>
  )
}

export default function AgentThreadPanel({ thread, onClose }: Props) {
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [targetAgent, setTargetAgent] = useState<RuntimeAgent | null>(null)
  // External/customer threads open on contact; assistant and internal threads
  // show the agent you are talking to.
  const isChatThread = thread.channel === 'assistant'
  const isExternal = thread.folder !== 'internal' && !isChatThread
  const [tab, setTab] = useState<PanelTab>(isExternal ? 'contact' : 'orchestration')

  useEffect(() => {
    setTab(thread.folder !== 'internal' ? 'contact' : 'orchestration')
  }, [thread.id, thread.folder])

  // Resolve the agent this thread targets (chat threads carry agent_id).
  useEffect(() => {
    let cancelled = false
    if (!thread.agentId) {
      setTargetAgent(null)
      return
    }
    void (async () => {
      try {
        const agents = await listAgents()
        if (!cancelled) setTargetAgent(agents.find((a) => a.id === thread.agentId) ?? null)
      } catch {
        if (!cancelled) setTargetAgent(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [thread.agentId])

  const projectId = thread.projectId ?? null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        if (!projectId) {
          if (!cancelled) setProject(null)
          return
        }
        const projects = await listProjects()
        if (cancelled) return
        setProject(projects.find((p) => p.id === projectId) ?? null)
      } catch {
        if (!cancelled) setProject(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!USE_SIGNAL_INBOX) {
      setTaskId(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const tasks = await listAgentTasks({ signalId: String(thread.id) })
        if (!cancelled) setTaskId(tasks[0]?.id ?? null)
      } catch {
        if (!cancelled) setTaskId(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [thread.id])

  const orchestrator = project?.po_agent ?? null

  const contextAgent = useMemo<RuntimeAgent | null>(() => {
    if (targetAgent) return targetAgent
    if (orchestrator) {
      return {
        id: orchestrator.id,
        organisation_id: thread.organisationId,
        name: orchestrator.name,
        slug: orchestrator.slug ?? '',
        role_id: null,
        role_name: orchestrator.role ?? 'Orchestrator',
        role_slug: orchestrator.agent_type ?? null,
        parent_agent_id: null,
        status: (orchestrator.status as RuntimeAgent['status']) ?? 'active',
        current_session_id: null,
        current_activity_id: null,
        current_activity_summary: null,
        updated_at: 0,
      }
    }
    if (thread.agentName) {
      return {
        id: thread.agentId ?? 'unknown',
        organisation_id: thread.organisationId,
        name: thread.agentName,
        slug: '',
        role_id: null,
        role_name: thread.agentKind === 'orchestrator' ? 'Orchestrator' : 'Agent',
        role_slug: null,
        parent_agent_id: null,
        status: 'active',
        current_session_id: null,
        current_activity_id: null,
        current_activity_summary: null,
        updated_at: 0,
      }
    }
    return null
  }, [targetAgent, orchestrator, thread.agentId, thread.agentName, thread.agentKind, thread.organisationId])

  const channelLabel =
    thread.channel === 'internal'
      ? 'Intern'
      : thread.channel === 'assistant'
        ? 'Assistant'
        : thread.channel || 'Onbekend'

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-border/50 bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-2.5 py-1.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Thread context">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'contact'}
            onClick={() => setTab('contact')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              tab === 'contact' ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {isExternal ? 'Contact' : 'Agent'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'orchestration'}
            onClick={() => setTab('orchestration')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              tab === 'orchestration' ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Orchestration
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-0.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          aria-label="Close context panel"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'contact' ? (
          isExternal ? (
            <ContactPanel
              contactId={thread.contactId}
              fallbackName={thread.contactName}
              fallbackEmail={thread.contactEmail}
              currentThreadId={thread.id}
            />
          ) : (
            <div className="border-b border-border/40 px-4 pb-3 pt-4">
              <SectionHeading title="You are talking to" />
              {contextAgent && contextAgent.id !== 'unknown' ? (
                <AgentContextCard agent={contextAgent} channelLabel={channelLabel} />
              ) : contextAgent ? (
                <div className="rounded-lg border border-border/60 bg-bg-elevated px-3 py-2.5">
                  <p className="text-sm font-semibold text-text-heading">{contextAgent.name}</p>
                  <p className="mt-1 text-xs text-text-muted">{contextAgent.role_name}</p>
                  <p className="mt-2 text-[10.5px] text-text-muted">Kanaal: {channelLabel}</p>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-xs text-text-muted">
                  {isInternalThread(thread)
                    ? `Interne thread met ${threadCounterpartyName(thread)}.`
                    : 'This thread is handled by the workspace assistant.'}
                </p>
              )}
              {thread.emailSubject ? (
                <div className="mt-3 rounded-lg border border-border/45 bg-bg-elevated/40 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Onderwerp</p>
                  <p className="mt-1 text-[12px] text-text-primary">{thread.emailSubject}</p>
                </div>
              ) : null}
              {thread.projectId && project ? (
                <div className="mt-3">
                  <SectionHeading title="Project" />
                  <Link
                    to={`/communication/inbox/all?project_id=${project.id}`}
                    className="flex items-center gap-2 text-sm text-text-primary hover:text-accent"
                  >
                    <FolderKanban size={14} className="text-text-muted" />
                    <span className="truncate">{project.name}</span>
                  </Link>
                </div>
              ) : null}
            </div>
          )
        ) : loading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading orchestrator...
          </div>
        ) : (
          <>
            <div className="border-b border-border/40 px-4 pb-3 pt-4">
              <SectionHeading title="Orchestrator agent" />
              {orchestrator ? (
                <Link
                  to={`/agents/${orchestrator.id}`}
                  className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2.5 transition-colors hover:border-accent/50"
                >
                  <AiAvatar name={orchestrator.name} seed={orchestrator.id} size={28} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-heading">
                      {orchestrator.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                      <Bot size={11} />
                      Orchestrator
                    </span>
                    {orchestrator.status ? (
                      <span
                        className={`mt-0.5 block text-xs capitalize ${
                          STATUS_CLASS[orchestrator.status] ?? 'text-text-muted'
                        }`}
                      >
                        {orchestrator.status}
                      </span>
                    ) : null}
                  </span>
                </Link>
              ) : (
                <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-xs text-text-muted">
                  No orchestrator linked to this thread's project.
                </p>
              )}
            </div>

            {project ? (
              <div className="border-b border-border/40 px-4 py-3">
                <SectionHeading title="Project" />
                <Link
                  to={`/communication/customers/all?project_id=${project.id}`}
                  className="flex items-center gap-2 text-sm text-text-primary hover:text-accent"
                >
                  <FolderKanban size={14} className="text-text-muted" />
                  <span className="truncate">{project.name}</span>
                </Link>
              </div>
            ) : null}

            {taskId ? (
              <div className="px-4 py-3">
                <SectionHeading title="Active task" />
                <OrchestrationPanel taskId={taskId} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
