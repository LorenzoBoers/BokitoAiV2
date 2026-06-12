import { useEffect, useState, type ReactNode } from 'react'
import { Mail, MessageCircle, Send, StickyNote } from 'lucide-react'
import { Button } from '../ui/button'
import type { ComposerSurface, ComposerTab } from '../../lib/message-composer'

type Props = {
  surface: ComposerSurface
  onReply: (bodyText: string, action: 'send' | 'send_and_close' | 'send_and_pending') => Promise<void>
  onNote: (bodyText: string) => Promise<void>
  saving: boolean
  disabled?: boolean
  extraActions?: ReactNode
}

function tabIcon(surface: ComposerSurface, tab: ComposerTab) {
  if (tab === 'note') return StickyNote
  if (surface.channel === 'email') return Mail
  return MessageCircle
}

export default function ReplyComposer({
  surface,
  onReply,
  onNote,
  saving,
  disabled,
  extraActions,
}: Props) {
  const [tab, setTab] = useState<ComposerTab>(surface.defaultTab)
  const [body, setBody] = useState('')

  useEffect(() => {
    setTab(surface.defaultTab)
    setBody('')
  }, [surface.channel, surface.defaultTab, surface.recipientValue])

  const showReplyTab = surface.tabs.includes('reply')
  const showNoteTab = surface.tabs.includes('note')

  const handleSubmit = async (action: 'send' | 'send_and_close' | 'send_and_pending') => {
    const text = body.trim()
    if (!text) return
    if (tab === 'note') {
      await onNote(text)
    } else {
      await onReply(text, action)
    }
    setBody('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
              Notitie
            </button>
          ) : null}
          {extraActions ? <div className="ml-auto flex items-center gap-1.5">{extraActions}</div> : null}
        </div>

        {!isNote && surface.showRecipient && surface.recipientValue ? (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-border/50 bg-bg-elevated/40 px-2.5 py-1.5 text-[11.5px]">
            <span className="shrink-0 font-medium text-text-muted">{surface.recipientLabel}</span>
            <span className="min-w-0 truncate text-text-primary">{surface.recipientValue}</span>
            {surface.includeSignature ? (
              <span className="ml-auto shrink-0 text-[10px] text-text-muted">Met handtekening</span>
            ) : null}
          </div>
        ) : null}

        <div
          className={`flex items-end gap-2 rounded-2xl border px-3 py-2 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.45)] transition-colors focus-within:border-accent/50 ${
            isNote
              ? 'border-yellow-300/50 bg-yellow-50/40 dark:border-yellow-700/40 dark:bg-yellow-900/10'
              : 'border-border/70 bg-bg-surface'
          }`}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled || saving}
            placeholder={isNote ? 'Interne notitie (niet zichtbaar voor klant)...' : surface.replyPlaceholder}
            rows={Math.min(6, Math.max(1, body.split('\n').length))}
            className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!body.trim() || saving || disabled}
            onClick={() => void handleSubmit('send')}
            title={isNote ? 'Notitie toevoegen' : 'Verstuur'}
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
          <p className="text-[10.5px] text-text-muted">Enter to send, Shift+Enter for a new line</p>
          {!isNote && showReplyTab ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!body.trim() || saving || disabled}
              onClick={() => void handleSubmit('send_and_close')}
              className="h-6 px-2 text-[11px] text-text-muted hover:text-text-primary"
            >
              Stuur en sluit
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
