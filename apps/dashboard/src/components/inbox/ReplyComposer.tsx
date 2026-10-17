import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Paperclip,
  Phone,
  PhoneOff,
  Quote,
  Send,
  Square,
  StickyNote,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Callout } from '../ui/callout'
import { ComposerCard } from '../ui/ComposerCard'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { AiMark } from '../ai/AiMark'
import { AvatarStack } from '../ui/AvatarStack'
import { AgentMark } from '../ui/AgentMark'
import type { AgentAvatarSource } from '../../lib/agent-avatar'
import { UserAvatar } from '../ui/UserAvatar'
import { getContact, getContactThreadPage } from '../../lib/contacts-api'
import { inboxPath } from '../../lib/messages-paths'
import { buildReplyDestinations, type ReplyDestination } from '../../lib/reply-destinations'
import {
  focusFromTargets,
  focusLabelName,
  focusToAvatarStack,
  syncAgentMentionsInBody,
  syncFocusMentionsInBody,
  type ComposerFocusTarget,
  type ComposerReplyFocus,
} from '../../lib/composer-reply-focus'
import { useMembers } from '../../hooks/useMembers'
import { useSpeechDictation, appendSpeechChunk } from '../../hooks/useSpeechDictation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { effectiveComposerMode, type ComposerSurface, type ComposerMode } from '../../lib/message-composer'
import { CHAT_COLUMN_CLASS } from '../../lib/chat-layout'
import { cn } from '../../lib/utils'
import type { MessageAttachment, ThreadRoutingPolicy } from '../../lib/inbox-api'
import { setThreadComposing } from '../../lib/signals-api'
import { channelCanSend, listChannels } from '../../lib/channels-api'
import { readLastMailboxChannelAccountId, writeLastMailboxChannelAccountId } from '../../lib/last-mailbox'
import {
  activeMentionQuery,
  filterMentionItems,
  stripMentionMarkup,
  type MentionItem,
  type MentionQuery,
} from '../../lib/mentions'
import { applyDisplayEdit, applyMentionAtDisplay, displayFromRaw } from '../../lib/mention-editor'
import {
  composerDraftStorageKey,
  type ComposerDraftSlot,
  isStoredDraftStale,
  parseComposerDraft,
  serializeComposerDraft,
  type StoredComposerDraft,
} from '../../lib/inbox-ops'
import { draftThreadReply } from '../../lib/inbox-api'
import { plainTextToQuotedHtml } from '../../lib/mail-quote'
import { uploadAttachment } from '../../lib/uploads-api'
import { parseComposerVerb, composerVerbHelp } from '../../lib/composer-verbs'
import ComposerWriteAssist from './ComposerWriteAssist'
import { DictationMicButton } from './DictationMicButton'
import MentionPopover, { MentionsPickerPanel } from './MentionPopover'
import { MentionHighlight } from './MentionHighlight'
import MessageAttachments from './MessageAttachments'

export type { ComposerMode }

type Props = {
  surface: ComposerSurface
  onReply: (
    bodyText: string,
    action: 'send' | 'send_and_close' | 'send_and_pending',
    attachments?: MessageAttachment[],
    snoozeMinutes?: number,
    extras?: {
      cc?: string
      bcc?: string
      channelAccountId?: string
      to?: string
      handback?: boolean
      keepOpen?: boolean
      quotedHtml?: string
    },
  ) => Promise<void>
  onNote: (
    bodyText: string,
    attachments?: MessageAttachment[],
    opts?: { asChat?: boolean },
  ) => Promise<void>
  /** Channel routing policy; drives the default send label and the ask split. */
  routingPolicy?: ThreadRoutingPolicy | null
  /** Personal preference: email Send closes the conversation. */
  closeEmailOnSend?: boolean
  /**
   * True when the policy is "ask" and the agent could take the next turn:
   * the send menu offers "hand back to agent" and "keep with me".
   */
  handbackChoice?: boolean
  /** Send into the active agent meta session (no customer delivery). */
  /** Resolve `false` when nothing was sent, so the text goes back into the editor. */
  onAgentMessage?: (
    bodyText: string,
    attachments?: MessageAttachment[],
  ) => Promise<boolean | void>
  /** Abort the in-flight agent stream (Stop). */
  onStopAgent?: () => void
  /** True while an agent reply is streaming — blocks Send/Enter. */
  agentStreaming?: boolean
  saving: boolean
  disabled?: boolean
  extraActions?: ReactNode
  /** Prefill reply body (e.g. from AI suggestion Edit). */
  draftBody?: string | null
  draftKey?: string | null
  /** Extra @-mentionable items besides workspace members (e.g. agents). */
  mentionExtras?: MentionItem[]
  /** Called when a mention is inserted; raw body includes the new chip. */
  onMentionInserted?: (item: MentionItem, rawBody: string) => void
  /** Controlled mode from the thread (ask sticky while an AI turn is active). */
  mode?: ComposerMode
  onModeChange?: (mode: ComposerMode) => void
  /** Slash verbs (/assign, /ticket, …). Return true when handled. */
  onVerb?: (verb: import('../../lib/composer-verbs').ParsedComposerVerb) => Promise<boolean> | boolean
  /** Active AI label for the Ask chip. */
  agentModeName?: string | null
  /** Agent face for the Ask chip when Reply is selected and focus targets are empty. */
  askAgent?: AgentAvatarSource | null
  /** Who Ask/Note is addressing (facepile + quick @ set). */
  replyFocus?: ComposerReplyFocus | null
  /** Manual overwrite of Ask/Note recipients from the tab chevron. */
  onReplyFocusChange?: (focus: ComposerReplyFocus) => void
  /** Ask tab click; raw body so parent can sync focus from chips. */
  onAskTabFocus?: (rawBody: string) => void
  /** Stable id (thread id) to persist unsent drafts across thread switches. */
  persistKey?: string | null
  /** When set, outbound replies are blocked (e.g. mailbox disconnected) and
   * this notice is rendered in place of the reply input. Notes still work. */
  replyDisabledNotice?: ReactNode
  /** CC list of the customer's last email; seeds the CC field when the
   * operator opens CC/BCC so reply-all is one click, never auto-applied. */
  suggestedCc?: string | null
  /** Last inbound customer text; Quote inserts it as a cited block. */
  lastInboundText?: string | null
  /** Bound mailbox UUID for email threads (default From). */
  channelAccountId?: string | null
  /** Contact whose other addresses and numbers can switch the reply channel. */
  contactId?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerName?: string | null
  /** Open AI reply proposal loaded into the composer. Discarding the draft rejects it. */
  proposal?: {
    decisionMessageId: string
    /** Inbound message the proposal answers (server anchor). */
    basedOnMessageId?: string | null
    onDismiss: () => void | Promise<void>
  } | null
  /** Newest inbound customer message; anchors drafts so a later message flags them. */
  latestInboundMessageId?: string | null
  /** Whether a suggestion card is still open; undefined when the card is not loaded. */
  isProposalOpen?: (decisionMessageId: string) => boolean | undefined
  /** Opens "Already handled outside Bokito" (send menu, customer threads only). */
  onHandledExternally?: () => void
  /**
   * Email reply with text already in the small composer: focusing that text
   * opens the mail client with the same body. Notes and Ask stay here.
   */
  onPromoteEmailEdit?: (body: string) => void | boolean
}

