import { TextLink } from '../ui/text-link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Paperclip, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { isSendableMailbox, listEmailConnections, sendNewEmail, type EmailConnection } from '../../lib/email-api'
import type { MessageAttachment } from '../../lib/inbox-api'
import { uploadAttachment } from '../../lib/uploads-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { Callout } from '../ui/callout'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import MessageAttachments from './MessageAttachments'

export type ComposePrefill = {
  to?: string
  subject?: string
  body?: string
  attachments?: MessageAttachment[]
}

type Props = {
  open: boolean
  onClose: () => void
  /** Called with the created thread id after a successful send. */
  onSent: (threadId: string) => void
  /** Prefill for forward ("Fwd: ..." + quoted body) or contact actions. */
  prefill?: ComposePrefill | null
}

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
    () => (connections ?? []).filter(isSendableMailbox),
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
    setAttachments(prefill?.attachments ?? [])
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
      toast.error(formatApiErrorMessage(err, t('compose.uploadError')))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const noMailbox = connections !== null && enabledConnections.length === 0
  const canSend =
    to.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending &&
    !uploading &&
    !noMailbox &&
    connectionId != null
  const toInputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    const focus = window.setTimeout(() => {
      if (prefill?.to) bodyRef.current?.focus()
      else toInputRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(focus)
  }, [open, prefill?.to])

  const handleSend = async () => {
    if (!token || !canSend) return
    setSending(true)
    try {
      const result = await sendNewEmail(token, {
        toAddresses: to.trim(),
        subject: subject.trim() || t('compose.noSubject'),
        bodyText: body.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        connectionId: connectionId ?? undefined,
        attachments: attachments.length ? attachments : undefined,
      })
      toast.success(t('compose.sent'))
      onSent(result.threadId)
      onClose()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('compose.sendError')))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t('compose.title')}
          </DialogTitle>
        </DialogHeader>

        {noMailbox ? (
          <Callout
            tone="warning"
            actions={
              <Link
                to="/settings/channels"
                onClick={onClose}
                className="inline-flex text-xs font-medium text-accent hover:underline"
              >
                {t('compose.connectMailbox')}
              </Link>
            }
          >
            {t('compose.noMailbox')}
          </Callout>
        ) : null}

        {enabledConnections.length > 0 ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary" title={t('compose.fromHint')}>
            <Label className="w-16 shrink-0 text-xs font-medium text-text-muted">{t('compose.from')}</Label>
            {enabledConnections.length === 1 ? (
              <span className="truncate-fade text-sm text-text-primary">{enabledConnections[0].mailboxEmail}</span>
            ) : (
              <ChoiceSelect
                aria-label={t('compose.from')}
                triggerClassName="h-8 flex-1 text-sm"
                value={connectionId != null ? String(connectionId) : undefined}
                onValueChange={(value) => setConnectionId(Number(value) || null)}
                groups={[
                  {
                    items: enabledConnections.map((connection) => ({
                      value: String(connection.id),
                      label: connection.mailboxEmail,
                      kind: 'icon' as const,
                      brandSlug: connection.provider,
                    })),
                  },
                ]}
              />
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs">
          <Label htmlFor="compose-email-to" className="w-16 shrink-0 text-xs font-medium text-text-muted">{t('compose.to')}</Label>
          <Input
            id="compose-email-to"
            ref={toInputRef}
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t('compose.toPlaceholder')}
            className="min-w-0 flex-1"
          />
          <TextLink tone={ccBccOpen || cc || bcc ? 'accent' : 'muted'}
            onClick={() => setCcBccOpen((v) => !v)}
            className="shrink-0 text-xs"
          >
            {t('composer.ccBcc')}
          </TextLink>
        </div>

        {ccBccOpen ? (
          <>
            <div className="flex items-center gap-2 text-xs">
              <Label htmlFor="compose-email-cc" className="w-16 shrink-0 text-xs font-medium text-text-muted">{t('compose.cc')}</Label>
              <Input id="compose-email-cc" type="text" value={cc} onChange={(e) => setCc(e.target.value)} className="min-w-0 flex-1" />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Label htmlFor="compose-email-bcc" className="w-16 shrink-0 text-xs font-medium text-text-muted">{t('compose.bcc')}</Label>
              <Input id="compose-email-bcc" type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} className="min-w-0 flex-1" />
            </div>
          </>
        ) : null}

        <div className="flex items-center gap-2 text-xs">
          <Label htmlFor="compose-email-subject" className="w-16 shrink-0 text-xs font-medium text-text-muted">{t('compose.subject')}</Label>
          <Input
            id="compose-email-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('compose.subjectPlaceholder')}
            className="min-w-0 flex-1"
          />
        </div>

        <Textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleSend()
            }
          }}
          placeholder={t('compose.bodyPlaceholder')}
          rows={10}
          aria-label={t('compose.bodyPlaceholder')}
        />

        <MessageAttachments
          attachments={attachments}
          onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />

        <div className="flex items-center justify-between">
          <input // design-system-ignore: hidden file input opened by the attach button
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={uploading || sending}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
          >
            <Paperclip size={14} />
            {uploading ? t('compose.uploading') : t('compose.attach')}
          </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={sending}>
              {t('compose.cancel')}
            </Button>
            <Button type="button" size="sm" disabled={!canSend} onClick={() => void handleSend()} title={t('composer.hintEmail')} className="gap-1.5">
              <Send size={14} />
              {sending
                ? t('compose.sending')
                : t('compose.send')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
