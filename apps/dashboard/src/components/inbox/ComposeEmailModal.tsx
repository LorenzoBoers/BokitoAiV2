import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { listEmailConnections, sendNewEmail, type EmailConnection } from '../../lib/email-api'
import type { MessageAttachment } from '../../lib/inbox-api'
import { uploadAttachment } from '../../lib/uploads-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import MessageAttachments from './MessageAttachments'

export type ComposePrefill = {
  to?: string
  subject?: string
  body?: string
}

type Props = {
  open: boolean
  onClose: () => void
  /** Called with the created thread id after a successful send. */
  onSent: (threadId: string) => void
  /** Prefill for forward ("Fwd: ..." + quoted body) or contact actions. */
  prefill?: ComposePrefill | null
}

const FIELD =
  'w-full rounded-md border border-border/60 bg-bg-input px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none'

export default function ComposeEmailModal({ open, onClose, onSent, prefill }: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [connections, setConnections] = useState<EmailConnection[] | null>(null)
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [ccBccOpen, setCcBccOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const enabledConnections = useMemo(
    () => (connections ?? []).filter((c) => c.isEnabled && c.status === 'connected'),
    [connections],
  )

  useEffect(() => {
    if (!open) return
    setTo(prefill?.to ?? '')
    setSubject(prefill?.subject ?? '')
    setBody(prefill?.body ?? '')
    setCc('')
    setBcc('')
    setCcBccOpen(false)
    setAttachments([])
  }, [open, prefill])

  useEffect(() => {
    if (!open || !token || connections !== null) return
    listEmailConnections(token)
      .then((rows) => {
        setConnections(rows)
        const primary = rows.find((c) => c.isPrimary && c.isEnabled) ?? rows.find((c) => c.isEnabled)
        if (primary) setConnectionId(primary.id)
      })
      .catch(() => setConnections([]))
  }, [open, token, connections])

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !token) return
    setUploading(true)
    try {
      const uploaded: MessageAttachment[] = []
      for (const file of Array.from(files)) {
        uploaded.push(await uploadAttachment(token, file))
      }
      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not upload attachment.'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const canSend = to.trim().length > 0 && body.trim().length > 0 && !sending && !uploading

  const handleSend = async () => {
    if (!token || !canSend) return
    setSending(true)
    try {
      const result = await sendNewEmail(token, {
        toAddresses: to.trim(),
        subject: subject.trim() || '(No subject)',
        bodyText: body.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        connectionId: connectionId ?? undefined,
        attachments: attachments.length ? attachments : undefined,
      })
      toast.success(t('compose.sent', { defaultValue: 'Email sent' }))
      onSent(result.threadId)
      onClose()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not send email.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t('compose.title', { defaultValue: 'New email' })}
          </DialogTitle>
        </DialogHeader>

        {enabledConnections.length > 1 ? (
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <span className="w-12 shrink-0 font-medium text-text-muted">From</span>
            <select
              value={connectionId ?? ''}
              onChange={(e) => setConnectionId(Number(e.target.value) || null)}
              className={FIELD}
            >
              {enabledConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.mailboxEmail}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-2 text-[12px]">
          <span className="w-12 shrink-0 font-medium text-text-muted">To</span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com, other@example.com"
            className={FIELD}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setCcBccOpen((v) => !v)}
            className={`shrink-0 text-[11px] font-medium transition-colors ${
              ccBccOpen || cc || bcc ? 'text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            CC/BCC
          </button>
        </div>

        {ccBccOpen ? (
          <>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-12 shrink-0 font-medium text-text-muted">CC</span>
              <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} className={FIELD} />
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-12 shrink-0 font-medium text-text-muted">BCC</span>
              <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} className={FIELD} />
            </div>
          </>
        ) : null}

        <div className="flex items-center gap-2 text-[12px]">
          <span className="w-12 shrink-0 font-medium text-text-muted">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('compose.subjectPlaceholder', { defaultValue: 'Subject' })}
            className={FIELD}
          />
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('compose.bodyPlaceholder', { defaultValue: 'Write your message...' })}
          rows={10}
          className="max-h-[320px] min-h-[160px] w-full resize-y rounded-md border border-border/60 bg-bg-input px-2.5 py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
        />

        <MessageAttachments
          attachments={attachments}
          onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />

        <div className="flex items-center justify-between">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading || sending}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            <Paperclip size={13} />
            {uploading ? 'Uploading...' : 'Attach'}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={sending}>
              {t('compose.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="button" size="sm" disabled={!canSend} onClick={() => void handleSend()} className="gap-1.5">
              <Send size={13} />
              {sending
                ? t('compose.sending', { defaultValue: 'Sending...' })
                : t('compose.send', { defaultValue: 'Send' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
