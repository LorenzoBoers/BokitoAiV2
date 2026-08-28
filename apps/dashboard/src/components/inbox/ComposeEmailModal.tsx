import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { MessageSquareText, Paperclip, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { isSendableMailbox, listEmailConnections, sendNewEmail, type EmailConnection } from '../../lib/email-api'
import type { MessageAttachment } from '../../lib/inbox-api'
import { listSavedReplies, type SavedReplyRow } from '../../lib/signals-api'
import { uploadAttachment } from '../../lib/uploads-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
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

const FIELD =
  'w-full rounded-md border border-border/60 bg-bg-input px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none'

export default function ComposeEmailModal({ open, onClose, onSent, prefill }: Props) {
  const { t } = useTranslation('communication')
  const navigate = useNavigate()
  const { token } = useAuth()
  const [savedReplies, setSavedReplies] = useState<SavedReplyRow[] | null>(null)
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

  const loadSavedReplies = async () => {
    if (!token || savedReplies !== null) return
    try {
      setSavedReplies(await listSavedReplies(token))
    } catch (err) {
      setSavedReplies([])
      toast.error(formatApiErrorMessage(err, t('composer.loadSavedRepliesError')))
    }
  }

  const insertSavedReply = (row: SavedReplyRow) => {
    setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${row.bodyText}` : row.bodyText))
    requestAnimationFrame(() => bodyRef.current?.focus())
  }

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
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/8 px-3 py-2.5 text-[13px] text-text-secondary">
            <p>{t('compose.noMailbox')}</p>
            <Link
              to="/settings/channels"
              onClick={onClose}
              className="mt-1.5 inline-flex font-medium text-accent hover:underline"
            >
              {t('compose.connectMailbox')}
            </Link>
          </div>
        ) : null}

        {enabledConnections.length > 0 ? (
          <label className="flex items-center gap-2 text-[12px] text-text-secondary" title={t('compose.fromHint')}>
            <span className="w-16 shrink-0 font-medium text-text-muted">{t('compose.from')}</span>
            {enabledConnections.length === 1 ? (
              <span className="truncate text-[13px] text-text-primary">{enabledConnections[0].mailboxEmail}</span>
            ) : (
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
            )}
          </label>
        ) : null}

        <div className="flex items-center gap-2 text-[12px]">
          <span className="w-16 shrink-0 font-medium text-text-muted">{t('compose.to')}</span>
          <input
            ref={toInputRef}
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={t('compose.toPlaceholder')}
            className={FIELD}
          />
          <button
            type="button"
            onClick={() => setCcBccOpen((v) => !v)}
            className={`shrink-0 text-[11px] font-medium transition-colors ${
              ccBccOpen || cc || bcc ? 'text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {t('composer.ccBcc')}
          </button>
        </div>

        {ccBccOpen ? (
          <>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-16 shrink-0 font-medium text-text-muted">{t('compose.cc')}</span>
              <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} className={FIELD} />
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-16 shrink-0 font-medium text-text-muted">{t('compose.bcc')}</span>
              <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} className={FIELD} />
            </div>
          </>
        ) : null}

        <div className="flex items-center gap-2 text-[12px]">
          <span className="w-16 shrink-0 font-medium text-text-muted">{t('compose.subject')}</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('compose.subjectPlaceholder')}
            className={FIELD}
          />
        </div>

        <textarea
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
          <div className="flex items-center gap-1">
          <DropdownMenu onOpenChange={(next) => next && void loadSavedReplies()}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={sending}
                title={t('composer.savedReplies')}
                className="gap-1.5 text-xs text-text-muted hover:text-text-primary"
              >
                <MessageSquareText size={13} />
                {t('composer.templates')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {savedReplies === null ? (
                <DropdownMenuItem disabled className="text-xs">
                  {t('composer.loadingSavedReplies')}
                </DropdownMenuItem>
              ) : savedReplies.length === 0 ? (
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => {
                    onClose()
                    navigate('/settings/channels#saved-replies')
                  }}
                >
                  {t('composer.noSavedReplies')}
                </DropdownMenuItem>
              ) : (
                savedReplies.map((row) => (
                  <DropdownMenuItem
                    key={row.id}
                    className="flex-col items-start gap-0.5 text-xs"
                    onSelect={() => insertSavedReply(row)}
                  >
                    <span className="font-medium text-text-heading">{row.title}</span>
                    <span className="line-clamp-1 text-[11px] text-text-muted">{row.bodyText}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => {
                  onClose()
                  navigate('/settings/channels#saved-replies')
                }}
              >
                {t('composer.manageSavedReplies')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={uploading || sending}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            <Paperclip size={13} />
            {uploading ? t('compose.uploading') : t('compose.attach')}
          </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={sending}>
              {t('compose.cancel')}
            </Button>
            <Button type="button" size="sm" disabled={!canSend} onClick={() => void handleSend()} title={t('composer.hintEmail')} className="gap-1.5">
              <Send size={13} />
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