function draftSlot(mode: ComposerMode): ComposerDraftSlot {
  if (mode === 'note') return 'note'
  if (mode === 'ask') return 'ask'
  return 'reply'
}

function readStoredDraft(
  persistKey: string | null | undefined,
  slot?: ComposerDraftSlot,
): string {
  if (!persistKey || typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(composerDraftStorageKey(persistKey, slot)) ?? ''
  } catch {
    return ''
  }
}

function writeStoredDraft(
  persistKey: string | null | undefined,
  value: string,
  slot?: ComposerDraftSlot,
) {
  if (!persistKey || typeof window === 'undefined') return
  try {
    const key = composerDraftStorageKey(persistKey, slot)
    if (value.trim()) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Quota/private mode failures just mean the draft is not persisted.
  }
}

function DestinationGlyph({ channel }: { channel: string }) {
  if (channel === 'phone') {
    return <Phone size={12} className="shrink-0 text-text-muted" aria-hidden />
  }
  return <ChannelGlyph channel={channel} size={12} />
}

export default function ReplyComposer({
  surface,
  onReply,
  onNote,
  onAgentMessage,
  onStopAgent,
  agentStreaming = false,
  saving,
  disabled,
  extraActions,
  draftBody,
  draftKey,
  mentionExtras,
  onMentionInserted,
  mode: modeProp,
  onModeChange,
  onVerb,
  agentModeName,
  askAgent = null,
  replyFocus = null,
  onReplyFocusChange,
  onAskTabFocus,
  persistKey,
  replyDisabledNotice,
  suggestedCc,
  lastInboundText,
  channelAccountId: boundChannelAccountId,
  contactId = null,
  customerEmail = null,
  customerPhone = null,
  customerName = null,
  proposal = null,
  latestInboundMessageId = null,
  isProposalOpen,
  onHandledExternally,
  onPromoteEmailEdit,
  routingPolicy = null,
  handbackChoice = false,
  closeEmailOnSend = false,
}: Props) {
  const { t } = useTranslation('communication')
  const navigate = useNavigate()
  const { token } = useAuth()
  const [selectedChannelAccountId, setSelectedChannelAccountId] = useState<string | null>(
    boundChannelAccountId ?? null,
  )
  const [uncontrolledMode, setUncontrolledMode] = useState<ComposerMode>(surface.defaultMode)
  const [dictationInterim, setDictationInterim] = useState('')
  const mode = effectiveComposerMode(surface, modeProp ?? uncontrolledMode)
  const setMode = (next: ComposerMode) => {
    if (next === 'reply' && mode !== 'reply') {
      // Structured mentions become plain @Name when returning to customer reply.
      setBody((prev) => stripMentionMarkup(prev))
    }
    onModeChange?.(next)
    if (modeProp === undefined) {
      setUncontrolledMode(next)
    }
  }
  // `body` keeps the raw mention markup (storage/API format); the textarea
  // shows `displayBody` where mentions read as `@Name` pills.
  const [body, setBody] = useState('')
  const [quoteIncluded, setQuoteIncluded] = useState(false)
  const displayBody = useMemo(() => displayFromRaw(body), [body])
  // Caret to restore after an edit rewrote the display text (atomic mention
  // deletion or mention insertion make our text differ from the browser's).
  const pendingCaretRef = useRef<number | null>(null)
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  // Email-only extra recipients; hidden behind a CC/BCC toggle.
  const [ccBccOpen, setCcBccOpen] = useState(false)
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [draftRestored, setDraftRestored] = useState(false)
  // Restored draft that no longer answers the latest message (customer wrote
  // again, or its proposal card was resolved/set aside).
  const [draftStale, setDraftStale] = useState(false)
  const [redrafting, setRedrafting] = useState(false)
  // An AI proposal dropped into the composer is not the operator's draft
  // until they touch it: untouched prefills are never written to storage, so
  // a rejected or superseded proposal cannot resurface as "Draft restored".
  const untouchedPrefillRef = useRef<string | null>(null)
  const [aiFlashNonce, setAiFlashNonce] = useState(0)
  const flashAiDraft = () => setAiFlashNonce((n) => n + 1)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // @mention autocomplete state
  const { members } = useMembers()
  // Extras win over workspace members with the same key (they carry access per conversation).
  const mentionItems: MentionItem[] = useMemo(() => {
    const byKey = new Map<string, MentionItem>()
    for (const m of members) {
      byKey.set(`user-${m.id}`, {
        type: 'user',
        id: String(m.id),
        name: m.name,
        email: m.email,
        avatarUrl: m.avatarUrl,
        presence: m.presence,
      })
    }
    for (const item of mentionExtras ?? []) byKey.set(`${item.type}-${item.id}`, item)
    return [...byKey.values()]
  }, [members, mentionExtras])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionMatches = useMemo(
    () => (mentionQuery ? filterMentionItems(mentionItems, mentionQuery.query) : []),
    [mentionItems, mentionQuery],
  )
  const mentionOpen = mentionQuery !== null && mentionMatches.length > 0

  useEffect(() => {
    setSelectedChannelAccountId(boundChannelAccountId ?? null)
  }, [boundChannelAccountId])

  useEffect(() => {
    if (!token || surface.channel !== 'email') return
    let cancelled = false
    void listChannels(token)
      .then((rows) => {
        if (cancelled) return
        const mailboxes = rows.filter(
          (row) =>
            row.channel === 'email' &&
            row.isEnabled &&
            (row.kind === 'email_mailbox' || row.kind === 'email_relay') &&
            // Match API `account_can_send`: capability alone is not enough
            // (Bokito Support can advertise send while still in setup).
            channelCanSend(row),
        )
        setSelectedChannelAccountId((prev) => {
          if (prev && mailboxes.some((row) => row.id === prev)) return prev
          if (boundChannelAccountId && mailboxes.some((row) => row.id === boundChannelAccountId)) {
            return boundChannelAccountId
          }
          const lastUsed = readLastMailboxChannelAccountId()
          if (lastUsed && mailboxes.some((row) => row.id === lastUsed)) return lastUsed
          return mailboxes[0]?.id ?? null
        })
      })
      .catch(() => {
        if (!cancelled) setSelectedChannelAccountId(boundChannelAccountId ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [token, surface.channel, boundChannelAccountId])

  const [reachContact, setReachContact] = useState<Awaited<ReturnType<typeof getContact>>>(null)
  const [siblingThreads, setSiblingThreads] = useState<Awaited<ReturnType<typeof getContactThreadPage>>['threads']>([])
  const [toOverride, setToOverride] = useState<string | null>(null)
  useEffect(() => {
    setToOverride(null)
  }, [persistKey])
  useEffect(() => {
    if (!token || !contactId || surface.channel === 'internal' || surface.channel === 'assistant') {
      setReachContact(null)
      setSiblingThreads([])
      return
    }
    let cancelled = false
    void Promise.all([
      getContact(token, contactId).catch(() => null),
      getContactThreadPage(token, contactId).catch(() => ({ threads: [], total: 0 })),
    ]).then(([contact, page]) => {
      if (cancelled) return
      setReachContact(contact)
      setSiblingThreads(page.threads)
    })
    return () => {
      cancelled = true
    }
  }, [token, contactId, surface.channel])
  const replyDestinations = useMemo(
    () =>
      buildReplyDestinations({
        threadId: persistKey || 'current',
        channel: surface.channel,
        email: customerEmail,
        phone: customerPhone,
        name: customerName || surface.replyTargetName,
        identities: reachContact?.identities,
        contactPhone: reachContact?.phone,
        contactAddress: reachContact?.address,
        contactChannel: reachContact?.channel,
        threads: siblingThreads,
        fallback: t(`composer.channel.${surface.channel === 'chat' ? 'widget' : surface.channel}`, {
          defaultValue: surface.replyLabel,
        }),
      }),
    [
      persistKey,
      surface.channel,
      surface.replyTargetName,
      surface.replyLabel,
      customerEmail,
      customerPhone,
      customerName,
      reachContact,
      siblingThreads,
      t,
    ],
  )
  const activeDestination =
    replyDestinations.find((row) => toOverride && row.to === toOverride) ?? replyDestinations[0]
  const canPickDestination = replyDestinations.length > 1
  const replyTabLabel = activeDestination?.label || t('composer.tabReply')
  const replyTooltip = activeDestination?.label
    ? `${t('composer.sendToCustomer')} · ${activeDestination.label}`
    : t('composer.tabHintReply')
  const pickDestination = (row: ReplyDestination) => {
    if (row.threadId && persistKey && row.threadId !== persistKey) {
      navigate(inboxPath('open', row.threadId))
      return
    }
    if (row.to) {
      setToOverride(row.to)
      setMode('reply')
      return
    }
    setToOverride(null)
    setMode('reply')
    if (!row.threadId) toast.message(t('composer.noConversationOnChannel'))
  }
  const askTooltip = t('composer.tabHintAsk')

  const refreshMentionState = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret)
    setMentionQuery(next)
    if (next?.query !== mentionQuery?.query) setMentionIndex(0)
  }

  const selectMention = (item: MentionItem) => {
    if (!mentionQuery || item.disabled) return
    const caret = textareaRef.current?.selectionStart ?? displayBody.length
    const applied = applyMentionAtDisplay(body, caret, mentionQuery, item)
    setBody(applied.raw)
    pendingCaretRef.current = applied.displayCaret
    setMentionQuery(null)
    setMentionIndex(0)
    untouchedPrefillRef.current = null
    writeStoredDraft(persistKey, serializeComposerDraft(storedDraftOf({ body: applied.raw, cc, bcc })))
    // Selecting a mention is intentional: people/teams go to a note; agents
    // switch the composer to Ask without opening a meta conversation yet.
    if (mode === 'reply') setMode(item.type === 'agent' ? 'ask' : 'note')
    onMentionInserted?.(item, applied.raw)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // Restore the caret after renders where we rewrote the display text.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    if (caret == null) return
    pendingCaretRef.current = null
    textareaRef.current?.setSelectionRange(caret, caret)
  }, [displayBody])

  const replyBlocked = replyDisabledNotice != null

  useEffect(() => {
    if (modeProp === undefined) {
      setUncontrolledMode(surface.defaultMode)
    }
  }, [modeProp, surface.defaultMode])

  // Anchor every stored draft to the proposal and the inbound message it
  // answers, so a restore can tell whether it is still current.
  const anchorRef = useRef({ proposal, latestInboundMessageId })
  anchorRef.current = { proposal, latestInboundMessageId }
  const restoredDraftRef = useRef<StoredComposerDraft | null>(null)
  const storedDraftOf = (draft: { body: string; cc: string; bcc: string }): StoredComposerDraft => {
    const out: StoredComposerDraft = { ...draft }
    // An untouched restored draft keeps the anchors it was written with, so
    // a write-back (flush, debounce) cannot silently make a stale draft look
    // current again.
    const restored = restoredDraftRef.current
    if (restored && restored.body === draft.body && (restored.decisionMessageId || restored.basedOnMessageId)) {
      if (restored.decisionMessageId) out.decisionMessageId = restored.decisionMessageId
      if (restored.basedOnMessageId) out.basedOnMessageId = restored.basedOnMessageId
      return out
    }
    const { proposal: current, latestInboundMessageId: latest } = anchorRef.current
    if (current?.decisionMessageId) out.decisionMessageId = current.decisionMessageId
    const anchor = current?.basedOnMessageId || latest
    if (anchor) out.basedOnMessageId = anchor
    return out
  }
  const isUntouchedPrefill = (value: string) =>
    untouchedPrefillRef.current != null && value === untouchedPrefillRef.current

  // Stale check of the restored draft: the card it came from is gone, or the
  // customer wrote again. Re-evaluated when the thread's newest message or
  // the open cards change (realtime).
  useEffect(() => {
    const restored = restoredDraftRef.current
    if (!restored || !draftRestored) {
      setDraftStale(false)
      return
    }
    setDraftStale(
      isStoredDraftStale(restored, {
        latestInboundMessageId: latestInboundMessageId ?? null,
        proposalOpen: isProposalOpen,
      }),
    )
  }, [draftRestored, latestInboundMessageId, isProposalOpen])

  // Latest draft values for the synchronous flush below.
  const draftRef = useRef({ body, cc, bcc })
  draftRef.current = { body, cc, bcc }

  const modeSlot = draftSlot(mode)
  const slotRef = useRef<{ key: string | null; slot: ComposerDraftSlot }>({
    key: null,
    slot: modeSlot,
  })

  useEffect(() => {
    // Reply, Ask, and Note each keep their own text. Switching tabs saves the
    // one you leave and loads the one you open. A legacy single-key draft is
    // adopted once into the tab that is open.
    const prev = slotRef.current
    const sameThread = prev.key != null && prev.key === persistKey
    if (sameThread && prev.slot !== modeSlot && persistKey) {
      if (!isUntouchedPrefill(draftRef.current.body)) {
        writeStoredDraft(
          persistKey,
          serializeComposerDraft(storedDraftOf(draftRef.current)),
          prev.slot,
        )
      }
    }
    slotRef.current = { key: persistKey ?? null, slot: modeSlot }
    if (!persistKey) return
    if (sameThread && prev.slot === modeSlot) return
    let raw = readStoredDraft(persistKey, modeSlot)
    if (!raw.trim()) {
      const legacy = readStoredDraft(persistKey)
      if (legacy.trim()) {
        raw = legacy
        writeStoredDraft(persistKey, '')
        writeStoredDraft(persistKey, legacy, modeSlot)
      }
    }
    const stored = parseComposerDraft(raw)
    untouchedPrefillRef.current = null
    restoredDraftRef.current = stored
    draftRef.current = { body: stored.body, cc: stored.cc, bcc: stored.bcc }
    setBody(stored.body)
    setQuoteIncluded(false)
    setCc(stored.cc)
    setBcc(stored.bcc)
    setCcBccOpen(Boolean(stored.cc || stored.bcc))
    setDraftRestored(Boolean(stored.body || stored.cc || stored.bcc))
    setAttachments([])
  }, [persistKey, modeSlot])

  // Persist the draft (debounced) so switching threads or reloading keeps it.
  useEffect(() => {
    if (!persistKey) return
    if (isUntouchedPrefill(body)) return
    const slot = modeSlot
    const timer = window.setTimeout(
      () => writeStoredDraft(persistKey, serializeComposerDraft(storedDraftOf({ body, cc, bcc })), slot),
      400,
    )
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchors are read from refs
  }, [persistKey, modeSlot, body, cc, bcc])

  // Flush the draft synchronously when leaving the thread or unmounting, so
  // the debounce above cannot drop the last keystrokes.
  useEffect(() => {
    if (!persistKey) return
    const slot = modeSlot
    return () => {
      if (isUntouchedPrefill(draftRef.current.body)) return
      writeStoredDraft(persistKey, serializeComposerDraft(storedDraftOf(draftRef.current)), slot)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchors are read from refs
  }, [persistKey, modeSlot])

  // Collision guard: while a person types a customer reply the server keeps
  // an autonomous agent at drafting. Refresh the lock every 45s of typing
  // and release it when the text is gone or the thread changes.
  const composingLockedRef = useRef(false)
  const composingSentAtRef = useRef(0)
  const isReplyTyping = mode === 'reply' && body.trim().length > 0
  useEffect(() => {
    if (!token || !persistKey || surface.channel === 'internal' || surface.channel === 'assistant') {
      return
    }
    const threadId = persistKey
    if (isReplyTyping) {
      const now = Date.now()
      if (!composingLockedRef.current || now - composingSentAtRef.current > 45_000) {
        composingLockedRef.current = true
        composingSentAtRef.current = now
        void setThreadComposing(token, threadId, true, 90).catch(() => {
          composingLockedRef.current = false
        })
      }
      return
    }
    if (composingLockedRef.current) {
      composingLockedRef.current = false
      void setThreadComposing(token, threadId, false).catch(() => undefined)
    }
  }, [token, persistKey, surface.channel, isReplyTyping, body])
  useEffect(() => {
    return () => {
      if (composingLockedRef.current && token && persistKey) {
        composingLockedRef.current = false
        void setThreadComposing(token, persistKey, false).catch(() => undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- release on thread switch/unmount only
  }, [persistKey])

  const clearDraft = () => {
    // Update the flush ref now: an unmount before the next render would
    // otherwise write the sent text back and restore it on the next open.
    draftRef.current = { body: '', cc: '', bcc: '' }
    setBody('')
    setQuoteIncluded(false)
    setCc('')
    setBcc('')
    setCcBccOpen(false)
    setDraftRestored(false)
    setDraftStale(false)
    restoredDraftRef.current = null
    untouchedPrefillRef.current = null
    writeStoredDraft(persistKey, '')
  }

  // Stale draft: ask the agent for a fresh proposal on the current thread.
  const redraft = async () => {
    if (!token || !persistKey || redrafting) return
    setRedrafting(true)
    try {
      const fresh = await draftThreadReply(token, persistKey)
      if (!fresh.trim()) {
        toast.error(t('composer.aiEmpty'))
        return
      }
      clearDraft()
      setMode('reply')
      setBody(fresh.trim())
      flashAiDraft()
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.aiError')))
    } finally {
      setRedrafting(false)
    }
  }

  const appendDictation = (chunk: string) => {
    untouchedPrefillRef.current = null
    setBody((prev) => appendSpeechChunk(prev, chunk))
    setDictationInterim('')
  }
  const dictationInterimRef = useRef('')
  dictationInterimRef.current = dictationInterim
  const dictation = useSpeechDictation({
    onFinal: appendDictation,
    onInterim: setDictationInterim,
  })
  const confirmDictation = () => {
    // stop() closes the recognition session first so a trailing final cannot
    // re-append the same phrase we are about to commit from interim.
    const pending = dictationInterimRef.current.trim()
    dictation.stop()
    if (pending) appendDictation(pending)
    else setDictationInterim('')
  }
  // Show committed text plus live interim so the field grows and operators can
  // follow what SpeechRecognition is still refining.
  const composerValue = useMemo(() => {
    if (!dictation.listening || !dictationInterim.trim()) return displayBody
    return displayBody ? `${displayBody} ${dictationInterim}` : dictationInterim
  }, [displayBody, dictation.listening, dictationInterim])

  useLayoutEffect(() => {
    if (!dictation.listening) return
    const el = textareaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [composerValue, dictation.listening])

  useEffect(() => {
    // Never steal focus from an in-flight agent chat when a draft arrives.
    if (agentStreaming) return
    if (draftBody != null && draftBody !== '') {
      setMode('reply')
      setBody(draftBody)
      untouchedPrefillRef.current = draftBody
      // A live proposal replaces whatever restore banner was showing.
      setDraftRestored(false)
      setDraftStale(false)
      restoredDraftRef.current = null
      flashAiDraft()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftKey drives re-apply
  }, [draftKey, draftBody, agentStreaming])

  const showReplyTab = surface.modes.includes('reply')
  const showNoteTab = surface.modes.includes('note')
  // Ask AI: first send starts the session (parent), not the chip click.
  const focusStack = replyFocus ? focusToAvatarStack(replyFocus) : []
  const askFace = (size: number) => {
    if (focusStack.length > 1) {
      return <AvatarStack members={focusStack} size={size} linkAgents={false} />
    }
    if (focusStack.length === 1 && focusStack[0].kind === 'agent') {
      return <AgentMark agent={focusStack[0].agent} size={size} mode="static" decorative />
    }
    if (focusStack.length === 1 && focusStack[0].kind === 'user') {
      return (
        <UserAvatar
          name={focusStack[0].name}
          email={focusStack[0].email || focusStack[0].name}
          avatarUrl={focusStack[0].avatarUrl}
          size={size}
        />
      )
    }
    return (
      <AgentMark
        agent={askAgent}
        size={size}
        mode="static"
        decorative
        fallbackName={agentModeName || undefined}
      />
    )
  }
  const focusName = focusLabelName(
    replyFocus ?? { kind: 'client', targets: [], primaryAgentId: null },
    agentModeName || t('aiChat.title', { defaultValue: 'AI' }),
  )
  const focusHasAgents =
    replyFocus?.kind === 'agents' || replyFocus?.kind === 'mixed'
  const focusHumansOnly = replyFocus?.kind === 'humans'
  const noteTooltip = focusHumansOnly
    ? t('composer.tabHintTo', {
        defaultValue: 'Message a teammate in this conversation. The customer does not see it.',
      })
    : t('composer.tabHintNote')
  const showAskTab = surface.modes.includes('ask') && Boolean(onAgentMessage)
  const focusAgentChoices = useMemo(
    () => mentionItems.filter((item) => item.type === 'agent'),
    [mentionItems],
  )
  const focusPeopleChoices = useMemo(
    () => mentionItems.filter((item) => item.type === 'user'),
    [mentionItems],
  )
  const focusSelectedKeys = useMemo(
    () => new Set((replyFocus?.targets ?? []).map((row) => `${row.type}:${row.id}`)),
    [replyFocus?.targets],
  )

  const applyFocusTargets = (nextTargets: ComposerFocusTarget[]) => {
    if (nextTargets.length === 0) {
      toast.message(t('composer.pickFocusKeepOne'))
      return
    }
    const next = focusFromTargets(nextTargets)
    onReplyFocusChange?.(next)
    setBody((prev) => syncFocusMentionsInBody(prev, next))
    setMode(next.kind === 'humans' ? 'note' : 'ask')
  }

  const toggleFocusChoice = (item: MentionItem) => {
    if (item.type !== 'agent' && item.type !== 'user') return
    const key = `${item.type}:${item.id}`
    const current = replyFocus?.targets ?? []
    const exists = current.some((row) => `${row.type}:${row.id}` === key)
    if (exists) {
      applyFocusTargets(current.filter((row) => `${row.type}:${row.id}` !== key))
      return
    }
    const added: ComposerFocusTarget = {
      type: item.type,
      id: item.id,
      name: item.name,
      email: item.email,
      avatarUrl: item.avatarUrl,
      agent:
        item.type === 'agent'
          ? {
              id: item.id,
              name: item.name,
              agentId: item.id,
              agentAvatarKind: item.avatarKind,
              agentAvatarIcon: item.avatarIcon,
              agentAvatarColor: item.avatarColor,
              agentAvatarShape: item.avatarShape,
              agentAvatarImageUrl: item.avatarImageUrl,
            }
          : undefined,
    }
    applyFocusTargets([...current, added])
  }

  const showCustomerActions =
    showReplyTab && surface.channel !== 'internal' && surface.channel !== 'assistant'
  const isNote = mode === 'note'
  const isAsk = mode === 'ask'
  const isReply = mode === 'reply'
  const busy = saving
  const canSend = Boolean(body.trim()) || attachments.length > 0
  const threadIdForAi = persistKey?.trim() || null
  const showWriteAssist = isReply && !replyBlocked && Boolean(threadIdForAi)
  const [focusHoverIndex, setFocusHoverIndex] = useState<number | undefined>(undefined)
  const focusPickerSections = useMemo(() => {
    const sections: { title: string; items: MentionItem[] }[] = []
    if (focusAgentChoices.length > 0) {
      sections.push({ title: t('composer.pickFocusAgents'), items: focusAgentChoices })
    }
    if (focusPeopleChoices.length > 0) {
      sections.push({ title: t('composer.pickFocusPeople'), items: focusPeopleChoices })
    }
    return sections
  }, [focusAgentChoices, focusPeopleChoices, t])
  const focusPickerMenu =
    onReplyFocusChange && focusPickerSections.length > 0 ? (
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setFocusHoverIndex(undefined)
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t('composer.pickFocus')}
            aria-label={t('composer.pickFocus')}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'inline-flex items-center justify-center self-stretch border-l px-1.5 leading-none transition-colors',
              isAsk || (isNote && focusHumansOnly)
                ? 'border-border/50 text-inherit hover:bg-bg-muted/50'
                : 'border-transparent text-inherit opacity-70 hover:bg-bg-hover/80 hover:opacity-100',
            )}
            data-testid="composer-focus-chevron"
          >
            <ChevronDown size={11} className="shrink-0 opacity-70" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-auto border-0 bg-transparent p-0 shadow-none"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <MentionsPickerPanel
            sections={focusPickerSections}
            activeIndex={focusHoverIndex}
            selectedKeys={focusSelectedKeys}
            onSelect={toggleFocusChoice}
            onHover={setFocusHoverIndex}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  // Channel policy: a plain send closes the conversation. The primary button
  // then reads "Send and close" and the menu offers "Send and keep open".
  const closesByPolicy =
    isReply &&
    (Boolean(routingPolicy?.closeAfterHumanReply) ||
      (surface.channel === 'email' && closeEmailOnSend))
  const showHandbackChoice = isReply && handbackChoice

  const handleSubmit = async (
    action: 'send' | 'send_and_close' | 'send_and_pending',
    snoozeMinutes?: number,
    routing?: { handback?: boolean; keepOpen?: boolean },
  ) => {
    if (isReply && replyBlocked) return
    const text = body.trim()
    if (!text && attachments.length === 0) return

    const verb = parseComposerVerb(text)
    if (verb && onVerb) {
      try {
        const handled = await onVerb(verb)
        if (handled) {
          clearDraft()
          setAttachments([])
          return
        }
        toast.message(composerVerbHelp())
        return
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('composer.sendError')))
        return
      }
    }

    const payload = attachments.length ? attachments : undefined
    try {
      if (isAsk) {
        // Teammates share this tab with agents. A person gets a chat bubble;
        // an agent gets a turn. A note is only the Note button.
        if (focusHumansOnly) {
          await onNote(text, payload, { asChat: true })
          clearDraft()
          setAttachments([])
          requestAnimationFrame(() => textareaRef.current?.focus())
          return
        }
        if (!onAgentMessage) return
        // Clear immediately so Enter cannot triple-submit the same body.
        clearDraft()
        setAttachments([])
        let sent: boolean | void = false
        try {
          sent = await onAgentMessage(text, payload)
        } finally {
          if (sent === false) {
            setBody((current) => (current.trim() ? current : text))
            if (payload?.length) setAttachments(payload)
          }
        }
        requestAnimationFrame(() => textareaRef.current?.focus())
        return
      } else if (isNote) {
        // @teammate focus posts a real chat bubble; bare Note tab stays a note.
        await onNote(text, payload)
        clearDraft()
        setAttachments([])
      } else {
        // Customer reply: never treat structured mentions as agent invokes.
        const replyText = stripMentionMarkup(text)
        const quotedSource = lastInboundText?.trim() || ''
        const mailExtras =
          surface.channel === 'email'
            ? {
                cc: cc.trim() || undefined,
                bcc: bcc.trim() || undefined,
                channelAccountId: selectedChannelAccountId || undefined,
                to: toOverride || undefined,
                quotedHtml:
                  quoteIncluded && quotedSource
                    ? plainTextToQuotedHtml(quotedSource)
                    : undefined,
              }
            : surface.channel === 'whatsapp' && toOverride
              ? { to: toOverride }
              : {}
        const extras =
          surface.channel === 'email' || routing
            ? {
                ...mailExtras,
                handback: routing?.handback,
                keepOpen: routing?.keepOpen,
              }
            : undefined
        if (extras?.channelAccountId) writeLastMailboxChannelAccountId(extras.channelAccountId)
        // Clear immediately so the bubble can land optimistically; failures
        // stay on the timeline with retry instead of locking the composer.
        clearDraft()
        setAttachments([])
        try {
          await onReply(replyText, action, payload, snoozeMinutes, extras)
        } catch {
          // Delivery errors render on the outbound bubble (retry there).
        }
      }
    } catch (err) {
      toast.error(
        formatApiErrorMessage(
          err,
          isNote || isAsk ? t('composer.saveNoteError') : t('composer.sendError'),
        ),
      )
    }
  }

  const onPickFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length || !token) return
    setUploading(true)
    try {
      const uploaded: MessageAttachment[] = []
      for (const file of list) {
        const att = await uploadAttachment(token, file)
        uploaded.push(att)
      }
      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.uploadError')))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
    // A screenshot paste also carries HTML. Leave the typed text; drop the image payload.
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionMatches[mentionIndex] ?? mentionMatches[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (
      onPromoteEmailEdit &&
      isReply &&
      !replyBlocked &&
      !dictation.listening &&
      surface.channel === 'email' &&
      e.key.length === 1 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      const opened = onPromoteEmailEdit(body + e.key)
      if (opened) e.preventDefault()
    }
    // Email replies are consequential (real customer mail): plain Enter adds a
    // newline and Cmd/Ctrl+Enter sends. Chat, intern, and agent keep Enter-to-send.
    const enterSends = !(surface.channel === 'email' && isReply)
    const defaultAction = closesByPolicy ? 'send_and_close' : 'send'
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (!busy) void handleSubmit(defaultAction)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && enterSends) {
      e.preventDefault()
      if (!busy) void handleSubmit(defaultAction)
    }
  }

  const recipientLabel = t(
    surface.recipientLabel === 'To'
      ? 'composer.recipient.to'
      : surface.recipientLabel === 'With'
        ? 'composer.recipient.with'
        : surface.recipientLabel === 'Assistant'
          ? 'composer.recipient.assistant'
          : surface.recipientLabel === 'Agent'
            ? 'composer.recipient.agent'
            : surface.recipientLabel === 'Channel'
              ? 'composer.recipient.channel'
              : 'composer.recipient.to',
    { defaultValue: surface.recipientLabel },
  )

  return (
    <div className="relative shrink-0 bg-bg px-4 pb-4 pt-1">
      {/* Softens into the thread canvas so mode tabs float over scrolling messages. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full z-10 h-12 bg-gradient-to-t from-bg from-20% to-transparent"
      />
      <div className={CHAT_COLUMN_CLASS}>
        <div className="relative z-10 mb-1.5 flex items-stretch gap-1">
          {showReplyTab ? (
            <div
              className={cn(
                'inline-flex h-8 max-h-8 min-h-8 items-stretch overflow-hidden rounded-md text-xs leading-none',
                isReply ? 'bg-bg-hover' : '',
              )}
            >
              <button
                type="button"
                onClick={() => setMode('reply')}
                title={replyTooltip}
                className={cn(
                  'inline-flex h-full items-center gap-1.5 px-2.5 leading-none transition-colors',
                  isReply
                    ? 'font-medium text-text-heading'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                <DestinationGlyph channel={activeDestination?.channel || surface.channel} />
                <span className="max-w-[12rem] truncate-fade">{replyTabLabel}</span>
              </button>
              {canPickDestination ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title={t('composer.pickChannel')}
                      aria-label={t('composer.pickChannel')}
                      className={cn(
                        'inline-flex h-full items-center border-l border-border/50 px-1.5 leading-none transition-colors',
                        isReply
                          ? 'text-text-heading hover:bg-bg-muted/60'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                      )}
                      data-testid="composer-destination-chevron"
                    >
                      <ChevronDown size={11} className="shrink-0 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <p className="px-2 py-1.5 text-2xs font-semibold text-text-muted">
                      {t('composer.pickChannel')}
                    </p>
                    {replyDestinations.map((row) => {
                      const active = row.key === activeDestination?.key
                      const channelKey = row.channel
                      return (
                        <DropdownMenuItem
                          key={row.key}
                          className="gap-2 text-xs"
                          onSelect={() => pickDestination(row)}
                        >
                          <DestinationGlyph channel={row.channel} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate-fade font-medium text-text-heading">{row.label}</span>
                            <span className="block truncate-fade text-2xs text-text-muted">
                              {t(`composer.channel.${channelKey}`, { defaultValue: row.channel })}
                            </span>
                          </span>
                          {active ? <Check size={12} className="shrink-0 text-accent" /> : null}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
          {showAskTab ? (
            <div
              className={cn(
                'inline-flex h-8 max-h-8 min-h-8 items-center overflow-hidden rounded-md text-xs leading-none transition-colors',
                focusHumansOnly
                  ? isAsk
                    ? 'bg-bg-hover font-medium text-text-heading'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  : isAsk
                    ? 'bg-bg-hover font-medium text-ai-ink'
                    : 'text-ai-ink/80 hover:bg-ai/10 hover:text-ai-ink',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  let nextBody = body
                  const hasAgentChip = /@\[[^\]]+\]\(agent:[^)]+\)/.test(body)
                  if (!hasAgentChip && replyFocus && replyFocus.targets.length > 0) {
                    nextBody = syncAgentMentionsInBody(body, replyFocus)
                    setBody(nextBody)
                  }
                  onAskTabFocus?.(nextBody)
                  setMode('ask')
                }}
                title={askTooltip}
                className="inline-flex h-full items-center gap-1.5 px-2.5 leading-none"
              >
                {askFace(14)}
                {focusHumansOnly
                  ? t('composer.tabTo', { name: focusName, defaultValue: 'To {{name}}' })
                  : t('composer.tabAsk', { name: focusName })}
              </button>
              {focusPickerMenu}
            </div>
          ) : null}
          {showNoteTab ? (
            <div
              className={cn(
                'inline-flex h-8 max-h-8 min-h-8 items-center overflow-hidden rounded-md text-xs leading-none transition-colors',
                isNote
                  ? 'bg-bg-hover font-medium text-text-heading'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              <button
                type="button"
                onClick={() => setMode('note')}
                title={noteTooltip}
                className="inline-flex h-full items-center gap-1.5 px-2.5 leading-none"
              >
                <StickyNote size={11} />
                {t('composer.tabNote')}
              </button>
            </div>
          ) : null}
          {extraActions ? (
            <div className="ml-auto flex items-center gap-1.5">{extraActions}</div>
          ) : null}
        </div>

        {/* Only on Reply — Intern/Ask already work; repeating the mailbox banner there feels broken. */}
        {replyBlocked && isReply ? (
          <Callout
            tone="warning"
            actions={
              showNoteTab ? (
                <button
                  type="button"
                  onClick={() => setMode('note')}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t('composer.switchToNote', { defaultValue: 'Write an internal note instead' })}
                </button>
              ) : undefined
            }
          >
            {replyDisabledNotice}
          </Callout>
        ) : null}

        {!isNote && !isAsk && !replyBlocked && surface.showRecipient && surface.recipientValue ? (
          <div
            className="mb-1.5 rounded-md border border-border/50 bg-bg-elevated px-2.5 py-1.5 text-xs"
            title={surface.includeSignature ? t('composer.withSignature') : undefined}
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-medium text-text-muted">{recipientLabel}</span>
              <span className="min-w-0 truncate-fade text-text-primary">{surface.recipientValue}</span>
              <span className="ml-auto flex items-center gap-2">
                  {lastInboundText?.trim() ? (
                    <button
                      type="button"
                      aria-pressed={quoteIncluded}
                      onClick={() => setQuoteIncluded((on) => !on)}
                      className={cn(
                        'inline-flex items-center gap-1 text-2xs font-medium',
                        quoteIncluded ? 'text-accent' : 'text-text-muted hover:text-text-primary',
                      )}
                    >
                      <Quote size={10} />
                      {t('composer.quote')}
                    </button>
                  ) : null}
                  {surface.channel === 'email' ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCcBccOpen((open) => {
                        // Opening for the first time seeds the customer's CC
                        // list so reply-all does not require retyping addresses.
                        if (!open && !cc.trim() && suggestedCc?.trim()) setCc(suggestedCc.trim())
                        return !open
                      })
                    }
                    className={`shrink-0 text-2xs font-medium transition-colors ${
                      ccBccOpen || cc || bcc
                        ? 'text-accent'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {suggestedCc?.trim() ? t('composer.replyAll') : t('composer.ccBcc')}
                  </button>
                  ) : null}
                </span>
            </div>
            {surface.channel === 'email' && ccBccOpen ? (
              <div className="mt-1.5 space-y-1 border-t border-border/40 pt-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 font-medium text-text-muted">{t('compose.cc')}</span>
                  <input
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder={t('compose.ccPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 font-medium text-text-muted">{t('compose.bcc')}</span>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder={t('compose.bccPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {draftRestored && !isNote ? (
          <div
            className={cn(
              'flex items-center justify-between gap-2 rounded-md border px-2 py-1',
              draftStale
                ? 'border-status-warning/40 bg-status-warning/10'
                : 'border-border/50 bg-bg-elevated/70',
            )}
            data-testid={draftStale ? 'composer-draft-stale' : 'composer-draft-restored'}
          >
            <span className={cn('text-xs', draftStale ? 'text-text-secondary' : 'text-text-muted')}>
              {draftStale ? (
                <>
                  <span className="font-medium text-text-primary">{t('composer.draftStaleTitle')}</span>{' '}
                  {t('composer.draftStaleBody')}
                </>
              ) : (
                t('composer.draftRestored')
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {draftStale && token && persistKey ? (
                <button
                  type="button"
                  disabled={redrafting}
                  onClick={() => void redraft()}
                  className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                >
                  {redrafting ? t('composer.redrafting') : t('composer.redraft')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  clearDraft()
                  if (proposal) void proposal.onDismiss()
                }}
                className="text-xs font-medium text-accent hover:underline"
              >
                {t('composer.discardDraft')}
              </button>
            </span>
          </div>
        ) : null}

        {quoteIncluded && !isNote && !isAsk && lastInboundText?.trim() ? (
          <p className="mb-1.5 truncate text-2xs text-text-muted" data-testid="composer-quote-preview">
            {t('composer.quoteIncluded')}
            {' · '}
            {lastInboundText.trim().split('\n').map((line) => line.trim()).find(Boolean)}
          </p>
        ) : null}

        {!isNote && !isAsk && replyBlocked ? null : (
        <ComposerCard
          ref={textareaRef}
          id="inbox-reply-composer"
          mode={isNote || isAsk ? 'note' : surface.channel === 'email' ? 'email' : 'chat'}
              tone={
                isAsk && focusHasAgents
                  ? 'ai'
                  : isNote && !focusHumansOnly
                    ? 'note'
                    : 'default'
              }
          value={composerValue}
          readOnly={dictation.listening}
          onChange={(e) => {
            if (dictation.listening) return
            const el = e.currentTarget
            const edit = applyDisplayEdit(body, el.value)
            untouchedPrefillRef.current = null
            setBody(edit.raw)
            if (edit.display !== el.value) {
              // A mention was removed atomically; restore our caret position.
              pendingCaretRef.current = edit.displayCaret
              refreshMentionState(edit.display, edit.displayCaret)
            } else {
              refreshMentionState(edit.display, el.selectionStart ?? edit.display.length)
            }
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onClick={(e) => {
            const el = e.currentTarget
            refreshMentionState(el.value, el.selectionStart ?? el.value.length)
            // Click (not only focus) opens the mail client — focus alone is
            // easy to miss when the field already held focus or had a draft.
            if (!onPromoteEmailEdit || !isReply || replyBlocked || dictation.listening) return
            if (surface.channel !== 'email') return
            onPromoteEmailEdit(body)
          }}
          onFocus={() => {
            // Email reply editing belongs in the mail client — open it as soon
            // as the operator focuses the field (empty or with a draft).
            if (!onPromoteEmailEdit || !isReply || replyBlocked || dictation.listening) return
            if (surface.channel !== 'email') return
            onPromoteEmailEdit(body)
          }}
          onBlur={() => setMentionQuery(null)}
          highlighter={dictation.listening ? undefined : <MentionHighlight raw={body} />}
          aiFlashNonce={aiFlashNonce}
          disabled={disabled || busy}
          placeholder={
            dictation.listening
              ? t('composer.dictationListening')
              : isAsk && focusHumansOnly
                ? t('composer.teamMessagePlaceholder', {
                    name: focusName,
                    defaultValue: 'Message {{name}}...',
                  })
                : isAsk
                ? t('composer.askPlaceholder', {
                    name: agentModeName || t('aiChat.title', { defaultValue: 'AI' }),
                  })
                  : isNote
                    ? t('composer.notePlaceholder')
                    : t(surface.replyPlaceholderKey, {
                        ...surface.replyPlaceholderParams,
                        defaultValue: surface.replyPlaceholder,
                      })
          }
          className={isAsk || (isNote && !focusHumansOnly) ? undefined : 'bg-bg-surface'}
          header={
            attachments.length || uploading ? (
              <MessageAttachments
                placement="composer"
                attachments={attachments}
                pending={uploading}
                onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
              />
            ) : null
          }
          overlay={
            mentionOpen ? (
              <MentionPopover
                items={mentionMatches}
                activeIndex={mentionIndex}
                onSelect={selectMention}
                onHover={setMentionIndex}
              />
            ) : null
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          {!isNote && !isAsk && showWriteAssist && threadIdForAi ? (
            <ComposerWriteAssist
              threadId={threadIdForAi}
              body={body}
              disabled={saving || disabled || busy}
              onApply={(text, meta) => {
                untouchedPrefillRef.current = null
                setBody(text)
                if (meta?.fromAi) flashAiDraft()
                requestAnimationFrame(() => textareaRef.current?.focus())
              }}
            />
          ) : null}
          {dictation.supported ? (
            <DictationMicButton
              listening={dictation.listening}
              disabled={saving || disabled}
              onStart={() => {
                dictation.start()
              }}
              onConfirm={confirmDictation}
            />
          ) : null}
          <button
            type="button"
            disabled={uploading || saving || disabled}
            onClick={() => fileInputRef.current?.click()}
            title={t('composer.attachFile')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
          >
            <Paperclip size={14} />
          </button>
          <div className="flex h-8 shrink-0 items-center gap-1.5">
            {isAsk && agentStreaming ? (
              <button
                type="button"
                onClick={() => onStopAgent?.()}
                title={t('composer.stop', { defaultValue: 'Stop' })}
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-bg-hover px-2.5 text-text-primary transition-colors hover:bg-bg-hover/80"
              >
                <Square size={13} />
                <span className="text-xs font-medium">{t('composer.stop', { defaultValue: 'Stop' })}</span>
              </button>
            ) : null}
            <div
              className={cn(
                'flex h-8 overflow-hidden rounded-lg border',
                isAsk && !focusHumansOnly
                  ? 'border-ai'
                  : focusHumansOnly || isReply
                    ? 'border-border'
                    : 'border-text-muted',
              )}
            >
            <button
              type="button"
              disabled={!canSend || busy || disabled || uploading}
              onClick={() =>
                void (closesByPolicy ? handleSubmit('send_and_close') : handleSubmit('send'))
              }
              data-testid="composer-send"
              title={
                isAsk && focusHumansOnly
                  ? t('composer.sendTo', {
                      name: focusName,
                      defaultValue: 'Send to {{name}}',
                    })
                  : isAsk
                  ? t('composer.sendAsk', { name: focusName })
                    : isNote
                      ? t('composer.sendIntern')
                      : closesByPolicy
                        ? `${t('composer.sendAndClose')} — ${t('composer.closesByPolicy')}`
                        : surface.channel === 'email'
                          ? `${t('composer.sendTitle')} — ${t('composer.hintEmail')}`
                          : `${t('composer.sendTitle')} — ${t('composer.hintChat')}`
              }
              className={cn(
                'flex h-8 items-center justify-center gap-1.5 px-2.5 transition-colors disabled:opacity-40',
                isAsk && !focusHumansOnly
                  ? 'bg-ai text-ai-fg hover:opacity-90'
                  : focusHumansOnly
                    ? 'bg-bg-elevated text-text-heading hover:bg-bg-hover'
                    : isReply
                      ? 'bg-accent text-accent-fg hover:bg-accent-hover'
                      : 'bg-bg-elevated text-text-primary hover:bg-bg-hover',
              )}
            >
              {isAsk ? (
                askFace(16)
              ) : isNote && focusHumansOnly && focusStack.length === 1 && focusStack[0].kind === 'user' ? (
                <UserAvatar
                  name={focusStack[0].name}
                  email={focusStack[0].email || focusStack[0].name}
                  avatarUrl={focusStack[0].avatarUrl}
                  size={16}
                />
              ) : isNote && !focusHumansOnly ? (
                <StickyNote size={13} />
              ) : (
                <Send size={13} />
              )}
              {closesByPolicy ? (
                <span className="text-2xs font-medium opacity-90">{t('composer.sendAndClose')}</span>
              ) : isReply && surface.channel === 'email' ? (
                <span className="text-2xs font-medium opacity-90">{t('composer.sendShortcut')}</span>
              ) : null}
            </button>
            {isReply && showCustomerActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={
                      (!canSend && !onHandledExternally) || busy || disabled || uploading
                    }
                    title={t('composer.sendMore')}
                    aria-label={t('composer.sendMore')}
                    className="flex h-8 w-6 items-center justify-center border-l border-accent-fg/20 bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  {showHandbackChoice ? (
                    <>
                      <DropdownMenuItem
                        disabled={!canSend}
                        className="gap-1.5"
                        data-testid="composer-send-handback"
                        onClick={() => void handleSubmit('send', undefined, { handback: true })}
                      >
                        <AiMark size={13} />
                        {t('composer.sendHandback', {
                          name: agentModeName || t('aiChat.title', { defaultValue: 'AI' }),
                        })}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canSend}
                        className="gap-1.5"
                        data-testid="composer-send-keep"
                        onClick={() => void handleSubmit('send', undefined, { handback: false })}
                      >
                        <UserRound size={13} />
                        {t('composer.sendKeepWithMe')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  {closesByPolicy ? (
                    <DropdownMenuItem
                      disabled={!canSend}
                      data-testid="composer-send-keep-open"
                      onClick={() => void handleSubmit('send', undefined, { keepOpen: true })}
                    >
                      {t('composer.sendKeepOpen')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={!canSend}
                      onClick={() => void handleSubmit('send_and_close')}
                    >
                      {t('composer.sendAndClose')}
                    </DropdownMenuItem>
                  )}
                  {onHandledExternally ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-1.5"
                        onClick={onHandledExternally}
                        data-testid="composer-handled-externally"
                      >
                        <PhoneOff size={13} />
                        {t('composer.handledExternally')}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            </div>
          </div>
        </ComposerCard>
        )}
      </div>
    </div>
  )
}
