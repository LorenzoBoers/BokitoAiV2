import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bot, X } from 'lucide-react'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listAgents } from '../../lib/agents-api'
import type { InboxThread } from '../../lib/inbox-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import ContactPanel from './ContactPanel'
import AgentContextPanel from './AgentContextPanel'

type Props = {
  thread: InboxThread
  onClose: () => void
  onThreadUpdated?: () => void
}

export default function AgentThreadPanel({ thread, onClose, onThreadUpdated }: Props) {
  const { t } = useTranslation(['nav', 'communication'])
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
        role_name: orchestrator.role ?? t('workforce.agents.types.orchestrator', { ns: 'nav' }),
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
        role_name:
          thread.agentKind === 'orchestrator'
            ? t('workforce.agents.types.orchestrator', { ns: 'nav' })
            : t('workforce.agents.types.worker', { ns: 'nav' }),
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
  }, [targetAgent, orchestrator, thread.agentId, thread.agentName, thread.agentKind, thread.organisationId, t])

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border/60 bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {isExternal ? t('sidePanel.contact', { ns: 'communication' }) : t('sidePanel.agent', { ns: 'communication' })}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-0.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          aria-label={t('directChat.closeContextPanel', { ns: 'communication' })}
          title={t('directChat.close', { ns: 'communication' })}
        >
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isExternal ? (
          <>
            {thread.agentId || thread.agentName ? (
              <Link
                to={thread.agentId ? `/agents/${thread.agentId}` : '/agents'}
                className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-ai/20 bg-ai/5 px-2.5 py-1.5 text-left transition-colors hover:border-ai/40"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ai/25 bg-ai/10 text-ai-ink">
                  <Bot size={12} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {t('sidePanel.handling', { ns: 'communication' })}
                  </span>
                  <span className="block truncate text-[12px] font-medium text-text-heading">
                    {thread.agentName || t('sidePanel.agent', { ns: 'communication' })}
                  </span>
                </span>
              </Link>
            ) : null}
            <ContactPanel
              contactId={thread.contactId}
              fallbackName={thread.contactName}
              fallbackEmail={thread.contactEmail}
              currentThreadId={thread.id}
              threadSubject={thread.emailSubject}
              threadPreview={thread.lastMessagePreview}
            />
          </>
        ) : (
          <AgentContextPanel thread={thread} agent={contextAgent} onThreadUpdated={onThreadUpdated} />
        )}
      </div>
    </aside>
  )
}
