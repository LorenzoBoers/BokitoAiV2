import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { appRoutes } from '../api/routes'
import { apiPost } from './api'
import { bokitoCreateConversation } from './bokito-api'
import { agentChatPath, newConversationPath } from './messages-paths'

export type CorrectionSubject = {
  /** Host customer thread; the correction chat is grounded in its transcript. */
  threadId: string
  /** Responsible company agent. */
  agentId?: string | null
  agentName?: string | null
  subjectType: 'message' | 'decision'
  subjectId: string
  /** Short quote of what the agent did (message body or decision summary). */
  summary?: string
}

function correctionPrompt(subject: CorrectionSubject): string {
  const what = subject.subjectType === 'decision' ? 'decision you proposed' : 'reply you wrote'
  const quote = (subject.summary || '').trim().slice(0, 500)
  return [
    `This is not right — specifically the ${what}.`,
    quote ? `This is what you did:\n"""${quote}"""` : '',
    'I will explain what you should have done. Ask focused clarifying questions if anything is unclear.',
    'When you understand the correction, make it stick: use write_doc to record what you learned in workspace memory, and if this looks like a recurring pattern for this sender or type of message, use suggest_inbox_rule to propose an automation rule I can confirm.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Correction loop entry point: records feedback on the agent output, opens a
 * chat with the responsible agent grounded in the source thread
 * (`context_signal_id`), and auto-sends a correction prompt so the agent
 * starts asking what it should have done differently.
 */
export function useCorrectionChat() {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)

  const startCorrection = useCallback(
    async (subject: CorrectionSubject) => {
      if (!token || starting) return
      if (!subject.agentId) {
        toast.error(t('actions.correctionStartError'))
        navigate(newConversationPath())
        return
      }
      setStarting(true)
      try {
        // Learning signal first; the chat is best-effort on top of it.
        await apiPost(appRoutes.learning.feedback, {
          subject_type: subject.subjectType,
          subject_id: subject.subjectId,
          sentiment: 'down',
          comment: 'Correction chat started by operator',
        }).catch(() => undefined)

        const created = await bokitoCreateConversation(
          token,
          'Correction',
          subject.agentId,
          { contextSignalId: subject.threadId },
        )
        const path = agentChatPath(created.agent_id ?? subject.agentId, created.id)
        navigate(path, { state: { autoSend: correctionPrompt(subject) } })
      } catch {
        toast.error(t('actions.correctionStartError'))
      } finally {
        setStarting(false)
      }
    },
    [token, starting, navigate, t],
  )

  return { startCorrection, starting }
}
