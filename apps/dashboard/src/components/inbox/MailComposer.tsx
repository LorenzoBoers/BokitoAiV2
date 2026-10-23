/**
 * Mail-native composer: opens when the operator clicks Reply / Reply all /
 * Forward on an email bubble (or the Reply tab on an email thread). It grows
 * to roughly two thirds of the thread area — a mini thread view stays above —
 * and shows what mail clients show: real To/CC/BCC fields, an editable
 * subject, the sender signature in the same letter scroll, and the quoted
 * mail history behind a 3-dots toggle (expanded inline, not a nested pane).
 * Bokito extras (AI write assist, dictation, attachments) stay available.
 *
 * Drafts autosave per conversation (`mail-draft-store`): closing the
 * composer, switching threads or reloading keeps the unsent mail, and the
 * thread shows a draft chip to continue it. Sending clears the draft.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Forward,
  Mail,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Reply,
  ReplyAll,
  Send,
  User as UserIcon,
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
import { Button } from '../ui/button'
import type { MessageAttachment } from '../../lib/inbox-api'
import { channelCanSend, listChannels, type ChannelRow } from '../../lib/channels-api'
import {
  getConnectionSignature,
  listEmailConnections,
  type SignatureSource,
} from '../../lib/email-api'
import { canComposeToAddress } from '../../lib/compose-intent'
import { humanizeContactName } from '../../lib/contact-label'
import { listContacts } from '../../lib/contacts-api'
import type { Provider } from '../../lib/email-oauth'
import { readLastMailboxChannelAccountId, writeLastMailboxChannelAccountId } from '../../lib/last-mailbox'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import {
  previewOutboundSignatureHtml,
  type SignatureIdentityVars,
} from '../../lib/default-signature'
import {
  clearStoredMailDraft,
  mailDraftHasContent,
  readStoredMailDraft,
  writeStoredMailDraft,
  type StoredMailDraft,
} from '../../lib/mail-draft-store'
import {
  parseAddressList,
  type MailComposerIntent,
  type MailComposerMode,
} from '../../lib/mail-reply'
import { uploadAttachment } from '../../lib/uploads-api'
import ComposerWriteAssist from './ComposerWriteAssist'
import { ComposerDictationRow } from './DictationMicButton'
import MessageAttachments from './MessageAttachments'

export type MailSendPayload = {
  bodyText: string
  to: string
  cc?: string
  bcc?: string
  subject?: string
  attachments?: MessageAttachment[]
  channelAccountId?: string
  /** Address of the chosen From mailbox (maps back to a connection id). */
  fromAddress?: string
  mode: MailComposerMode
  /** Empty for a brand-new mail or when the source left the loaded window. */
  sourceMessageId: string
  quotedHtml?: string
}

export type MailRecipientSuggestion = { label: string; address: string }

type Props = {
  intent: MailComposerIntent
  /** Thread id for the AI write assist; null hides it (new mail). */
  threadId?: string | null
  /** Stable key the unsent draft persists under (thread id, or 'new'). */
  draftKey: string
  /** Bound mailbox of the thread (default From). */
  channelAccountId?: string | null
  /** Preferred From mailbox by address when no channel account id is known. */
  defaultFromAddress?: string | null
  /** Contact suggestions for To/CC/BCC; fetched from contacts when omitted. */
  recipientSuggestions?: MailRecipientSuggestion[]
  /** Deeplinked body text; a restored draft body wins unless preferSeedBody. */
  initialBody?: string
  /**
   * The operator was already editing this text in the small composer.
   * That body wins over a stored mail draft for this open.
   */
  preferSeedBody?: boolean
  /**
   * When false, this open ignores a stored draft. A fresh email start uses
   * that so To stays empty; the draft chip resumes with the default true.
   */
  restoreDraft?: boolean
  /**
   * 'thread': grows out of the standard composer at the bottom of a thread.
   * 'page': static full-height card (New conversation page).
   */
  variant?: 'thread' | 'page'
  /** Fill the parent (floating window that has become the mail composer). */
  fill?: boolean
  saving: boolean
  onSend: (payload: MailSendPayload) => Promise<void>
  onCancel: () => void
}

