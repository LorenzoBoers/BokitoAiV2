import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Clock, Mic, MicOff, Paperclip, Quote, Send, Square, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { ComposerCard } from '../ui/ComposerCard'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { AiMark } from '../ai/AiMark'
import { useMembers } from '../../hooks/useMembers'
import { useSpeechDictation } from '../../hooks/useSpeechDictation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { ComposerSurface, ComposerTab } from '../../lib/message-composer'
import type { MessageAttachment } from '../../lib/inbox-api'
import {
  activeMentionQuery,
  filterMentionItems,
  stripMentionMarkup,
  type MentionItem,
  type MentionQuery,
} from '../../lib/mentions'
import { applyDisplayEdit, applyMentionAtDisplay, displayFromRaw } from '../../lib/mention-editor'
import { parseComposerDraft, serializeComposerDraft } from '../../lib/inbox-ops'
import { SNOOZE_PRESETS } from '../../lib/snooze'
import { uploadAttachment } from '../../lib/uploads-api'
import ComposerWriteAssist from './ComposerWriteAssist'
import MentionPopover from './MentionPopover'
import { MentionHighlight } from './MentionHighlight'
import MessageAttachments from './MessageAttachments'

/** Composer mode: customer reply, team internal, or sticky agent meta. */
export type ComposerMode = 'reply' | 'note' | 'agent'

type Props = {
  surface: ComposerSurface
  onReply: (
    bodyText: string,
    action: 'send' | 'send_and_close' | 'send_and_pending',
    attachments?: MessageAttachment[],
    snoozeMinutes?: number,
    extras?: { cc?: string; bcc?: string },
  ) => Promise<void>
  onNote: (bodyText: string, attachments?: MessageAttachment[]) => Promise<void>
  /** Send into the active agent meta session (no customer delivery). */
  onAgentMessage?: (bodyText: string) => Promise<void>
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
  /** Controlled mode from the thread (agent sticky while session active). */
  mode?: ComposerMode
  onModeChange?: (mode: ComposerMode) => void
  /** Active meta agent label for the agent tab. */
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
}

