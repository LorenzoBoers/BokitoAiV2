import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { appRoutes } from '../api/routes'
import { apiPost } from './api'
import { bokitoCreateConversation } from './bokito-api'
import { agentChatPath, assistantPath } from './messages-paths'

export type CorrectionSubject = {
  /** Host customer thread; the correction chat is grounded in its transcript. */
  threadId: string
  /** Responsible agent; falls back to the personal assistant when unknown. */
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
    `I want to correct your interpretation of the linked conversation - specifically the ${what}.`,
    quote ? `This is what you did:\n"""${quote}"""` : '',
    'I will explain what you should have done. Ask focused clarifying questions if anything is unclear.',
    'When you understand the correction, make it stick: update the workspace knowledge or memory with what you learned, and if this looks like a recurring pattern, propose a rule or ask me to confirm one.',
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
  const { token } = useAuth()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)

  const startCorrection = useCallback(
    async (subject: CorrectionSubject) => {
      if (!token || starting) return
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
          'Correct interpretation',
          subject.agentId ?? undefined,
          { contextSignalId: subject.threadId },
        )
        const path =
          created.agent_kind === 'company' && created.agent_id
            ? agentChatPath(created.agent_id, created.id)
            : assistantPath(created.id)
        navigate(path, { state: { autoSend: correctionPrompt(subject) } })
      } catch {
        toast.error('Could not start the correction chat.')
      } finally {
        setStarting(false)
      }
    },
    [token, starting, navigate],
  )

  return { startCorrection, starting }
}
