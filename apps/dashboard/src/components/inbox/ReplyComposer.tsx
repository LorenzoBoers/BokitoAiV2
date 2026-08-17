import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookmarkPlus, Clock, Mail, MessageCircle, MessageSquareText, Paperclip, Send, StickyNote } from 'lucide-react'
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
import { SNOOZE_PRESETS } from '../../lib/snooze'
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
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [tab, setTab] = useState<ComposerTab>(surface.defaultTab)
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
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

  useEffect(() => {
    setTab(surface.defaultTab)
    // Restore any unsent draft for this thread instead of dropping typed text.
    setBody(readStoredDraft(persistKey))
    setAttachments([])
  }, [surface.channel, surface.defaultTab, surface.recipientValue, persistKey])

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
      toast.error(formatApiErrorMessage(err, 'Could not load saved replies.'))
    }
  }
  const insertSavedReply = (row: SavedReplyRow) => {
    setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${row.bodyText}` : row.bodyText))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const saveCurrentAsReply = async () => {
    if (!token || !body.trim()) return
    const title = window.prompt('Template name:', body.trim().slice(0, 40))
    if (!title?.trim()) return
    try {
      const created = await createSavedReply(token, { title: title.trim(), bodyText: body.trim() })
      if (created) {
        setSavedReplies((prev) => (prev ? [...prev, created] : [created]))
        toast.success('Saved reply created')
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not save reply template.'))
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
    const text = body.trim()
    if (!text && attachments.length === 0) return
    const payload = attachments.length ? attachments : undefined
    try {
      if (tab === 'note') {
        await onNote(text, payload)
      } else {
        await onReply(text, action, payload, snoozeMinutes)
      }
      setBody('')
      setAttachments([])
      writeStoredDraft(persistKey, '')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, tab === 'note' ? 'Could not save note.' : 'Could not send message.'))
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
      toast.error(formatApiErrorMessage(err, 'Could not upload attachment.'))
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
              {surface.replyLabel}
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
              Note
            </button>
          ) : null}
          {extraActions ? <div className="ml-auto flex items-center gap-1.5">{extraActions}</div> : null}
        </div>

        {!isNote && surface.showRecipient && surface.recipientValue ? (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-border/50 bg-bg-elevated/40 px-2.5 py-1.5 text-[11.5px]">
            <span className="shrink-0 font-medium text-text-muted">{surface.recipientLabel}</span>
            <span className="min-w-0 truncate text-text-primary">{surface.recipientValue}</span>
            {surface.includeSignature ? (
              <span className="ml-auto shrink-0 text-[10px] text-text-muted">With signature</span>
            ) : null}
          </div>
        ) : null}

        <MessageAttachments
          attachments={attachments}
          onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
        />

        <div
          className={`relative flex items-end gap-2 rounded-2xl border px-3 py-2 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.45)] transition-colors focus-within:border-accent/50 ${
            isNote
              ? 'border-yellow-300/50 bg-yellow-50/40 dark:border-yellow-700/40 dark:bg-yellow-900/10'
              : 'border-border/70 bg-bg-surface'
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
            placeholder={isNote ? 'Internal note (not visible to the customer)...' : surface.replyPlaceholder}
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
                  title="Saved replies"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                >
                  <MessageSquareText size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {savedReplies === null ? (
                  <DropdownMenuItem disabled className="text-xs">
                    Loading...
                  </DropdownMenuItem>
                ) : savedReplies.length === 0 ? (
                  <DropdownMenuItem disabled className="text-xs">
                    No saved replies yet
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
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <button
            type="button"
            disabled={uploading || saving || disabled}
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
          >
            <Paperclip size={14} />
          </button>
          <button
            type="button"
            disabled={(!body.trim() && attachments.length === 0) || saving || disabled || uploading}
            onClick={() => void handleSubmit('send')}
            title={isNote ? 'Add note' : 'Send'}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition-colors disabled:opacity-40 ${
              isNote
                ? 'bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-700 dark:hover:bg-yellow-600'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {isNote ? <StickyNote size={13} /> : <Send size={13} />}
          </button>
        </div>

        <div className="mt-1.5 flex items-center justify-between px-1">
          <p className="text-[10.5px] text-text-muted">
            {surface.channel === 'email' && !isNote
              ? t('composer.hintEmail')
              : t('composer.hintChat')}
          </p>
          {!isNote && showReplyTab ? (
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={(!body.trim() && attachments.length === 0) || saving || disabled || uploading}
                    title="Send, then snooze the thread until it wakes or the customer replies"
                    className="h-6 gap-1 px-2 text-[11px] text-text-muted hover:text-text-primary"
                  >
                    <Clock size={11} />
                    Send &amp; snooze
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {SNOOZE_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.key}
                      className="text-xs"
                      onSelect={() =>
                        void handleSubmit('send_and_pending', preset.minutes() ?? undefined)
                      }
                    >
                      {preset.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="ghost"
                disabled={(!body.trim() && attachments.length === 0) || saving || disabled || uploading}
                onClick={() => void handleSubmit('send_and_close')}
                className="h-6 px-2 text-[11px] text-text-muted hover:text-text-primary"
              >
                Send and close
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
