import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, MessageCircle, MoreHorizontal, Phone, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import {
  markThreadHandledExternally,
  type HandledExternallyChannel,
  type ThreadId,
} from '../../lib/inbox-api'
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
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

const CHANNELS: Array<{ value: HandledExternallyChannel; icon: LucideIcon; key: string }> = [
  { value: 'phone', icon: Phone, key: 'phone' },
  { value: 'whatsapp', icon: MessageCircle, key: 'whatsapp' },
  { value: 'email', icon: Mail, key: 'email' },
  { value: 'other', icon: MoreHorizontal, key: 'other' },
]

type FormProps = {
  threadId: ThreadId
  /** Called after the server accepted the log line. */
  onDone: (info: { closed: boolean }) => void
  onCancel?: () => void
  /** Render the footer buttons; dialogs pass their own footer wrapper. */
  footer?: (controls: { submit: () => void; busy: boolean }) => React.ReactNode
}

/**
 * "Already handled outside Bokito": pick where it was settled, add an
 * optional note, choose whether to close. Shared by the Wat nu dialog and
 * the composer menu.
 */
export function HandledExternallyForm({ threadId, onDone, onCancel, footer }: FormProps) {
  const { t, i18n } = useTranslation('communication')
  const { token } = useAuth()
  const [channel, setChannel] = useState<HandledExternallyChannel>('phone')
  const [note, setNote] = useState('')
  const [close, setClose] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    if (!token || busy) return
    setBusy(true)
    try {
      await markThreadHandledExternally(token, threadId, {
        channel,
        note: note.trim(),
        close,
        language: i18n.language,
      })
      toast.success(t('handledExternally.done'))
      onDone({ closed: close })
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('handledExternally.failed')))
    } finally {
      setBusy(false)
    }
  }, [token, busy, threadId, channel, note, close, i18n.language, t, onDone])

  return (
    <div className="space-y-3" data-testid="handled-externally-form">
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('handledExternally.where')}</span>
        <div className="grid grid-cols-2 gap-1.5">
          {CHANNELS.map(({ value, icon: Icon, key }) => (
            <button
              key={value}
              type="button"
              onClick={() => setChannel(value)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                channel === value
                  ? 'border-border-light bg-bg-hover font-medium text-accent'
                  : 'border-border/60 bg-bg-surface text-text-secondary hover:border-border-light',
              )}
            >
              <Icon size={13} className="shrink-0" />
              {t(`handledExternally.channel.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('handledExternally.noteLabel')}</span>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('handledExternally.notePlaceholder')}
          maxLength={2000}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={close}
          onChange={(e) => setClose(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border accent-accent"
        />
        {t('handledExternally.alsoClose')}
      </label>
      {footer ? (
        footer({ submit: () => void submit(), busy })
      ) : (
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {t('threadChrome.cancel', { defaultValue: 'Cancel' })}
            </Button>
          ) : null}
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? t('handledExternally.saving') : t('handledExternally.confirm')}
          </Button>
        </div>
      )}
    </div>
  )
}

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  threadId: ThreadId
  onDone: (info: { closed: boolean }) => void
}

/** Standalone dialog for the composer menu entry. */
export function HandledExternallyDialog({ open, onOpenChange, threadId, onDone }: DialogProps) {
  const { t } = useTranslation('communication')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('handledExternally.title')}</DialogTitle>
          <DialogDescription>{t('handledExternally.hint')}</DialogDescription>
        </DialogHeader>
        {open ? (
          <HandledExternallyForm
            threadId={threadId}
            onCancel={() => onOpenChange(false)}
            onDone={(info) => {
              onOpenChange(false)
              onDone(info)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
