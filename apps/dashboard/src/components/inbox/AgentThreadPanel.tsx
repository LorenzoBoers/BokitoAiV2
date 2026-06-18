import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listAgents } from '../../lib/agents-api'
import type { InboxThread } from '../../lib/inbox-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import ContactPanel from './ContactPanel'
import AgentContextPanel from './AgentContextPanel'

type Props = {
  thread: InboxThread
  onClose: () => void
}

export default function AgentThreadPanel({ thread, onClose }: Props) {
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [targetAgent, setTargetAgent] = useState<RuntimeAgent | null>(null)
  // External/customer threads show the contact; assistant and internal threads
  // show the agent you are talking to.
  const isChatThread = thread.channel === 'assistant'
  const isExternal = thread.folder !== 'internal' && !isChatThread

  // Resolve the agent this thread targets (chat threads carry agent_id).
  useEffect(() => {
    let cancelled = false
    if (isExternal || !thread.agentId) {
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
  }, [thread.agentId, isExternal])

  const projectId = thread.projectId ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (isExternal || !projectId) {
          if (!cancelled) setProject(null)
          return
        }
        const projects = await listProjects()
        if (cancelled) return
        setProject(projects.find((p) => p.id === projectId) ?? null)
      } catch {
        if (!cancelled) setProject(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, isExternal])

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

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-border/50 bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {isExternal ? 'Contact' : 'Agent'}
        </span>
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
        {isExternal ? (
          <ContactPanel
            contactId={thread.contactId}
            fallbackName={thread.contactName}
            fallbackEmail={thread.contactEmail}
            currentThreadId={thread.id}
          />
        ) : (
          <AgentContextPanel thread={thread} agent={contextAgent} />
        )}
      </div>
    </aside>
  )
}
