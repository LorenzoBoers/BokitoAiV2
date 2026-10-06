import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { dayKey } from '../../lib/agenda-layout'
import type { InboxThread } from '../../lib/inbox-api'
import { createConversationTask } from '../../lib/orchestration-tasks-api'
import { scheduledForIso, type FollowUpWhen } from './WhatsNextDialog'

type Args = {
  thread: InboxThread | null | undefined
  onPatch?: (input: Record<string, unknown>) => Promise<void>
  onRefresh?: () => void
}

/**
 * State for the task planner (WhatsNextDialog) of one conversation.
 * Creates a human AgentTask on the thread — look-ats are retired.
 */
export function useFollowUpPlanner({ thread, onRefresh }: Args) {
  const { t } = useTranslation('communication')
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const openPlanner = useCallback(() => {
    if (!thread) return
    setTitle(
      thread.emailSubject || t('threadChrome.followUp', { name: thread.contactName || 'thread' }),
    )
    setOpen(true)
  }, [thread, t])

  const save = useCallback(
    async (input: { title: string; when: FollowUpWhen }) => {
      if (!thread || saving) return
      setSaving(true)
      try {
        const at = scheduledForIso(input.when)
        await createConversationTask({
          title: input.title,
          signalId: String(thread.id),
          scheduledFor: at,
        })
        setOpen(false)
        toast.success(t('threadChrome.taskCreated', { title: input.title }), {
          description: t('threadChrome.taskCreatedHint'),
          action: {
            label: t('threadChrome.openAgenda'),
            onClick: () => navigate(`/agenda?view=list${at ? `&date=${dayKey(new Date(at))}` : ''}`),
          },
        })
        onRefresh?.()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('threadChrome.taskCreateError'))
      } finally {
        setSaving(false)
      }
    },
    [thread, saving, t, navigate, onRefresh],
  )

  return { open, setOpen, title, saving, openPlanner, save }
}
