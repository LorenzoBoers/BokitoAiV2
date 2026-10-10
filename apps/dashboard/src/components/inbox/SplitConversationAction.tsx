import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Split } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { inboxPath } from '../../lib/messages-paths'
import { listCategories, type CategoryRow } from '../../lib/tickets-api'
import { splitSignalThread } from '../../lib/signals-api'
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
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { BubbleAction } from './ChatBubble'

const NONE = '__none__'

/** "Split from here": the message and everything after it become a new conversation. */
export function SplitConversationAction({
  threadId,
  messageId,
}: {
  threadId: string
  messageId: string
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<CategoryRow[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCategoryId('')
    let cancelled = false
    void listCategories()
      .then((rows) => {
        if (!cancelled) setTypes(rows)
      })
      .catch(() => {
        if (!cancelled) setTypes([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const split = async () => {
    if (!token) return
    setBusy(true)
    try {
      const res = await splitSignalThread(token, threadId, { fromMessageId: messageId, categoryId })
      setOpen(false)
      toast.success(t('splitConversation.done'))
      navigate(inboxPath('all', res.signal_id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('splitConversation.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <BubbleAction label={t('splitConversation.action')} onClick={() => setOpen(true)}>
        <Split size={12} />
      </BubbleAction>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('splitConversation.title')}</DialogTitle>
            <DialogDescription>{t('splitConversation.hint')}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('splitConversation.category')}</span>
            <ChoiceSelect
              aria-label={t('splitConversation.category')}
              triggerClassName="h-9 text-sm"
              value={categoryId || NONE}
              onValueChange={(value) => setCategoryId(value === NONE ? '' : value)}
              groups={[
                {
                  items: [
                    { value: NONE, label: t('splitConversation.noCategory'), kind: 'icon' },
                    ...types.map((type) => ({
                      value: type.id,
                      label: type.name,
                      kind: 'tag' as const,
                      category: true,
                    })),
                  ],
                },
              ]}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('splitConversation.cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void split()}>
              {t('splitConversation.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
