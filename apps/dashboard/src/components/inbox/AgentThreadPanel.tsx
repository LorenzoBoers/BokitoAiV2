import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose } from 'lucide-react'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listAgents } from '../../lib/agents-api'
import type { InboxThread, PatchThreadInput, RelatedConversation } from '../../lib/inbox-api'
import { threadFace } from '../../lib/message-composer'
import type { RuntimeAgent } from '../../lib/workforce-api'
import ContactPanel from './ContactPanel'
import AgentContextPanel from './AgentContextPanel'
import { ConversationWorkSection } from './ConversationWorkSection'
import ScrollFade from '../ui/ScrollFade'
import { Button } from '../ui/button'

type Props = {
  thread: InboxThread
  onClose: () => void
  onThreadUpdated?: () => void
  /** External threads: edits under "This conversation" (priority, look again). */
  saving?: boolean
  onPatch?: (input: PatchThreadInput) => Promise<boolean | void>
  onPlan?: () => void
  /** Other conversations with this person (from the thread payload). */
  relatedConversations?: RelatedConversation[]
}

export default function AgentThreadPanel({
  thread,
  onClose,
  onThreadUpdated,
  saving,
  onPatch,
  onPlan,
  relatedConversations,
}: Props) {
  const { t } = useTranslation(['nav', 'communication'])
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [targetAgent, setTargetAgent] = useState<RuntimeAgent | null>(null)
  // External/customer threads show the contact; assistant and internal threads
  // show the agent you are talking to.
  const isChatThread = thread.channel === 'assistant'
  const isExternal = thread.folder !== 'internal' && !isChatThread
  const face = threadFace(thread)

  // The panel shows who sent the last message, not the pinned agent.
  useEffect(() => {
    let cancelled = false
    if (isExternal || !face.id) {
      setTargetAgent(null)
      return
    }
    void (async () => {
      try {
        const agents = await listAgents()
        if (!cancelled) setTargetAgent(agents.find((a) => a.id === face.id) ?? null)
      } catch {
        if (!cancelled) setTargetAgent(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [face.id, isExternal])

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
        slug: '',
        role: 'orchestrator',
        status: 'standby',
        current_activity_summary: null,
        role_id: null,
        role_name: t('workforce.agents.types.orchestrator', { ns: 'nav' }),
        role_slug: null,
        parent_agent_id: null,
        current_session_id: null,
        current_activity_id: null,
        current_thread_id: null,
        updated_at: 0,
      }
    }
    if (face.name) {
      return {
        id: face.id ?? 'unknown',
        organisation_id: thread.organisationId,
        name: face.name,
        slug: '',
        role: face.kind === 'orchestrator' ? 'orchestrator' : 'assistant',
        role_id: null,
        role_name:
          face.kind === 'orchestrator'
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
  }, [targetAgent, orchestrator, face.id, face.name, face.kind, thread.organisationId, t])

  const closeAction = (
    <Button variant="ghost" size="iconSm"
      type="button"
      onClick={onClose}
      className="-mr-1 shrink-0 text-text-muted"
      aria-label={t('threadChrome.hideDetails', { ns: 'communication' })}
      title={t('threadChrome.hideDetails', { ns: 'communication' })}
    >
      <PanelRightClose size={14} />
    </Button>
  )

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border bg-bg">
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
                onPlan={onPlan}
                onScheduleChanged={() => onThreadUpdated?.()}
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
