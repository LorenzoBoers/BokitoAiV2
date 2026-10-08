/**
 * Mail-native composer: opens when the operator clicks Reply / Reply all /
 * Forward on an email bubble (or the Reply tab on an email thread). It grows
 * to roughly two thirds of the thread area — a mini thread view stays above —
 * and shows what mail clients show: real To/CC/BCC fields, an editable
 * subject, the sender signature under the input, and the quoted mail history
 * behind a 3-dots toggle. Bokito extras (AI write assist, dictation,
 * attachments) stay available.
 *
 * Drafts autosave per conversation (`mail-draft-store`): closing the
 * composer, switching threads or reloading keeps the unsent mail, and the
 * thread shows a draft chip to continue it. Sending clears the draft.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Forward,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  Send,
  X as XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import ProviderLogo from '../email/ProviderLogo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { useSpeechDictation, appendSpeechChunk } from '../../hooks/useSpeechDictation'
import { CHAT_COLUMN_CLASS } from '../../lib/chat-layout'
import { cn } from '../../lib/utils'
import type { MessageAttachment } from '../../lib/inbox-api'
import { listChannels, type ChannelRow } from '../../lib/channels-api'
import type { Provider } from '../../lib/email-oauth'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { previewSignatureHtml, type SignatureIdentityVars } from '../../lib/default-signature'
import {
  clearStoredMailDraft,
  mailDraftHasContent,
  readStoredMailDraft,
  writeStoredMailDraft,
  type StoredMailDraft,
} from '../../lib/mail-draft-store'
import { parseAddressList, type MailDraftIntent, type MailDraftMode } from '../../lib/mail-reply'
import { uploadAttachment } from '../../lib/uploads-api'
import ComposerWriteAssist from './ComposerWriteAssist'
import { DictationMicButton } from './DictationMicButton'
import MessageAttachments from './MessageAttachments'

export type MailSendPayload = {
  bodyText: string
  to: string
  cc?: string
  bcc?: string
  subject?: string
  attachments?: MessageAttachment[]
  channelAccountId?: string
  mode: MailDraftMode
  sourceMessageId: string
  quotedHtml?: string
}

type Props = {
  intent: MailDraftIntent
  /** Thread id for the AI write assist. */
  threadId: string
  /** Bound mailbox of the thread (default From). */
  channelAccountId?: string | null
  saving: boolean
  onSend: (payload: MailSendPayload) => Promise<void>
  onCancel: () => void
}

const MODE_META: Record<MailDraftMode, { icon: typeof Reply; labelKey: string }> = {
  reply: { icon: Reply, labelKey: 'mailComposer.modeReply' },
  reply_all: { icon: ReplyAll, labelKey: 'mailComposer.modeReplyAll' },
  forward: { icon: Forward, labelKey: 'mailComposer.modeForward' },
}