const MODE_META: Record<MailComposerMode, { icon: typeof Reply; labelKey: string }> = {
  reply: { icon: Reply, labelKey: 'mailComposer.modeReply' },
  reply_all: { icon: ReplyAll, labelKey: 'mailComposer.modeReplyAll' },
  forward: { icon: Forward, labelKey: 'mailComposer.modeForward' },
  new: { icon: Mail, labelKey: 'mailComposer.modeNew' },
}

function fitQuoteFrame(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument
  if (!doc?.documentElement) return
  const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)
  frame.style.height = `${height}px`
}

/** Quoted history stays sandboxed and grows with the letter instead of scrolling inside itself. */
function QuotedMailFrame({ html, title }: { html: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  return (
    <iframe
      ref={frameRef}
      sandbox="allow-same-origin"
      scrolling="no"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;font:13px/1.45 -apple-system,'Segoe UI',sans-serif;color:#374151;overflow-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`}
      title={title}
      onLoad={() => {
        const frame = frameRef.current
        if (!frame) return
        fitQuoteFrame(frame)
        const doc = frame.contentDocument
        if (!doc) return
        for (const img of Array.from(doc.images)) {
          if (!img.complete) img.addEventListener('load', () => fitQuoteFrame(frame), { once: true })
        }
      }}
      className="mt-2 block w-full overflow-hidden border-0 bg-transparent"
    />
  )
}

const FIELD_ROW = 'flex items-center gap-3 border-b border-border px-3 py-1.5 text-xs'
/** Wide enough for NL "Onderwerp" so label→value gap stays even across rows. */
const FIELD_LABEL = 'w-[5.5rem] shrink-0 font-normal text-text-muted'
const FIELD_INPUT =
  'min-w-0 flex-1 bg-transparent font-normal text-text-primary placeholder:text-text-muted focus:outline-none'

/**
 * Comma-separated entries that do not contain a usable address. The trailing
 * entry can be skipped so the hint stays quiet while someone is still typing
 * it; blurring the field (or a comma) makes it count.
 */
function invalidRecipientTokens(raw: string, opts: { skipTrailing?: boolean } = {}): string[] {
  const tokens = raw.split(',').map((part) => part.trim())
  const considered = opts.skipTrailing ? tokens.slice(0, -1) : tokens
  return considered.filter((token) => token && parseAddressList(token).length === 0)
}

type RecipientFieldProps = {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Contact pool to suggest from; filtered on the entry being typed. */
  suggestions: MailRecipientSuggestion[]
  /** Addresses already picked anywhere (To/CC/BCC) — never re-suggested. */
  exclude: ReadonlySet<string>
  inputRef?: RefObject<HTMLInputElement | null>
  testId?: string
  onFocusChange?: (focused: boolean) => void
  /** Extra control rendered at the end of the row (CC/BCC toggle). */
  trailing?: ReactNode
}

/**
 * One recipient row (To / CC / BCC) with a shared contact typeahead:
 * matches on the entry after the last comma, supports ArrowUp/Down + Enter
 * or Tab to pick, and Escape closes the dropdown before it closes the
 * composer.
 */
function RecipientField({
  label,
  value,
  onChange,
  placeholder,
  suggestions,
  exclude,
  inputRef,
  testId,
  onFocusChange,
  trailing,
}: RecipientFieldProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef

  const matches = useMemo(() => {
    if (!suggestions.length) return []
    const parts = value.split(',')
    const query = (parts[parts.length - 1] ?? '').trim().toLowerCase()
    return suggestions
      .filter((s) => !exclude.has(s.address.trim().toLowerCase()))
      .filter((s) => !query || `${s.label} ${s.address}`.toLowerCase().includes(query))
      .slice(0, 6)
  }, [suggestions, exclude, value])

  // Typing changes the match list; drop a highlight that no longer exists.
  useEffect(() => {
    setActiveIndex((prev) => (prev >= matches.length ? -1 : prev))
  }, [matches.length])

  const pick = (address: string) => {
    const parts = value.split(',')
    parts[parts.length - 1] = address
    onChange(
      parts
        .map((p) => p.trim())
        .filter(Boolean)
        .join(', '),
    )
    setOpen(false)
    setActiveIndex(-1)
    ref.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return
      e.preventDefault()
      setOpen(true)
      setActiveIndex((prev) => {
        if (e.key === 'ArrowDown') return prev >= matches.length - 1 ? 0 : prev + 1
        return prev <= 0 ? matches.length - 1 : prev - 1
      })
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && open && activeIndex >= 0 && matches[activeIndex]) {
      e.preventDefault()
      pick(matches[activeIndex].address)
      return
    }
    if (e.key === 'Escape' && open) {
      // First Escape only dismisses the dropdown; the next one reaches the
      // composer and closes it.
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div className={cn(FIELD_ROW, 'relative')}>
      <span className={FIELD_LABEL}>{label}</span>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
          onFocusChange?.(true)
        }}
        onBlur={() => {
          onFocusChange?.(false)
          window.setTimeout(() => {
            setOpen(false)
            setActiveIndex(-1)
          }, 120)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={FIELD_INPUT}
        data-testid={testId}
      />
      {open && matches.length ? (
        <div className="absolute left-[calc(0.75rem+5.5rem+0.75rem)] right-3 top-[calc(100%+2px)] z-20 overflow-hidden rounded-lg border border-border bg-bg-surface shadow-overlay">
          <div className="max-h-56 overflow-y-auto p-1">
            {matches.map((s, index) => (
              <button
                key={s.address}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(s.address)
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                  index === activeIndex ? 'bg-bg-hover/60' : 'hover:bg-bg-hover/60',
                )}
              >
                <UserIcon size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate-fade text-xs text-text-primary">{s.label}</span>
                  {s.label !== s.address ? (
                    <span className="block truncate-fade text-2xs text-text-muted">{s.address}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {trailing}
    </div>
  )
}

export default function MailComposer({
  intent,
  threadId,
  draftKey,
  channelAccountId: boundChannelAccountId,
  defaultFromAddress,
  recipientSuggestions,
  initialBody,
  preferSeedBody = false,
  restoreDraft = true,
  variant = 'thread',
  fill = false,
  saving,
  onSend,
  onCancel,
}: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token, user } = useAuth()

  // Unsent draft under this key: the body (and attachments) always come
  // back; recipients and subject only when the draft targets the same mail
  // and mode, otherwise the fresh intent wins. For a new mail an explicit
  // deeplinked recipient or subject beats the stored draft.
  const [restoredDraft] = useState<StoredMailDraft | null>(() =>
    restoreDraft ? readStoredMailDraft(draftKey) : null,
  )
  const restoredMatchesIntent =
    restoredDraft != null &&
    restoredDraft.mode === intent.mode &&
    restoredDraft.sourceMessageId === intent.sourceMessageId

  const [body, setBody] = useState(() => {
    if (preferSeedBody && (initialBody ?? '').trim()) return initialBody as string
    return restoredDraft?.body || initialBody || ''
  })
  const [to, setTo] = useState(() => {
    if (!restoredMatchesIntent) return intent.to
    if (intent.mode === 'new' && intent.to) return intent.to
    return restoredDraft.to
  })
  const [cc, setCc] = useState(() => (restoredMatchesIntent ? restoredDraft.cc : intent.cc))
  const [bcc, setBcc] = useState(() => restoredDraft?.bcc ?? '')
  const [subject, setSubject] = useState(() => {
    if (!restoredMatchesIntent) return intent.subject
    if (intent.mode === 'new' && intent.subject) return intent.subject
    return restoredDraft.subject
  })
  const [ccBccOpen, setCcBccOpen] = useState(() =>
    Boolean(intent.cc || restoredDraft?.cc || restoredDraft?.bcc),
  )
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [attachments, setAttachments] = useState<MessageAttachment[]>(() => {
    // A draft for this same mail keeps whatever the operator already attached
    // or removed. A fresh forward starts with the source mail's files.
    if (restoredMatchesIntent && restoredDraft) return restoredDraft.attachments
    return intent.attachments ?? []
  })
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  // Thread variant mounts collapsed at composer height, then grows — the
  // standard composer visually transforms into the mail surface. The page
  // variant renders at full height right away.
  const [expanded, setExpanded] = useState(variant === 'page' || fill)
  const [fullscreen, setFullscreen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toFieldRef = useRef<HTMLInputElement>(null)
  const ccFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setExpanded(true))
    const focus = window.setTimeout(() => {
      // Forward and a blank new mail start in the To field; replies start writing.
      if ((intent.mode === 'forward' || intent.mode === 'new') && !to.trim()) {
        toFieldRef.current?.focus()
      } else {
        textareaRef.current?.focus()
      }
    }, 320)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(focus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  // A new intent (other bubble / other mode / picked teammate) re-seeds the
  // fields but keeps an already-typed body so switching Reply → Reply all
  // does not lose text. A new mail has no source message, so the recipient
  // is part of the key (teammate chips swap it).
  const intentKey =
    intent.mode === 'new'
      ? `new:${intent.to}:${intent.subject}`
      : `${intent.mode}:${intent.sourceMessageId}`
  const prevIntentKeyRef = useRef(intentKey)
  useEffect(() => {
    if (prevIntentKeyRef.current === intentKey) return
    const previous = prevIntentKeyRef.current
    const previousSource = previous.slice(previous.indexOf(':') + 1)
    prevIntentKeyRef.current = intentKey
    setTo(intent.to)
    setCc(intent.cc)
    setSubject(intent.subject)
    setCcBccOpen((open) => open || Boolean(intent.cc))
    // Same letter: keep files the operator added, and pick up forward files.
    // A different letter starts from that letter's files.
    setAttachments((current) => {
      const seeded = intent.attachments ?? []
      const sameNewMail = previous.startsWith('new:') && intentKey.startsWith('new:')
      if (sameNewMail || previousSource === intent.sourceMessageId) {
        if (!seeded.length) return current
        const seen = new Set(current.map((att) => att.id))
        return [...current, ...seeded.filter((att) => !seen.has(att.id))]
      }
      return seeded
    })
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
            (row.kind === 'email_mailbox' || row.kind === 'email_relay') &&
            // Match API `account_can_send` / ReplyComposer: capability alone
            // is not enough (relay in setup still advertises send).
            channelCanSend(row),
        )
        setEmailChannels(mailboxes)
        setSelectedChannelAccountId((prev) => {
          if (prev && mailboxes.some((row) => row.id === prev)) return prev
          if (boundChannelAccountId && mailboxes.some((row) => row.id === boundChannelAccountId)) {
            return boundChannelAccountId
          }
          if (defaultFromAddress) {
            const match = mailboxes.find(
              (row) => row.address.trim().toLowerCase() === defaultFromAddress.trim().toLowerCase(),
            )
            if (match) return match.id
          }
          const lastUsed = readLastMailboxChannelAccountId()
          if (lastUsed && mailboxes.some((row) => row.id === lastUsed)) return lastUsed
          return mailboxes[0]?.id ?? null
        })
      })
      .catch(() => {
        if (!cancelled) setEmailChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [token, boundChannelAccountId, defaultFromAddress])
  const selectedMailbox = useMemo(
    () => emailChannels.find((row) => row.id === selectedChannelAccountId) ?? null,
    [emailChannels, selectedChannelAccountId],
  )

  // Contact typeahead on To/CC/BCC. Threads do not pass suggestions along,
  // so the composer fetches the tenant's mailable contacts itself (forwards
  // need a To field with completion just as much as a new mail).
  const [fetchedSuggestions, setFetchedSuggestions] = useState<MailRecipientSuggestion[]>([])
  useEffect(() => {
    if (recipientSuggestions || !token) return
    let cancelled = false
    void listContacts(token)
      .then((rows) => {
        if (cancelled) return
        setFetchedSuggestions(
          rows
            .filter((contact) => canComposeToAddress(contact.channel, contact.address))
            .map((contact) => ({
              label:
                humanizeContactName(
                  contact.displayName,
                  contact.address,
                  t('contactPanel.widgetVisitor'),
                ) || contact.address,
              address: contact.address,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) setFetchedSuggestions([])
      })
    return () => {
      cancelled = true
    }
  }, [recipientSuggestions, token, t])
  const suggestionPool = recipientSuggestions ?? fetchedSuggestions
  // Already-picked addresses (any field) are never suggested again.
  const chosenAddresses = useMemo(
    () =>
      new Set([...parseAddressList(to), ...parseAddressList(cc), ...parseAddressList(bcc)]),
    [to, cc, bcc],
  )

  // Entries that will not reach anyone: block the send and say which ones,
  // instead of a silently disabled button. The entry still being typed in
  // the focused field stays out of the hint until it is completed.
  const [focusedField, setFocusedField] = useState<'to' | 'cc' | 'bcc' | null>(null)
  const invalidAddresses = useMemo(
    () => [
      ...invalidRecipientTokens(to),
      ...invalidRecipientTokens(cc),
      ...invalidRecipientTokens(bcc),
    ],
    [to, cc, bcc],
  )
  const invalidShown = useMemo(
    () => [
      ...invalidRecipientTokens(to, { skipTrailing: focusedField === 'to' }),
      ...invalidRecipientTokens(cc, { skipTrailing: focusedField === 'cc' }),
      ...invalidRecipientTokens(bcc, { skipTrailing: focusedField === 'bcc' }),
    ],
    [to, cc, bcc, focusedField],
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
      writeStoredMailDraft(draftKey, draftRef.current)
      setDraftSaved(mailDraftHasContent(draftRef.current))
    }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot lives in draftRef
  }, [draftKey, body, to, cc, bcc, subject, attachments, selectedChannelAccountId, intentKey])

  useEffect(() => {
    return () => {
      if (suppressPersistRef.current || !draftRef.current) return
      writeStoredMailDraft(draftKey, draftRef.current)
    }
  }, [draftKey])

  // Signature preview matches server resolve for the selected From mailbox.
  const [mailboxSignatureHtml, setMailboxSignatureHtml] = useState('')
  const [signatureSource, setSignatureSource] = useState<SignatureSource>('mailbox')
  const [connectionIdByChannel, setConnectionIdByChannel] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void listEmailConnections(token)
      .then((rows) => {
        if (cancelled) return
        const map: Record<string, number> = {}
        for (const row of rows) {
          if (row.uuid) map[row.uuid] = row.id
        }
        setConnectionIdByChannel(map)
      })
      .catch(() => {
        if (!cancelled) setConnectionIdByChannel({})
      })
    return () => {
      cancelled = true
    }
  }, [token])
  useEffect(() => {
    if (!token || !selectedChannelAccountId) {
      setMailboxSignatureHtml('')
      setSignatureSource('mailbox')
      return
    }
    const connectionId = connectionIdByChannel[selectedChannelAccountId]
    if (connectionId == null) return
    let cancelled = false
    void getConnectionSignature(token, connectionId)
      .then((cfg) => {
        if (cancelled) return
        setMailboxSignatureHtml(cfg.signatureHtml)
        setSignatureSource(cfg.signatureSource)
      })
      .catch(() => {
        if (!cancelled) {
          setMailboxSignatureHtml('')
          setSignatureSource('mailbox')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, selectedChannelAccountId, connectionIdByChannel])
  const signatureIdentity = useMemo<SignatureIdentityVars>(
    () => ({
      name: user?.name || user?.email || '',
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email ?? null,
      jobTitle: user?.jobTitle ?? null,
      company: user?.tenant?.name ?? null,
      avatarUrl: user?.avatarUrl || user?.signatureUrl || null,
      language: i18n.language,
    }),
    [user?.name, user?.firstName, user?.lastName, user?.email, user?.jobTitle, user?.tenant?.name, user?.avatarUrl, user?.signatureUrl, i18n.language],
  )
  const signatureHtml = useMemo(
    () =>
      previewOutboundSignatureHtml({
        source: signatureSource,
        mailboxHtml: mailboxSignatureHtml,
        personalHtml: user?.emailSignatureHtml,
        identity: signatureIdentity,
      }),
    [signatureSource, mailboxSignatureHtml, user?.emailSignatureHtml, signatureIdentity],
  )
  const signatureSettingsHref = selectedChannelAccountId
    ? `/settings/channels/${selectedChannelAccountId}?edit=signature`
    : '/settings/channels'

  /** Grow with the letter so body + signature share one scroll (no nested textarea bar). */
  const fitBodyHeight = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.max(el.scrollHeight, 112)}px`
  }

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

  useEffect(() => {
    fitBodyHeight()
  }, [composerValue, expanded])

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
  const canSend =
    validTo &&
    invalidAddresses.length === 0 &&
    (Boolean(body.trim() || dictationInterim.trim()) || attachments.length > 0)
  const busy = saving || sending

  const handleSend = async () => {
    if (!canSend || busy) return
    const pending = dictation.listening ? dictationInterimRef.current.trim() : ''
    if (dictation.listening) dictation.stop()
    const text = (pending ? appendSpeechChunk(body, pending) : body).trim()
    if (pending) setBody(text)
    setDictationInterim('')
    setSending(true)
    // Clear the stored draft up front so the unmount flush after a
    // successful send cannot write the sent text back as a leftover draft.
    suppressPersistRef.current = true
    clearStoredMailDraft(draftKey)
    try {
      if (selectedChannelAccountId) writeLastMailboxChannelAccountId(selectedChannelAccountId)
      await onSend({
        bodyText: text,
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim() || undefined,
        attachments: attachments.length ? attachments : undefined,
        channelAccountId: selectedChannelAccountId || undefined,
        fromAddress: selectedMailbox?.address || undefined,
        mode: intent.mode,
        sourceMessageId: intent.sourceMessageId,
        quotedHtml: intent.quotedHtml || undefined,
      })
    } catch (err) {
      // The mail did not go out: keep the draft.
      suppressPersistRef.current = false
      if (draftRef.current) writeStoredMailDraft(draftKey, draftRef.current)
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
      e.stopPropagation()
      if (fullscreen) {
        setFullscreen(false)
        return
      }
      onCancel()
    }
  }

  // A "reply" without a source mail (mailbox tab on an outbound-only thread)
  // is really a fresh mail into the thread; title it that way.
  const effectiveMode: MailComposerMode =
    intent.mode === 'reply' && !intent.sourceMessageId ? 'new' : intent.mode
  const ModeIcon = MODE_META[effectiveMode].icon
  const modeLabel = t(MODE_META[effectiveMode].labelKey)

  const onPasteFiles = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!token) return
    const images: File[] = []
    const items = e.clipboardData?.items
    if (items?.length) {
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file && file.size > 0) images.push(file)
        }
      }
    }
    if (!images.length && e.clipboardData?.files?.length) {
      for (const file of Array.from(e.clipboardData.files)) {
        if (file.type.startsWith('image/') && file.size > 0) images.push(file)
      }
    }
    if (!images.length) return
    e.preventDefault()
    const named = images.map((file, index) => {
      const type = file.type || 'image/png'
      const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      const generic = !file.name || file.name === 'image.png' || file.name === 'blob'
      if (!generic) return file
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      return new File([file], `pasted-${stamp}${images.length > 1 ? `-${index + 1}` : ''}.${ext}`, {
        type,
      })
    })
    void onPickFiles(named)
  }

  const onDropFiles = (e: React.DragEvent) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault()
    void onPickFiles(e.dataTransfer.files)
  }

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4'
          : fill
            ? 'relative flex min-h-0 flex-1 flex-col'
            : variant === 'thread'
              ? 'relative shrink-0 bg-bg px-4 pb-4 pt-1'
              : undefined
      }
      onMouseDown={
        fullscreen
          ? (event) => {
              if (event.target === event.currentTarget) setFullscreen(false)
            }
          : undefined
      }
    >
      {variant === 'thread' && !fullscreen && !fill ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-full z-10 h-12 bg-gradient-to-t from-bg from-20% to-transparent"
        />
      ) : null}
      <div
        className={cn(
          !fullscreen && !fill && variant === 'thread' && CHAT_COLUMN_CLASS,
          'overflow-hidden transition-[height] duration-300 ease-out',
          fill && !fullscreen && 'min-h-0 flex-1',
          fullscreen && 'w-full max-w-3xl',
        )}
        style={
          fullscreen
            ? { height: 'min(92vh, 900px)' }
            : fill
              ? { height: '100%' }
              : { height: expanded ? 'min(62vh, 640px)' : '148px' }
        }
        onKeyDown={onKeyDown}
        onDragOver={(event) => {
          if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
        }}
        onDrop={onDropFiles}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-bg-surface shadow-sm">
          {/* Header: mode + From + close */}
          <div className="flex items-center gap-2 border-b border-border bg-bg-elevated/60 px-3 py-2">
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
                    <ChevronDown size={14} className="shrink-0 opacity-70" />
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
                        onSelect={() => {
                          setSelectedChannelAccountId(row.id)
                          writeLastMailboxChannelAccountId(row.id)
                        }}
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
                        {active ? <Check size={14} className="shrink-0 text-accent" /> : null}
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
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              onClick={() => setFullscreen((open) => !open)}
              title={fullscreen ? t('mailComposer.exitFullscreen') : t('mailComposer.fullscreen')}
              aria-label={fullscreen ? t('mailComposer.exitFullscreen') : t('mailComposer.fullscreen')}
              aria-pressed={fullscreen}
              className="ml-auto text-text-muted"
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
            <button
              type="button"
              onClick={onCancel}
              title={t('compose.cancel')}
              aria-label={t('compose.cancel')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <XIcon size={14} />
            </button>
          </div>

          {/* Recipients + subject */}
          <RecipientField
            label={t('compose.to')}
            value={to}
            onChange={setTo}
            placeholder={t('compose.toPlaceholder')}
            suggestions={suggestionPool}
            exclude={chosenAddresses}
            inputRef={toFieldRef}
            testId="mail-composer-to"
            onFocusChange={(focused) => setFocusedField(focused ? 'to' : null)}
            trailing={
              <button
                type="button"
                onClick={() => {
                  const next = !ccBccOpen
                  setCcBccOpen(next)
                  if (next) requestAnimationFrame(() => ccFieldRef.current?.focus())
                }}
                className={cn(
                  'shrink-0 text-2xs font-medium transition-colors',
                  ccBccOpen || cc || bcc ? 'text-accent' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {t('composer.ccBcc')}
              </button>
            }
          />
          {ccBccOpen ? (
            <>
              <RecipientField
                label={t('compose.cc')}
                value={cc}
                onChange={setCc}
                placeholder={t('compose.ccPlaceholder')}
                suggestions={suggestionPool}
                exclude={chosenAddresses}
                inputRef={ccFieldRef}
                onFocusChange={(focused) => setFocusedField(focused ? 'cc' : null)}
              />
              <RecipientField
                label={t('compose.bcc')}
                value={bcc}
                onChange={setBcc}
                placeholder={t('compose.bccPlaceholder')}
                suggestions={suggestionPool}
                exclude={chosenAddresses}
                onFocusChange={(focused) => setFocusedField(focused ? 'bcc' : null)}
              />
            </>
          ) : null}
          {invalidShown.length ? (
            <p className="border-b border-border bg-status-error/5 px-3 py-1 text-2xs text-status-error">
              {t('compose.invalidAddress', { addresses: invalidShown.join(', ') })}
            </p>
          ) : null}
          <div className={FIELD_ROW}>
            <span className={FIELD_LABEL}>{t('compose.subject')}</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={FIELD_INPUT}
              data-testid="mail-composer-subject"
            />
          </div>

          {/* One letter scroll: body grows with text; signature + quote ride below. */}
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {dictation.listening ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-5 text-text-primary"
              >
                {body}
                {dictationInterim.trim() ? (
                  <span className="text-text-muted">{body.trim() ? ` ${dictationInterim}` : dictationInterim}</span>
                ) : null}
                {'\n'}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={composerValue}
              readOnly={dictation.listening}
              onChange={(e) => {
                if (!dictation.listening) setBody(e.target.value)
              }}
              onPaste={onPasteFiles}
              onInput={fitBodyHeight}
              placeholder={
                dictation.listening ? t('composer.dictationListening') : t('compose.bodyPlaceholder')
              }
              rows={4}
              className={
                dictation.listening
                  ? 'relative block w-full resize-none overflow-hidden bg-transparent px-3 py-2.5 text-sm leading-5 text-transparent caret-[rgb(var(--color-text-primary))] placeholder:text-text-muted focus:outline-none'
                  : 'block w-full resize-none overflow-hidden bg-transparent px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none'
              }
              data-testid="mail-composer-body"
            />
            <div className="px-3">
              <MessageAttachments
                attachments={attachments}
                placement="composer"
                pending={uploading}
                onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
              />
            </div>

            {signatureHtml ? (
              <div className="px-3 pb-2 pt-0.5">
                <div
                  className="group/sig relative rounded-md px-2 py-1.5 -mx-0.5 transition-colors hover:bg-bg-hover/80 focus-within:bg-bg-hover/80"
                  data-testid="mail-composer-signature"
                >
                  <Link
                    to={signatureSettingsHref}
                    className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-md border border-border bg-bg-surface px-1.5 py-0.5 text-2xs font-medium text-text-secondary opacity-0 shadow-sm transition-opacity hover:bg-bg-elevated hover:text-text-heading focus-visible:opacity-100 group-hover/sig:opacity-100"
                    title={t('mailComposer.signatureEditChannelHint')}
                    aria-label={t('mailComposer.signatureEditChannel')}
                  >
                    <PenLine size={14} className="shrink-0" aria-hidden />
                    {t('mailComposer.signatureEdit')}
                  </Link>
                  <div
                    className="signature-preview pointer-events-none text-sm [&_img]:inline-block [&_img]:max-w-full"
                    dangerouslySetInnerHTML={{ __html: signatureHtml }}
                  />
                </div>
              </div>
            ) : null}

            {intent.quotedHtml ? (
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={() => setQuoteOpen((open) => !open)}
                  title={t('mailComposer.quoteToggle')}
                  aria-label={t('mailComposer.quoteToggle')}
                  aria-expanded={quoteOpen}
                  className="flex h-5 items-center rounded-full border border-border bg-bg-elevated px-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                  data-testid="mail-composer-quote-toggle"
                >
                  <MoreHorizontal size={14} />
                </button>
                {quoteOpen ? (
                  <QuotedMailFrame html={intent.quotedHtml} title={t('mailComposer.quoteTitle')} />
                ) : intent.quotedPreview ? (
                  <p className="mt-1 truncate text-2xs text-text-muted">{intent.quotedPreview}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Footer: Bokito extras + send */}
          <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="pointer-events-none absolute h-0 w-0 opacity-0"
              onChange={(e) => void onPickFiles(e.target.files)}
            />
            {threadId ? (
              <ComposerWriteAssist
                threadId={threadId}
                body={body}
                disabled={busy}
                onApply={(text) => {
                  setBody(text)
                  requestAnimationFrame(() => textareaRef.current?.focus())
                }}
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
              <ComposerDictationRow
                supported={dictation.supported}
                listening={dictation.listening}
                disabled={busy}
                onStart={() => dictation.start()}
                onConfirm={confirmDictation}
              >
              <div className="flex h-8 items-stretch overflow-hidden rounded-lg">
                <button
                  type="button"
                  disabled={!canSend || busy || uploading}
                  onClick={() => void handleSend()}
                  title={`${t('composer.sendTitle')} — ${t('composer.hintEmail')}`}
                  className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
                  data-testid="mail-composer-send"
                >
                  <Send size={14} />
                  <span className="text-xs font-medium">
                    {sending ? t('compose.sending') : t('compose.send')}
                  </span>
                </button>
              </div>
              </ComposerDictationRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
