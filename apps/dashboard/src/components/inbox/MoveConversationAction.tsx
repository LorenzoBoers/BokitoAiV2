import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { inboxPath } from '../../lib/messages-paths'
import { listCategories, type CategoryRow } from '../../lib/tickets-api'
import { moveSignalMessages } from '../../lib/signals-api'
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
import { Input } from '../ui/input'
import { SegmentedControl } from '../ui/segmented-control'
import { BubbleAction } from './ChatBubble'
import { ConversationPicker } from './ConversationPicker'

const NONE = '__none__'

type Target = 'new' | 'existing'

/** "Move to": this message and everything after it go to a new or an existing conversation. */
export function MoveConversationAction({
  threadId,
  messageId,
  customer,
}: {
  threadId: string
  messageId: string
  /** Customer conversations keep contact and channel on a new conversation; a title is not asked. */
  customer: boolean
}) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Target>('new')
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null)
  const [title, setTitle] = useState('')
  const [types, setTypes] = useState<CategoryRow[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTarget('new')
    setPicked(null)
    setTitle('')
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

  const move = async () => {
    if (!token) return
    if (target === 'existing' && !picked) return
    setBusy(true)
    try {
      const res = await moveSignalMessages(token, threadId, {
        fromMessageId: messageId,
        targetId: target === 'existing' ? picked?.id : null,
        categoryId: target === 'new' ? categoryId : null,
        title: target === 'new' ? title.trim() : '',
      })
      setOpen(false)
      toast.success(t('moveConversation.done', { title: res.title || t('chatStack.untitled') }))
      navigate(inboxPath('all', res.signal_id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('moveConversation.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <BubbleAction label={t('moveConversation.action')} onClick={() => setOpen(true)}>
        <ArrowRightLeft size={14} />
      </BubbleAction>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('moveConversation.title')}</DialogTitle>
            <DialogDescription>{t('moveConversation.hint')}</DialogDescription>
          </DialogHeader>
          <SegmentedControl
            size="sm"
            value={target}
            onChange={setTarget}
            options={[
              { value: 'new', label: t('moveConversation.toNew') },
              { value: 'existing', label: t('moveConversation.toExisting') },
            ]}
          />
          {target === 'new' ? (
            <div className="space-y-3">
              {!customer ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-text-muted">{t('moveConversation.newTitle')}</span>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
              ) : null}
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('moveConversation.category')}</span>
                <ChoiceSelect
                  aria-label={t('moveConversation.category')}
                  triggerClassName="h-9 text-sm"
                  value={categoryId || NONE}
                  onValueChange={(value) => setCategoryId(value === NONE ? '' : value)}
                  groups={[
                    {
                      items: [
                        { value: NONE, label: t('moveConversation.noCategory'), kind: 'icon' },
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
            </div>
          ) : (
            <ConversationPicker excludeId={threadId} selectedId={picked?.id} onPick={setPicked} />
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('moveConversation.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy || (target === 'existing' && !picked)}
              onClick={() => void move()}
            >
              {t('moveConversation.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