export default function MailComposer({
  intent,
  threadId,
  channelAccountId: boundChannelAccountId,
  saving,
  onSend,
  onCancel,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token, user } = useAuth()

  // Unsent draft of this conversation: the body (and attachments) always come
  // back; recipients and subject only when the draft targets the same mail
  // and mode, otherwise the fresh intent wins.
  const [restoredDraft] = useState<StoredMailDraft | null>(() => readStoredMailDraft(threadId))
  const restoredMatchesIntent =
    restoredDraft != null &&
    restoredDraft.mode === intent.mode &&
    restoredDraft.sourceMessageId === intent.sourceMessageId

  const [body, setBody] = useState(() => restoredDraft?.body ?? '')
  const [to, setTo] = useState(() => (restoredMatchesIntent ? restoredDraft.to : intent.to))
  const [cc, setCc] = useState(() => (restoredMatchesIntent ? restoredDraft.cc : intent.cc))
  const [bcc, setBcc] = useState(() => restoredDraft?.bcc ?? '')
  const [subject, setSubject] = useState(() =>
    restoredMatchesIntent ? restoredDraft.subject : intent.subject,
  )
  const [ccBccOpen, setCcBccOpen] = useState(() =>
    Boolean(intent.cc || restoredDraft?.cc || restoredDraft?.bcc),
  )
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [attachments, setAttachments] = useState<MessageAttachment[]>(
    () => restoredDraft?.attachments ?? [],
  )
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  // Mounts collapsed at composer height, then grows — the standard composer
  // visually transforms into the mail surface.
  const [expanded, setExpanded] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setExpanded(true))
    const focus = window.setTimeout(() => {
      // Forward starts with an empty To field; replies start writing.
      if (intent.mode === 'forward' && !intent.to) toFieldRef.current?.focus()
      else textareaRef.current?.focus()
    }, 320)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(focus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  // A new intent (other bubble / other mode) re-seeds the fields but keeps an
  // already-typed body so switching Reply → Reply all does not lose text.
  const intentKey = `${intent.mode}:${intent.sourceMessageId}`
  const prevIntentKeyRef = useRef(intentKey)
  useEffect(() => {
    if (prevIntentKeyRef.current === intentKey) return
    prevIntentKeyRef.current = intentKey
    setTo(intent.to)
    setCc(intent.cc)
    setSubject(intent.subject)
    setCcBccOpen((open) => open || Boolean(intent.cc))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key change carries the new intent
  }, [intentKey])

  // --- Draft persistence -----------------------------------------------
  // Autosaves while typing (debounced) and flushes on unmount, so Esc / X,
  // a thread switch or a reload never loses the mail. Sending clears it.
  const suppressPersistRef = useRef(false)
  const draftRef = useRef<StoredMailDraft | null>(null)
  const [draftSaved, setDraftSaved] = useState(() =>
    Boolean(restoredDraft && mailDraftHasContent(restoredDraft)),
  )

  // From selector: same mailbox set the standard composer offers. A restored
  // draft keeps its chosen mailbox; the fetch below validates the id.
  const [emailChannels, setEmailChannels] = useState<ChannelRow[]>([])
  const [selectedChannelAccountId, setSelectedChannelAccountId] = useState<string | null>(
    () => restoredDraft?.channelAccountId ?? boundChannelAccountId ?? null,
  )
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void listChannels(token)
      .then((rows) => {
        if (cancelled) return
        const mailboxes = rows.filter(
          (row) =>
            row.channel === 'email' &&
            row.isEnabled &&
            row.capabilities.includes('send') &&
            (row.kind === 'email_mailbox' || row.kind === 'email_relay'),
        )
        setEmailChannels(mailboxes)
        setSelectedChannelAccountId((prev) => {
          if (prev && mailboxes.some((row) => row.id === prev)) return prev
          if (boundChannelAccountId && mailboxes.some((row) => row.id === boundChannelAccountId)) {
            return boundChannelAccountId
          }
          return mailboxes[0]?.id ?? null
        })
      })
      .catch(() => {
        if (!cancelled) setEmailChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [token, boundChannelAccountId])
  const selectedMailbox = useMemo(
    () => emailChannels.find((row) => row.id === selectedChannelAccountId) ?? null,
    [emailChannels, selectedChannelAccountId],
  )

  // Snapshot for the draft store, kept fresh every render so the unmount
  // flush below writes the very last keystrokes.
  draftRef.current = {
    mode: intent.mode,
    sourceMessageId: intent.sourceMessageId,
    to,
    cc,
    bcc,
    subject,
    body,
    attachments,
    channelAccountId: selectedChannelAccountId,
    updatedAt: new Date().toISOString(),
  }

  useEffect(() => {
    if (suppressPersistRef.current) return
    const timer = window.setTimeout(() => {
      if (suppressPersistRef.current || !draftRef.current) return
      writeStoredMailDraft(threadId, draftRef.current)
      setDraftSaved(mailDraftHasContent(draftRef.current))
    }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot lives in draftRef
  }, [threadId, body, to, cc, bcc, subject, attachments, selectedChannelAccountId, intentKey])

  useEffect(() => {
    return () => {
      if (suppressPersistRef.current || !draftRef.current) return
      writeStoredMailDraft(threadId, draftRef.current)
    }
  }, [threadId])

  // Signature exactly as the server will append it (custom template rendered,
  // or the Bokito default with avatar).
  const signatureIdentity = useMemo<SignatureIdentityVars>(
    () => ({
      name: user?.name || user?.email || '',
      email: user?.email ?? null,
      jobTitle: user?.jobTitle ?? null,
      company: user?.tenant?.name ?? null,
      avatarUrl: user?.avatarUrl || user?.signatureUrl || null,
      language: i18n.language,
    }),
    [user?.name, user?.email, user?.jobTitle, user?.tenant?.name, user?.avatarUrl, user?.signatureUrl, i18n.language],
  )
  const signatureHtml = useMemo(
    () => previewSignatureHtml(user?.emailSignatureHtml, signatureIdentity),
    [user?.emailSignatureHtml, signatureIdentity],
  )

  const dictationInterimRef = useRef('')
  const [dictationInterim, setDictationInterim] = useState('')
  dictationInterimRef.current = dictationInterim
  const appendDictation = (chunk: string) => {
    setBody((prev) => appendSpeechChunk(prev, chunk))
    setDictationInterim('')
  }
  const dictation = useSpeechDictation({
    onFinal: appendDictation,
    onInterim: setDictationInterim,
  })
  const confirmDictation = () => {
    const pending = dictationInterimRef.current.trim()
    dictation.stop()
    if (pending) appendDictation(pending)
    else setDictationInterim('')
  }
  const composerValue =
    dictation.listening && dictationInterim.trim()
      ? body
        ? `${body} ${dictationInterim}`
        : dictationInterim
      : body

  const onPickFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length || !token) return
    setUploading(true)
    try {
      const uploaded: MessageAttachment[] = []
      for (const file of list) {
        uploaded.push(await uploadAttachment(token, file))
      }
      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.uploadError')))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const validTo = parseAddressList(to).length > 0
  const canSend = validTo && (Boolean(body.trim()) || attachments.length > 0)
  const busy = saving || sending

  const handleSend = async () => {
    if (!canSend || busy) return
    setSending(true)
    // Clear the stored draft up front so the unmount flush after a
    // successful send cannot write the sent text back as a leftover draft.
    suppressPersistRef.current = true
    clearStoredMailDraft(threadId)
    try {
      await onSend({
        bodyText: body.trim(),
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim() || undefined,
        attachments: attachments.length ? attachments : undefined,
        channelAccountId: selectedChannelAccountId || undefined,
        mode: intent.mode,
        sourceMessageId: intent.sourceMessageId,
        quotedHtml: intent.quotedHtml || undefined,
      })
    } catch (err) {
      // The mail did not go out: keep the draft.
      suppressPersistRef.current = false
      if (draftRef.current) writeStoredMailDraft(threadId, draftRef.current)
      toast.error(formatApiErrorMessage(err, t('composer.sendError')))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSend()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const ModeIcon = MODE_META[intent.mode].icon
  const modeLabel = t(MODE_META[intent.mode].labelKey)
  const fieldRow = 'flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-xs'
  const fieldLabel = 'w-14 shrink-0 font-medium text-text-muted'
  const fieldInput =
    'min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none'

  return (
    <div className="relative shrink-0 bg-bg px-4 pb-4 pt-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full z-10 h-12 bg-gradient-to-t from-bg from-20% to-transparent"
      />
      <div
        className={cn(CHAT_COLUMN_CLASS, 'overflow-hidden transition-[height] duration-300 ease-out')}
        style={{ height: expanded ? 'min(62vh, 640px)' : '148px' }}
        onKeyDown={onKeyDown}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-bg-surface shadow-sm">
          {/* Header: mode + From + close */}
          <div className="flex items-center gap-2 border-b border-border/50 bg-bg-elevated/60 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-text-heading">
              <ModeIcon size={13} className="text-text-muted" />
              {modeLabel}
            </span>
            <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
            {emailChannels.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                    title={t('compose.fromHint')}
                  >
                    {selectedMailbox ? (
                      <ProviderLogo
                        provider={selectedMailbox.provider as Provider}
                        className="h-3 w-3 shrink-0 object-contain"
                      />
                    ) : null}
                    <span className="max-w-[14rem] truncate-fade">
                      {selectedMailbox
                        ? mailboxDisplayLabel(
                            selectedMailbox.displayName || selectedMailbox.label,
                            selectedMailbox.address,
                          )
                        : t('compose.from')}
                    </span>
                    <ChevronDown size={11} className="shrink-0 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <p className="px-2 py-1.5 text-2xs font-semibold text-text-muted">
                    {t('composer.sendFrom', { defaultValue: 'Send from' })}
                  </p>
                  {emailChannels.map((row) => {
                    const label = mailboxDisplayLabel(row.displayName || row.label, row.address)
                    const active = row.id === selectedChannelAccountId
                    return (
                      <DropdownMenuItem
                        key={row.id}
                        className="gap-2 text-xs"
                        onSelect={() => setSelectedChannelAccountId(row.id)}
                      >
                        <ProviderLogo
                          provider={row.provider as Provider}
                          className="h-3.5 w-3.5 shrink-0 object-contain"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate-fade font-medium text-text-heading">{label}</span>
                          {row.address && label !== row.address ? (
                            <span className="block truncate-fade text-2xs text-text-muted">{row.address}</span>
                          ) : null}
                        </span>
                        {active ? <Check size={12} className="shrink-0 text-accent" /> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : selectedMailbox ? (
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
                <ProviderLogo
                  provider={selectedMailbox.provider as Provider}
                  className="h-3 w-3 shrink-0 object-contain"
                />
                <span className="max-w-[16rem] truncate-fade">
                  {mailboxDisplayLabel(
                    selectedMailbox.displayName || selectedMailbox.label,
                    selectedMailbox.address,
                  )}
                </span>
              </span>
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              title={t('compose.cancel')}
              aria-label={t('compose.cancel')}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <XIcon size={13} />
            </button>
          </div>

          {/* Recipients + subject */}
          <div className={fieldRow}>
            <span className={fieldLabel}>{t('compose.to')}</span>
            <input
              ref={toFieldRef}
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={t('compose.toPlaceholder')}
              className={fieldInput}
              data-testid="mail-composer-to"
            />
            <button
              type="button"
              onClick={() => setCcBccOpen((open) => !open)}
              className={cn(
                'shrink-0 text-2xs font-medium transition-colors',
                ccBccOpen || cc || bcc ? 'text-accent' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {t('composer.ccBcc')}
            </button>
          </div>
          {ccBccOpen ? (
            <>
              <div className={fieldRow}>
                <span className={fieldLabel}>{t('compose.cc')}</span>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder={t('compose.ccPlaceholder')}
                  className={fieldInput}
                />
              </div>
              <div className={fieldRow}>
                <span className={fieldLabel}>{t('compose.bcc')}</span>
                <input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder={t('compose.bccPlaceholder')}
                  className={fieldInput}
                />
              </div>
            </>
          ) : null}
          <div className={fieldRow}>
            <span className={fieldLabel}>{t('compose.subject')}</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('compose.subjectPlaceholder')}
              className={cn(fieldInput, 'font-medium')}
              data-testid="mail-composer-subject"
            />
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <textarea
              ref={textareaRef}
              value={composerValue}
              readOnly={dictation.listening}
              onChange={(e) => {
                if (!dictation.listening) setBody(e.target.value)
              }}
              placeholder={
                dictation.listening ? t('composer.dictationListening') : t('compose.bodyPlaceholder')
              }
              className="min-h-[7rem] w-full flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
              data-testid="mail-composer-body"
            />
            <div className="px-3">
              <MessageAttachments
                attachments={attachments}
                onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
              />
            </div>

            {/* Signature sits under the input, like the mail that goes out. */}
            <div className="border-t border-border/40 px-3 py-2">
              <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
                {t('mailComposer.signature')}
              </p>
              <div
                className="pointer-events-none max-h-28 origin-top-left overflow-hidden text-[13px] opacity-80 [&_img]:inline-block"
                dangerouslySetInnerHTML={{ __html: signatureHtml }}
              />
            </div>

            {/* 3-dots: expand the quoted mail history that is sent along. */}
            {intent.quotedHtml ? (
              <div className="border-t border-border/40 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setQuoteOpen((open) => !open)}
                  title={t('mailComposer.quoteToggle')}
                  aria-label={t('mailComposer.quoteToggle')}
                  aria-expanded={quoteOpen}
                  className="flex h-5 items-center rounded-full border border-border/60 bg-bg-elevated px-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                  data-testid="mail-composer-quote-toggle"
                >
                  <MoreHorizontal size={13} />
                </button>
                {quoteOpen ? (
                  <iframe
                    sandbox=""
                    srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:8px;font:13px/1.45 -apple-system,'Segoe UI',sans-serif;color:#374151;overflow-wrap:break-word}img{max-width:100%}</style></head><body>${intent.quotedHtml}</body></html>`}
                    title={t('mailComposer.quoteTitle')}
                    className="mt-2 h-48 w-full rounded-md border border-border/40 bg-white"
                  />
                ) : intent.quotedPreview ? (
                  <p className="mt-1 truncate text-2xs text-text-muted">{intent.quotedPreview}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Footer: Bokito extras + send */}
          <div className="flex items-center gap-1.5 border-t border-border/50 bg-bg-elevated/40 px-2.5 py-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void onPickFiles(e.target.files)}
            />
            <ComposerWriteAssist
              threadId={threadId}
              body={body}
              disabled={busy}
              onApply={(text) => {
                setBody(text)
                requestAnimationFrame(() => textareaRef.current?.focus())
              }}
            />
            {dictation.supported ? (
              <DictationMicButton
                listening={dictation.listening}
                disabled={busy}
                onStart={() => dictation.start()}
                onConfirm={confirmDictation}
              />
            ) : null}
            <button
              type="button"
              disabled={uploading || busy}
              onClick={() => fileInputRef.current?.click()}
              title={t('composer.attachFile')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            >
              <Paperclip size={14} />
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-2xs text-text-muted sm:block">
                {draftSaved && mailDraftHasContent({ body, attachments })
                  ? `${t('mailComposer.draftSaved')} · ${t('composer.sendShortcut')}`
                  : t('composer.sendShortcut')}
              </span>
              <button
                type="button"
                disabled={!canSend || busy || uploading}
                onClick={() => void handleSend()}
                title={`${t('composer.sendTitle')} — ${t('composer.hintEmail')}`}
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
                data-testid="mail-composer-send"
              >
                <Send size={13} />
                <span className="text-xs font-medium">
                  {sending ? t('compose.sending') : t('compose.send')}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
