import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Paperclip,
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
import ProviderLogo from '../email/ProviderLogo'
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
import { channelCanSend, listChannels, type ChannelRow } from '../../lib/channels-api'
import type { Provider } from '../../lib/email-oauth'
import { readLastMailboxChannelAccountId, writeLastMailboxChannelAccountId } from '../../lib/last-mailbox'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
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
import MentionPopover from './MentionPopover'
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
      handback?: boolean
      keepOpen?: boolean
      quotedHtml?: string
    },
  ) => Promise<void>
  onNote: (bodyText: string, attachments?: MessageAttachment[]) => Promise<void>
  /** Channel routing policy; drives the default send label and the ask split. */
  routingPolicy?: ThreadRoutingPolicy | null
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
  /** Called when a mention is inserted (e.g. to invoke an agent on send). */
  onMentionInserted?: (item: MentionItem) => void
  /** Controlled mode from the thread (ask sticky while an AI turn is active). */
  mode?: ComposerMode
  onModeChange?: (mode: ComposerMode) => void
  /** Slash verbs (/assign, /ticket, …). Return true when handled. */
  onVerb?: (verb: import('../../lib/composer-verbs').ParsedComposerVerb) => Promise<boolean> | boolean
  /** Active AI label for the Ask chip. */
  agentModeName?: string | null
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
  /** Operator picked another From mailbox; persist + rebind the thread. */
  onChannelAccountChange?: (channelAccountId: string) => void
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
  onPromoteEmailEdit?: (body: string) => void
}

const draftStorageKey = composerDraftStorageKey

function readStoredDraft(persistKey: string | null | undefined): string {
  if (!persistKey || typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(draftStorageKey(persistKey)) ?? ''
  } catch {
    return ''
  }
}

