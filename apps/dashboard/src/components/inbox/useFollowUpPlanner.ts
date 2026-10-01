import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { InboxThread, PatchThreadInput } from '../../lib/inbox-api'
import { scheduledForIso, type FollowUpWhen } from './WhatsNextDialog'

type Args = {
  thread: InboxThread | null | undefined
  onPatch: (input: PatchThreadInput) => Promise<void>
  onRefresh?: () => void
}

/**
 * State for the "look again" planner (WhatsNextDialog) of one conversation.
 * Lives in the page so the right panel and the header can both open it.
 */
export function useFollowUpPlanner({ thread, onPatch, onRefresh }: Args) {
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
        await onPatch({ followUpAt: scheduledForIso(input.when), followUpTitle: input.title })
        setOpen(false)
        toast.success(t('threadChrome.taskCreated', { title: input.title }), {
          description: t('threadChrome.taskCreatedHint'),
          action: {
            label: t('threadChrome.openAgenda'),
            onClick: () => navigate('/agenda?view=timeline&source=wakes'),
          },
        })
        onRefresh?.()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('threadChrome.taskCreateError'))
      } finally {
        setSaving(false)
      }
    },
    [thread, saving, onPatch, t, navigate, onRefresh],
  )

  return { open, setOpen, title, saving, openPlanner, save }
}
