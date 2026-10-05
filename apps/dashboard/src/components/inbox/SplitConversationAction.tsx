import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Split } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { listCaseTypes, type CaseTypeRow } from '../../lib/cases-api'
import { inboxPath } from '../../lib/messages-paths'
import { signalTypeLabel } from '../../lib/signal-type-catalog'
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
import { BubbleAction } from './ChatBubble'

const selectClass =
  'h-9 w-full rounded-md border border-border/60 bg-bg-input/80 px-2 text-sm text-text-primary'

/** "Split from here": the message and everything after it become a new conversation. */
export function SplitConversationAction({
  threadId,
  messageId,
}: {
  threadId: string
  messageId: string
}) {
  const { t, i18n } = useTranslation('communication')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<CaseTypeRow[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCategoryId('')
    let cancelled = false
    void listCaseTypes()
      .then((rows) => {
        if (!cancelled) setTypes(rows.filter((row) => row.enabled !== false))
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
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectClass}
            >
              <option value="">{t('splitConversation.noCategory')}</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {signalTypeLabel(type, i18n.language)}
                </option>
              ))}
            </select>
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
