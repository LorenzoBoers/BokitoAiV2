import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BookmarkPlus, Mail, MessageCircle, MessageSquareText, Paperclip, Send, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useMembers } from '../../hooks/useMembers'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { ComposerSurface, ComposerTab } from '../../lib/message-composer'
import type { MessageAttachment } from '../../lib/inbox-api'
import {
  activeMentionQuery,
  applyMention,
  filterMentionItems,
  type MentionItem,
  type MentionQuery,
} from '../../lib/mentions'
import { createSavedReply, listSavedReplies, type SavedReplyRow } from '../../lib/signals-api'
import { uploadAttachment } from '../../lib/uploads-api'
import MentionPopover from './MentionPopover'
import MessageAttachments from './MessageAttachments'

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
  /** Stable id (thread id) to persist unsent drafts across thread switches. */
  persistKey?: string | null
  /** When set, outbound replies are blocked (e.g. mailbox disconnected) and
   * this notice is rendered in place of the reply input. Notes still work. */
  replyDisabledNotice?: ReactNode
}

function tabIcon(surface: ComposerSurface, tab: ComposerTab) {
  if (tab === 'note') return StickyNote
  if (surface.channel === 'email') return Mail
  return MessageCircle
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
  saving,
  disabled,
  extraActions,
  draftBody,
  draftKey,
  mentionExtras,
  onMentionInserted,
  persistKey,
  replyDisabledNotice,
}: Props) {
  const { t } = useTranslation('communication')
  const navigate = useNavigate()
  const { token } = useAuth()
  const [tab, setTab] = useState<ComposerTab>(surface.defaultTab)
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  // Email-only extra recipients; hidden behind a CC/BCC toggle.
  const [ccBccOpen, setCcBccOpen] = useState(false)
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
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
    const caret = textareaRef.current?.selectionStart ?? body.length
    const applied = applyMention(body, caret, mentionQuery, item)
    setBody(applied.value)
    setMentionQuery(null)
    setMentionIndex(0)
    onMentionInserted?.(item)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(applied.caret, applied.caret)
      }
    })
  }

  const replyBlocked = replyDisabledNotice != null

  useEffect(() => {
    // With replies blocked (e.g. mailbox disconnected) land on Note instead.
    setTab(replyBlocked && surface.tabs.includes('note') ? 'note' : surface.defaultTab)
    // Restore any unsent draft for this thread instead of dropping typed text.
    setBody(readStoredDraft(persistKey))
    setAttachments([])
    setCc('')
    setBcc('')
    setCcBccOpen(false)
  }, [surface.channel, surface.defaultTab, surface.recipientValue, persistKey, replyBlocked, surface.tabs])

  // Persist the draft (debounced) so switching threads or reloading keeps it.
  useEffect(() => {
    if (!persistKey) return
    const timer = window.setTimeout(() => writeStoredDraft(persistKey, body), 400)
    return () => window.clearTimeout(timer)
  }, [persistKey, body])

  // Flush the draft synchronously when leaving the thread or unmounting, so
  // the debounce above cannot drop the last keystrokes.
  const bodyRef = useRef(body)
  bodyRef.current = body
  useEffect(() => {
    if (!persistKey) return
    return () => writeStoredDraft(persistKey, bodyRef.current)
  }, [persistKey])

  // Saved replies (canned responses), loaded lazily when the picker opens.
  const [savedReplies, setSavedReplies] = useState<SavedReplyRow[] | null>(null)
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
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const saveCurrentAsReply = async () => {
    if (!token || !body.trim()) return
    const title = window.prompt(t('composer.templateNamePrompt'), body.trim().slice(0, 40))
    if (!title?.trim()) return
    try {
      const created = await createSavedReply(token, { title: title.trim(), bodyText: body.trim() })
      if (created) {
        setSavedReplies((prev) => (prev ? [...prev, created] : [created]))
        toast.success(t('composer.savedReplyCreated'))
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('composer.saveReplyError')))
    }
  }

  useEffect(() => {
    if (draftBody != null && draftBody !== '') {
      setTab('reply')
      setBody(draftBody)
    }
  }, [draftKey, draftBody])

  const showReplyTab = surface.tabs.includes('reply')
  const showNoteTab = surface.tabs.includes('note')

  const handleSubmit = async (
    action: 'send' | 'send_and_close' | 'send_and_pending',
    snoozeMinutes?: number,
  ) => {
    if (tab !== 'note' && replyBlocked) return
    const text = body.trim()
    if (!text && attachments.length === 0) return
    const payload = attachments.length ? attachments : undefined
    try {
      if (tab === 'note') {
        await onNote(text, payload)
      } else {
        const extras =
          surface.channel === 'email' && (cc.trim() || bcc.trim())
            ? { cc: cc.trim() || undefined, bcc: bcc.trim() || undefined }
            : undefined
        await onReply(text, action, payload, snoozeMinutes, extras)
      }
      setBody('')
      setAttachments([])
      setCc('')
      setBcc('')
      setCcBccOpen(false)
      writeStoredDraft(persistKey, '')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, tab === 'note' ? t('composer.saveNoteError') : t('composer.sendError')))
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
    // newline and Cmd/Ctrl+Enter sends. Chat and notes keep Enter-to-send.
    const enterSends = !(surface.channel === 'email' && tab === 'reply')
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmit('send')
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && enterSends) {
      e.preventDefault()
      void handleSubmit('send')
    }
  }

  const ReplyIcon = tabIcon(surface, 'reply')
  const isNote = tab === 'note'
  const replyLabel = t(`composer.channel.${surface.channel}`, { defaultValue: surface.replyLabel })
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
              onClick={() => setTab('reply')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                !isNote
                  ? 'bg-accent/15 text-accent font-semibold ring-1 ring-accent/20'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <ReplyIcon size={11} />
              {replyLabel}
            </button>
          ) : null}
          {showNoteTab ? (
            <button
              type="button"
              onClick={() => setTab('note')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isNote
                  ? 'bg-yellow-100 text-yellow-800 font-semibold ring-1 ring-yellow-300/60 dark:bg-yellow-900/30 dark:text-yellow-200 dark:ring-yellow-700/40'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <StickyNote size={11} />
              {t('composer.tabNote')}
            </button>
          ) : null}
          {extraActions ? <div className="ml-auto flex items-center gap-1.5">{extraActions}</div> : null}
        </div>

        {!isNote && replyBlocked ? (
          <div className="rounded-xl border border-border/60 bg-bg-elevated/40 px-3 py-2.5 text-[12px] text-text-secondary">
            {replyDisabledNotice}
          </div>
        ) : null}

        {!isNote && !replyBlocked && surface.showRecipient && surface.recipientValue ? (
          <div className="mb-1.5 rounded-lg border border-border/60 bg-bg-elevated/40 px-2.5 py-1.5 text-[11.5px]">
            <div className="flex items-center gap-2">
              <span className="shrink-0 font-medium text-text-muted">{recipientLabel}</span>
              <span className="min-w-0 truncate text-text-primary">{surface.recipientValue}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {surface.channel === 'email' ? (
                  <button
                    type="button"
                    onClick={() => setCcBccOpen((open) => !open)}
                    className={`text-[10px] font-medium transition-colors ${
                      ccBccOpen || cc || bcc
                        ? 'text-accent'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {t('composer.ccBcc')}
                  </button>
                ) : null}
                {surface.includeSignature ? (
                  <span className="text-[10px] text-text-muted">{t('composer.withSignature')}</span>
                ) : null}
              </span>
            </div>
            {surface.channel === 'email' && ccBccOpen ? (
              <div className="mt-1.5 space-y-1 border-t border-border/40 pt-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 font-medium text-text-muted">CC</span>
                  <input
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="name@example.com, other@example.com"
                    className="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 font-medium text-text-muted">BCC</span>
                  <input
                    type="text"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="name@example.com"
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

        {!isNote && replyBlocked ? null : (
        <div
          className={`relative flex items-end gap-2 rounded-2xl border px-3 py-2 shadow-card transition-colors focus-within:border-accent/50 ${
            isNote
              ? 'border-yellow-300/50 bg-yellow-50/40 dark:border-yellow-700/40 dark:bg-yellow-900/10'
              : 'border-border/60 bg-bg-surface'
          }`}
        >
          {mentionOpen ? (
            <MentionPopover
              items={mentionMatches}
              activeIndex={mentionIndex}
              onSelect={selectMention}
              onHover={setMentionIndex}
            />
          ) : null}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              refreshMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              const el = e.currentTarget
              refreshMentionState(el.value, el.selectionStart ?? el.value.length)
            }}
            onBlur={() => setMentionQuery(null)}
            disabled={disabled || saving}
            placeholder={isNote ? t('composer.notePlaceholder') : surface.replyPlaceholder}
            rows={Math.min(6, Math.max(1, body.split('\n').length))}
            className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          {!isNote ? (
            <DropdownMenu onOpenChange={(open) => open && void loadSavedReplies()}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={saving || disabled}
                  title={t('composer.savedReplies')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                >
                  <MessageSquareText size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {savedReplies === null ? (
                  <DropdownMenuItem disabled className="text-xs">
                    {t('composer.loadingSavedReplies')}
                  </DropdownMenuItem>
                ) : savedReplies.length === 0 ? (
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => navigate('/settings/channels#saved-replies')}
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
                {body.trim() ? (
                  <DropdownMenuItem className="gap-1.5 text-xs" onSelect={() => void saveCurrentAsReply()}>
                    <BookmarkPlus size={12} />
                    Save current text as template
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => navigate('/settings/channels#saved-replies')}
                >
                  {t('composer.manageSavedReplies')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
          <button
            type="button"
            disabled={(!body.trim() && attachments.length === 0) || saving || disabled || uploading}
            onClick={() => void handleSubmit('send')}
            title={isNote ? t('composer.addNoteTitle') : t('composer.sendTitle')}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${
              isNote
                ? 'bg-yellow-500 text-white hover:bg-yellow-600 dark:bg-yellow-700 dark:hover:bg-yellow-600'
                : 'bg-accent text-accent-fg hover:bg-accent-hover'
            }`}
          >
            {isNote ? <StickyNote size={13} /> : <Send size={13} />}
          </button>
        </div>
        )}

        {!isNote && replyBlocked ? null : (
        <div className="mt-1.5 flex items-center justify-between px-1">
          <p className="text-[10.5px] text-text-muted">
            {surface.channel === 'email' && !isNote
              ? t('composer.hintEmail')
              : t('composer.hintChat')}
          </p>
          {!isNote && showReplyTab ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={(!body.trim() && attachments.length === 0) || saving || disabled || uploading}
              onClick={() => void handleSubmit('send_and_close')}
              className="h-6 px-2 text-[11px] text-text-muted hover:text-text-primary"
            >
              Send and close
            </Button>
          ) : null}
        </div>
        )}
      </div>
    </div>
  )
}
