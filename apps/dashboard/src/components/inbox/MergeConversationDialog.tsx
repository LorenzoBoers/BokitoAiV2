import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { inboxPath } from '../../lib/messages-paths'
import { mergeSignalThread } from '../../lib/signals-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ConversationPicker } from './ConversationPicker'

/** "Merge into": every message moves to the picked conversation; this one closes and points there. */
export function MergeConversationDialog({
  threadId,
  open,
  onOpenChange,
}: {
  threadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setPicked(null)
  }, [open])

  const merge = async () => {
    if (!token || !picked) return
    setBusy(true)
    try {
      const res = await mergeSignalThread(token, threadId, picked.id)
      onOpenChange(false)
      toast.success(t('mergeConversation.done', { title: res.title || picked.title }))
      navigate(inboxPath('all', res.signal_id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('mergeConversation.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mergeConversation.title')}</DialogTitle>
          <DialogDescription>{t('mergeConversation.hint')}</DialogDescription>
        </DialogHeader>
        <ConversationPicker excludeId={threadId} selectedId={picked?.id} onPick={setPicked} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('moveConversation.cancel')}
          </Button>
          <Button type="button" disabled={busy || !picked} onClick={() => void merge()}>
            {t('mergeConversation.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