function writeStoredDraft(persistKey: string | null | undefined, value: string) {
  if (!persistKey || typeof window === 'undefined') return
  try {
    if (value.trim()) window.localStorage.setItem(draftStorageKey(persistKey), value)
    else window.localStorage.removeItem(draftStorageKey(persistKey))
  } catch {
    // Quota/private mode failures just mean the draft is not persisted.
  }
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
  persistKey,
  replyDisabledNotice,
  suggestedCc,
  lastInboundText,
  channelAccountId: boundChannelAccountId,
  onChannelAccountChange,
  proposal = null,
  latestInboundMessageId = null,
  isProposalOpen,
  onHandledExternally,
  onPromoteEmailEdit,
  routingPolicy = null,
  handbackChoice = false,
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [emailChannels, setEmailChannels] = useState<ChannelRow[]>([])
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
    if (!token || surface.channel !== 'email') {
      setEmailChannels([])
      return
    }
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
        setEmailChannels(mailboxes)
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
        if (!cancelled) setEmailChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [token, surface.channel, boundChannelAccountId])

  const selectedMailbox = useMemo(
    () => emailChannels.find((row) => row.id === selectedChannelAccountId) ?? null,
    [emailChannels, selectedChannelAccountId],
  )
  const canPickMailbox = surface.channel === 'email' && emailChannels.length > 1
  const pickMailbox = (channelAccountId: string) => {
    setSelectedChannelAccountId(channelAccountId)
    writeLastMailboxChannelAccountId(channelAccountId)
    onChannelAccountChange?.(channelAccountId)
    setMode('reply')
  }
  // Email chip shows the mailbox/channel name; chevron switches when there are several.
  const replyTabLabel =
    surface.channel === 'email'
      ? selectedMailbox
        ? mailboxDisplayLabel(
            selectedMailbox.displayName || selectedMailbox.label,
            selectedMailbox.address,
          )
        : t('composer.tabReplyEmail', { defaultValue: surface.replyLabel })
      : surface.replyTargetName
        ? t('composer.tabReplyTo', {
            name: surface.replyTargetName,
            defaultValue: `Reply to ${surface.replyTargetName}`,
          })
        : t('composer.tabReply')
  const replyTooltip = t('composer.tabHintReply')
  const noteTooltip = t('composer.tabHintNote')
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
    onMentionInserted?.(item)
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

  useEffect(() => {
    // Reload the stored draft when the thread identity changes — not when
    // the operator switches Reply/Ask/Note (that used to wipe a just-inserted
    // @agent mention and leave a bare "@").
    const stored = parseComposerDraft(readStoredDraft(persistKey))
    untouchedPrefillRef.current = null
    restoredDraftRef.current = stored
    // Keep the flush ref in step right away: a cleanup that runs before the
    // restored values have rendered (StrictMode, fast thread switch) must
    // write the restored draft back, not an empty one.
    draftRef.current = { body: stored.body, cc: stored.cc, bcc: stored.bcc }
    setBody(stored.body)
    setQuoteIncluded(false)
    setCc(stored.cc)
    setBcc(stored.bcc)
    setCcBccOpen(Boolean(stored.cc || stored.bcc))
    setDraftRestored(Boolean(stored.body || stored.cc || stored.bcc))
    setAttachments([])
  }, [persistKey, surface.channel, surface.recipientValue])

  // Persist the draft (debounced) so switching threads or reloading keeps it.
  useEffect(() => {
    if (!persistKey) return
    if (isUntouchedPrefill(body)) return
    const timer = window.setTimeout(
      () => writeStoredDraft(persistKey, serializeComposerDraft(storedDraftOf({ body, cc, bcc }))),
      400,
    )
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchors are read from refs
  }, [persistKey, body, cc, bcc])

  // Flush the draft synchronously when leaving the thread or unmounting, so
  // the debounce above cannot drop the last keystrokes.
  useEffect(() => {
    if (!persistKey) return
    return () => {
      if (isUntouchedPrefill(draftRef.current.body)) return
      writeStoredDraft(persistKey, serializeComposerDraft(storedDraftOf(draftRef.current)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchors are read from refs
  }, [persistKey])

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
  const showAskTab = surface.modes.includes('ask') && Boolean(onAgentMessage)
  const showCustomerActions =
    showReplyTab && surface.channel !== 'internal' && surface.channel !== 'assistant'
  const isNote = mode === 'note'
  const isAsk = mode === 'ask'
  const isReply = mode === 'reply'
  const busy = saving
  const canSend = Boolean(body.trim()) || attachments.length > 0
  const threadIdForAi = persistKey?.trim() || null
  const showWriteAssist = isReply && !replyBlocked && Boolean(threadIdForAi)

  // Channel policy: a plain send closes the conversation. The primary button
  // then reads "Send and close" and the menu offers "Send and keep open".
  const closesByPolicy = isReply && Boolean(routingPolicy?.closeAfterHumanReply)
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
                quotedHtml:
                  quoteIncluded && quotedSource
                    ? plainTextToQuotedHtml(quotedSource)
                    : undefined,
              }
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
    const items = e.clipboardData?.items
    if (!items?.length || !token) return
    const images: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) images.push(file)
      }
    }
    if (!images.length) return
    // Keep pasted text; only consume image files from the clipboard.
    void onPickFiles(images)
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
        <div className="relative z-10 mb-1.5 flex items-center gap-1">
          {showReplyTab ? (
            <div
              className={`flex items-stretch overflow-hidden rounded-md ${
                isReply ? 'bg-bg-hover' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => setMode('reply')}
                title={
                  surface.channel === 'email' && selectedMailbox
                    ? t('composer.sendFromHint', {
                        defaultValue: 'Send from this mailbox. Switching moves the conversation here.',
                      }) +
                      ` · ${mailboxDisplayLabel(
                        selectedMailbox.displayName || selectedMailbox.label,
                        selectedMailbox.address,
                      )}`
                    : replyTooltip
                }
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${
                  isReply
                    ? 'font-medium text-text-heading'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                {surface.channel === 'email' && selectedMailbox ? (
                  <ProviderLogo
                    provider={selectedMailbox.provider as Provider}
                    className="h-3 w-3 shrink-0 object-contain"
                  />
                ) : (
                  <ChannelGlyph channel={surface.channel} size={12} />
                )}
                <span className="max-w-[12rem] truncate-fade">{replyTabLabel}</span>
              </button>
              {canPickMailbox ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title={t('composer.sendFrom', { defaultValue: 'Send from' })}
                      aria-label={t('composer.sendFrom', { defaultValue: 'Send from' })}
                      className={`flex items-center border-l border-border/50 px-1.5 text-xs transition-colors ${
                        isReply
                          ? 'text-text-heading hover:bg-bg-muted/60'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                      }`}
                      data-testid="composer-mailbox-chevron"
                    >
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
                          onSelect={() => pickMailbox(row.id)}
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
              ) : null}
            </div>
          ) : null}
          {showAskTab ? (
            <button
              type="button"
              onClick={() => setMode('ask')}
              title={askTooltip}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isAsk
                  ? 'bg-bg-hover font-medium text-ai-ink'
                  : 'text-ai-ink/80 hover:bg-ai/10 hover:text-ai-ink'
              }`}
            >
              <AiMark size={11} />
              {t('composer.tabAsk', {
                name: agentModeName || t('aiChat.title', { defaultValue: 'AI' }),
              })}
            </button>
          ) : null}
          {showNoteTab ? (
            <button
              type="button"
              onClick={() => setMode('note')}
              title={noteTooltip}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isNote
                  ? 'bg-bg-hover font-medium text-text-heading'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <StickyNote size={11} />
              {t('composer.tabNote')}
            </button>
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

        <MessageAttachments
          attachments={attachments}
          onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />

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
          tone={isAsk ? 'ai' : isNote ? 'note' : 'default'}
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
          className={isAsk || isNote ? undefined : 'bg-bg-surface'}
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
          <div className="flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg">
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
            <button
              type="button"
              disabled={!canSend || busy || disabled || uploading}
              onClick={() =>
                void (closesByPolicy ? handleSubmit('send_and_close') : handleSubmit('send'))
              }
              data-testid="composer-send"
              title={
                isAsk
                  ? t('composer.sendAsk', {
                      name: agentModeName || t('aiChat.title', { defaultValue: 'AI' }),
                    })
                  : isNote
                    ? t('composer.sendIntern')
                    : closesByPolicy
                      ? `${t('composer.sendAndClose')} — ${t('composer.closesByPolicy')}`
                      : surface.channel === 'email'
                        ? `${t('composer.sendTitle')} — ${t('composer.hintEmail')}`
                        : `${t('composer.sendTitle')} — ${t('composer.hintChat')}`
              }
              className={`flex h-8 items-center justify-center gap-1.5 px-2.5 transition-colors disabled:opacity-40 ${
                isAsk
                  ? 'bg-ai text-ai-fg hover:opacity-90'
                  : isNote
                    ? 'bg-bg-elevated text-text-primary ring-1 ring-border/70 hover:bg-bg-hover'
                    : 'bg-accent text-accent-fg hover:bg-accent-hover'
              } ${isReply && showCustomerActions ? 'rounded-none' : 'rounded-lg'}`}
            >
              {isAsk ? <AiMark size={13} /> : isNote ? <StickyNote size={13} /> : <Send size={13} />}
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
        </ComposerCard>
        )}
      </div>
    </div>
  )
}