const draftStorageKey = (persistKey: string) => `inbox.draft.${persistKey}`

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
  agentModeName,
  persistKey,
  replyDisabledNotice,
  suggestedCc,
  lastInboundText,
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [uncontrolledTab, setUncontrolledTab] = useState<ComposerTab>(surface.defaultTab)
  const [dictationInterim, setDictationInterim] = useState('')
  const mode: ComposerMode =
    modeProp ?? (uncontrolledTab === 'note' ? 'note' : 'reply')
  const setMode = (next: ComposerMode) => {
    if (next === 'reply' && mode !== 'reply') {
      // Structured mentions become plain @Name when returning to customer reply.
      setBody((prev) => stripMentionMarkup(prev))
    }
    onModeChange?.(next)
    if (modeProp === undefined) {
      setUncontrolledTab(next === 'reply' ? 'reply' : 'note')
    }
  }
  // `body` keeps the raw mention markup (storage/API format); the textarea
  // shows `displayBody` where mentions read as `@Name` pills.
  const [body, setBody] = useState('')
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
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // @mention autocomplete state
  const { members } = useMembers()
  const mentionItems: MentionItem[] = useMemo(
    () => [
      ...members.map((m): MentionItem => ({
        type: 'user',
        id: String(m.id),
        name: m.name,
        email: m.email,
        avatarUrl: m.avatarUrl,
      })),
      ...(mentionExtras ?? []),
    ],
    [members, mentionExtras],
  )
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionMatches = useMemo(
    () => (mentionQuery ? filterMentionItems(mentionItems, mentionQuery.query) : []),
    [mentionItems, mentionQuery],
  )
  const mentionOpen = mentionQuery !== null && mentionMatches.length > 0

  const refreshMentionState = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret)
    setMentionQuery(next)
    if (next?.query !== mentionQuery?.query) setMentionIndex(0)
  }

  const selectMention = (item: MentionItem) => {
    if (!mentionQuery) return
    const caret = textareaRef.current?.selectionStart ?? displayBody.length
    const applied = applyMentionAtDisplay(body, caret, mentionQuery, item)
    setBody(applied.raw)
    pendingCaretRef.current = applied.displayCaret
    setMentionQuery(null)
    setMentionIndex(0)
    // Selecting a mention is intentional: switch toward Intern (parent may
    // promote agent mentions further into agent mode).
    if (mode === 'reply') setMode(item.type === 'agent' ? 'agent' : 'note')
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
    // With replies blocked (e.g. mailbox disconnected) land on Intern instead.
    if (modeProp === undefined) {
      setUncontrolledTab(replyBlocked && surface.tabs.includes('note') ? 'note' : surface.defaultTab)
    }
    const stored = parseComposerDraft(readStoredDraft(persistKey))
    setBody(stored.body)
    setCc(stored.cc)
    setBcc(stored.bcc)
    setCcBccOpen(Boolean(stored.cc || stored.bcc))
    setDraftRestored(Boolean(stored.body || stored.cc || stored.bcc))
    setAttachments([])
  }, [surface.channel, surface.defaultTab, surface.recipientValue, persistKey, replyBlocked, surface.tabs, modeProp])

  // Persist the draft (debounced) so switching threads or reloading keeps it.
  useEffect(() => {
    if (!persistKey) return
    const timer = window.setTimeout(
      () => writeStoredDraft(persistKey, serializeComposerDraft({ body, cc, bcc })),
      400,
    )
    return () => window.clearTimeout(timer)
  }, [persistKey, body, cc, bcc])

  // Flush the draft synchronously when leaving the thread or unmounting, so
  // the debounce above cannot drop the last keystrokes.
  const draftRef = useRef({ body, cc, bcc })
  draftRef.current = { body, cc, bcc }
  useEffect(() => {
    if (!persistKey) return
    return () => writeStoredDraft(persistKey, serializeComposerDraft(draftRef.current))
  }, [persistKey])

  const appendDictation = (chunk: string) => {
    setBody((prev) => {
      const base = prev.trimEnd()
      return base ? `${base} ${chunk}` : chunk
    })
    setDictationInterim('')
  }
  const dictation = useSpeechDictation({
    onFinal: appendDictation,
    onInterim: setDictationInterim,
  })

  useEffect(() => {
    // Never steal focus from an in-flight agent chat when a draft arrives.
    if (agentStreaming) return
    if (draftBody != null && draftBody !== '') {
      setMode('reply')
      setBody(draftBody)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftKey drives re-apply
  }, [draftKey, draftBody, agentStreaming])

  const showReplyTab = surface.tabs.includes('reply')
  const showNoteTab = surface.tabs.includes('note')
  // One agent control: the tab. Session starts on first send (parent), not on click.
  const showAgentTab = Boolean(onAgentMessage)
  const showCustomerActions =
    showReplyTab && surface.channel !== 'internal' && surface.channel !== 'assistant'
  const isNote = mode === 'note'
  const isAgent = mode === 'agent'
  const isReply = mode === 'reply'
  const busy = saving || agentStreaming
  const threadIdForAi = persistKey?.trim() || null
  const showWriteAssist = isReply && !replyBlocked && Boolean(threadIdForAi)

  const handleSubmit = async (
    action: 'send' | 'send_and_close' | 'send_and_pending',
    snoozeMinutes?: number,
  ) => {
    if (isReply && replyBlocked) return
    if (isAgent && agentStreaming) return
    const text = body.trim()
    if (!text && attachments.length === 0) return
    const payload = attachments.length ? attachments : undefined
    try {
      if (isAgent) {
        if (!onAgentMessage) return
        // Clear immediately so Enter cannot triple-submit the same body.
        setBody('')
        setAttachments([])
        setDraftRestored(false)
        writeStoredDraft(persistKey, '')
        await onAgentMessage(text)
        return
      } else if (isNote) {
        await onNote(text, payload)
      } else {
        // Customer reply: never treat structured mentions as agent invokes.
        const replyText = stripMentionMarkup(text)
        const extras =
          surface.channel === 'email' && (cc.trim() || bcc.trim())
            ? { cc: cc.trim() || undefined, bcc: bcc.trim() || undefined }
            : undefined
        await onReply(replyText, action, payload, snoozeMinutes, extras)
      }
      setBody('')
      setAttachments([])
      setCc('')
      setBcc('')
      setCcBccOpen(false)
      setDraftRestored(false)
      writeStoredDraft(persistKey, '')
    } catch (err) {
      toast.error(
        formatApiErrorMessage(
          err,
          isNote || isAgent ? t('composer.saveNoteError') : t('composer.sendError'),
        ),
      )
    }
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !token) return
    setUploading(true)
    try {
      const uploaded: MessageAttachment[] = []
      for (const file of Array.from(files)) {
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (!busy) void handleSubmit('send')
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && enterSends) {
      e.preventDefault()
      if (!busy) void handleSubmit('send')
    }
  }

  const channelLabel = t(`composer.channel.${surface.channel}`, { defaultValue: surface.replyLabel })
  const replyTooltip = t('composer.channelTooltip', {
    channel: channelLabel,
    detail: surface.recipientValue ? ` · ${surface.recipientValue}` : '',
  })
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
    <div className="shrink-0 border-t border-border/40 px-4 pb-4 pt-2">
      <div className="mx-auto w-full max-w-[860px]">
        <div className="mb-1.5 flex items-center gap-1">
          {showReplyTab ? (
            <button
              type="button"
              onClick={() => setMode('reply')}
              title={replyTooltip}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isReply
                  ? 'bg-accent/15 text-accent font-semibold ring-1 ring-accent/20'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <ChannelGlyph channel={surface.channel} size={12} />
              {t('composer.tabReply')}
            </button>
          ) : null}
          {showNoteTab ? (
            <button
              type="button"
              onClick={() => setMode('note')}
              title={t('composer.tabHintNote')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isNote
                  ? 'bg-bg-elevated text-text-primary font-semibold ring-1 ring-border/70'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <StickyNote size={11} />
              {t('composer.tabNote')}
            </button>
          ) : null}
          {showAgentTab ? (
            <button
              type="button"
              onClick={() => setMode('agent')}
              title={t('composer.tabHintAgent')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isAgent
                  ? 'border border-ai/30 bg-ai/10 font-semibold text-ai-ink'
                  : 'text-ai-ink/80 hover:bg-ai/10 hover:text-ai-ink'
              }`}
            >
              <AiMark size={11} />
              {t('composer.tabAgent', { name: agentModeName || t('agentSession.title') })}
            </button>
          ) : null}
          {extraActions ? <div className="ml-auto flex items-center gap-1.5">{extraActions}</div> : null}
        </div>

        {/* Only on Reply — Intern/Agent already work; repeating the mailbox banner there feels broken. */}
        {replyBlocked && isReply ? (
          <div className="space-y-2 rounded-xl border border-status-warning/30 bg-status-warning/8 px-3 py-2.5 text-[12px] text-text-secondary">
            {replyDisabledNotice}
            {showNoteTab ? (
              <button
                type="button"
                onClick={() => setMode('note')}
                className="text-[11px] font-medium text-accent hover:underline"
              >
                {t('composer.switchToNote', { defaultValue: 'Write an internal note instead' })}
              </button>
            ) : null}
          </div>
        ) : null}

        {!isNote && !isAgent && !replyBlocked && surface.showRecipient && surface.recipientValue ? (
          <div
            className="mb-1.5 rounded-lg border border-border/60 bg-bg-elevated/40 px-2.5 py-1.5 text-[11.5px]"
            title={surface.includeSignature ? t('composer.withSignature') : undefined}
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-medium text-text-muted">{recipientLabel}</span>
              <span className="min-w-0 truncate text-text-primary">{surface.recipientValue}</span>
              <span className="ml-auto flex items-center gap-2">
                  {lastInboundText?.trim() ? (
                    <button
                      type="button"
                      onClick={() => {
                        const quoted = lastInboundText
                          .trim()
                          .split('\n')
                          .slice(0, 8)
                          .map((line) => `> ${line}`)
                          .join('\n')
                        setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${quoted}` : quoted))
                        requestAnimationFrame(() => textareaRef.current?.focus())
                      }}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-text-muted hover:text-text-primary"
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
                    className={`shrink-0 text-[10px] font-medium transition-colors ${
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
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-bg-elevated/70 px-2 py-1">
            <span className="text-[11px] text-text-muted">{t('composer.draftRestored')}</span>
            <button
              type="button"
              onClick={() => {
                setBody('')
                setCc('')
                setBcc('')
                setCcBccOpen(false)
                setDraftRestored(false)
                writeStoredDraft(persistKey, '')
              }}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              {t('composer.discardDraft')}
            </button>
          </div>
        ) : null}

        {!isNote && !isAgent && replyBlocked ? null : (
        <ComposerCard
          ref={textareaRef}
          id="inbox-reply-composer"
          mode={isNote || isAgent ? 'note' : surface.channel === 'email' ? 'email' : 'chat'}
          value={displayBody}
          onChange={(e) => {
            const el = e.currentTarget
            const edit = applyDisplayEdit(body, el.value)
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
          onClick={(e) => {
            const el = e.currentTarget
            refreshMentionState(el.value, el.selectionStart ?? el.value.length)
          }}
          onBlur={() => setMentionQuery(null)}
          highlighter={<MentionHighlight raw={body} />}
          disabled={disabled || busy}
          placeholder={
            dictation.listening
              ? dictationInterim
                ? t('composer.dictationHearing', { text: dictationInterim })
                : t('composer.dictationListening')
              : isAgent
                ? t('composer.agentPlaceholder', {
                    name: agentModeName || t('agentSession.title'),
                  })
                : isNote
                  ? t('composer.notePlaceholder')
                  : t(surface.replyPlaceholderKey, {
                      ...surface.replyPlaceholderParams,
                      defaultValue: surface.replyPlaceholder,
                    })
          }
          className={
            isAgent
              ? 'border-ai/30 border-l-[3px] border-l-ai/50 bg-ai/[0.06]'
              : isNote
                ? 'border-border/70 border-l-[3px] border-l-border bg-bg-elevated/40'
                : 'border-border/60 bg-bg-surface'
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
          {!isNote && !isAgent ? (
            <>
              {showWriteAssist && threadIdForAi ? (
                <ComposerWriteAssist
                  threadId={threadIdForAi}
                  body={body}
                  disabled={saving || disabled || busy}
                  onApply={(text) => {
                    setBody(text)
                    requestAnimationFrame(() => textareaRef.current?.focus())
                  }}
                />
              ) : null}
              {dictation.supported ? (
                <button
                  type="button"
                  disabled={saving || disabled || busy}
                  title={
                    dictation.listening
                      ? t('composer.dictationStop')
                      : t('composer.dictationStart')
                  }
                  aria-pressed={dictation.listening}
                  aria-label={
                    dictation.listening
                      ? t('composer.dictationStop')
                      : t('composer.dictationStart')
                  }
                  onClick={() => {
                    if (!dictation.listening) setMode('reply')
                    dictation.toggle()
                  }}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
                    dictation.listening
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                      : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  {dictation.listening ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            disabled={uploading || saving || disabled}
            onClick={() => fileInputRef.current?.click()}
            title={t('composer.attachFile')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
          >
            <Paperclip size={14} />
          </button>
          <div className="flex h-8 shrink-0 overflow-hidden rounded-xl">
            {isAgent && agentStreaming ? (
              <button
                type="button"
                onClick={() => onStopAgent?.()}
                title={t('directChat.stop', { defaultValue: 'Stop' })}
                className="flex h-8 items-center justify-center gap-1.5 rounded-xl bg-bg-hover px-2.5 text-text-primary transition-colors hover:bg-bg-hover/80"
              >
                <Square size={13} />
                <span className="text-[11px] font-medium">{t('directChat.stop', { defaultValue: 'Stop' })}</span>
              </button>
            ) : (
              <>
            <button
              type="button"
              disabled={(!body.trim() && attachments.length === 0) || busy || disabled || uploading}
              onClick={() => void handleSubmit('send')}
              title={
                isAgent
                  ? t('composer.sendAgent', { name: agentModeName || t('agentSession.title') })
                  : isNote
                    ? t('composer.sendIntern')
                    : surface.channel === 'email'
                      ? `${t('composer.sendTitle')} — ${t('composer.hintEmail')}`
                      : `${t('composer.sendTitle')} — ${t('composer.hintChat')}`
              }
              className={`flex h-8 items-center justify-center gap-1.5 px-2.5 transition-colors disabled:opacity-40 ${
                isAgent
                  ? 'bg-ai text-ai-fg hover:opacity-90'
                  : isNote
                    ? 'bg-bg-elevated text-text-primary ring-1 ring-border/70 hover:bg-bg-hover'
                    : 'bg-accent text-accent-fg hover:bg-accent-hover'
              } ${isReply && showCustomerActions ? 'rounded-none' : 'rounded-xl'}`}
            >
              {isAgent ? <AiMark size={13} /> : isNote ? <StickyNote size={13} /> : <Send size={13} />}
              {isReply && surface.channel === 'email' ? (
                <span className="text-[10px] font-medium opacity-90">{t('composer.sendShortcut')}</span>
              ) : null}
            </button>
            {isReply && showCustomerActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={(!body.trim() && attachments.length === 0) || busy || disabled || uploading}
                    title={t('composer.sendMore')}
                    aria-label={t('composer.sendMore')}
                    className="flex h-8 w-6 items-center justify-center border-l border-accent-fg/20 bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onClick={() => void handleSubmit('send_and_close')}>
                    {t('composer.sendAndClose')}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-1.5">
                      <Clock size={13} />
                      {t('composer.sendAndWait')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-44">
                      {SNOOZE_PRESETS.map((preset) => (
                        <DropdownMenuItem
                          key={preset.key}
                          onClick={() =>
                            void handleSubmit('send_and_pending', preset.minutes() ?? undefined)
                          }
                        >
                          {t(preset.labelKey)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
              </>
            )}
          </div>
        </ComposerCard>
        )}
      </div>
    </div>
  )
}
