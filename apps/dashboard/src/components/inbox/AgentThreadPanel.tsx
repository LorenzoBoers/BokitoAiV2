import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose } from 'lucide-react'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listAgents } from '../../lib/agents-api'
import type { InboxThread, PatchThreadInput, RelatedConversation } from '../../lib/inbox-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import ContactPanel from './ContactPanel'
import AgentContextPanel from './AgentContextPanel'
import { ConversationWorkSection } from './ConversationWorkSection'
import ScrollFade from '../ui/ScrollFade'

type Props = {
  thread: InboxThread
  onClose: () => void
  onThreadUpdated?: () => void
  /** External threads: edits under "This conversation" (priority, look again). */
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<void>
  onWhatsNext?: () => void
  /** Other conversations with this person (from the thread payload). */
  relatedConversations?: RelatedConversation[]
}

export default function AgentThreadPanel({
  thread,
  onClose,
  onThreadUpdated,
  saving,
  onPatch,
  onWhatsNext,
  relatedConversations,
}: Props) {
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
        ...orchestrator,
        organisation_id: thread.organisationId,
        role_id: null,
        role_name: t('workforce.agents.types.orchestrator', { ns: 'nav' }),
        role_slug: orchestrator.role,
        parent_agent_id: null,
        current_session_id: null,
        current_activity_id: null,
        updated_at: 0,
      }
    }
    if (thread.agentName) {
      return {
        id: thread.agentId ?? 'unknown',
        organisation_id: thread.organisationId,
        name: thread.agentName,
        slug: '',
        role: thread.agentKind === 'orchestrator' ? 'orchestrator' : 'assistant',
        role_id: null,
        role_name:
          thread.agentKind === 'orchestrator'
            ? t('workforce.agents.types.orchestrator', { ns: 'nav' })
            : t('workforce.agents.types.worker', { ns: 'nav' }),
        role_slug: null,
        parent_agent_id: null,
        status: 'standby',
        current_session_id: null,
        current_activity_id: null,
        current_activity_summary: null,
        current_thread_id: null,
        updated_at: 0,
      }
    }
    return null
  }, [targetAgent, orchestrator, thread.agentId, thread.agentName, thread.agentKind, thread.organisationId, t])

  const closeAction = (
    <button
      type="button"
      onClick={onClose}
      className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
      aria-label={t('threadChrome.hideDetails', { ns: 'communication' })}
      title={t('threadChrome.hideDetails', { ns: 'communication' })}
    >
      <PanelRightClose size={14} />
    </button>
  )

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border/60 bg-bg">
      <ScrollFade>
        {isExternal ? (
          <>
            <ContactPanel
              contactId={thread.contactId}
              fallbackName={thread.contactName}
              fallbackEmail={thread.contactEmail}
              currentThreadId={thread.id}
              threadPreview={thread.lastMessagePreview}
              threadStatus={thread.status}
              onPatch={onPatch}
              contactBasis={thread.contactBasis}
              closeAction={closeAction}
              threadActivityAt={thread.lastMessageAt}
              relatedConversations={relatedConversations}
            >
              <ConversationWorkSection
                thread={thread}
                saving={saving}
                onPatch={onPatch}
                onWhatsNext={onWhatsNext}
              />
            </ContactPanel>
          </>
        ) : (
          <AgentContextPanel
            thread={thread}
            agent={contextAgent}
            onThreadUpdated={onThreadUpdated}
            closeAction={closeAction}
          />
        )}
      </ScrollFade>
    </aside>
  )
}
