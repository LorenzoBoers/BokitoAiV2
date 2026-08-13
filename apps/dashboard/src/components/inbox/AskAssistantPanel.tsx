import { useEffect, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { bokitoCreateConversation } from '../../lib/bokito-api'
import type { InboxThread } from '../../lib/inbox-api'
import DirectChatPanel from './DirectChatPanel'

type Props = {
  thread: InboxThread
  onClose: () => void
  /** One-click copy of an assistant answer into the thread composer. */
  onCopyToComposer: (text: string) => void
}

/**
 * Inline assistant side panel for external customer threads: chat with your
 * AI about the open thread without leaving it, then copy the answer into the
 * reply composer. One assistant conversation is reused per thread (session).
 */
const conversationByThread = new Map<string, string>()

export default function AskAssistantPanel({ thread, onClose, onCopyToComposer }: Props) {
  const { token } = useAuth()
  const threadKey = String(thread.id)
  const [conversationId, setConversationId] = useState<string | null>(
    conversationByThread.get(threadKey) ?? null,
  )
  const [initialMessage, setInitialMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = conversationByThread.get(threadKey) ?? null
    setConversationId(cached)
    setInitialMessage(null)
    setError(null)
    if (!token || cached) return
    let cancelled = false
    const subject = thread.emailSubject || thread.contactName || 'this thread'
    // The backend grounds the conversation in the live thread transcript via
    // context_signal_id, so the opening prompt can stay short.
    void bokitoCreateConversation(token, `Assist: ${subject}`.slice(0, 80), null, {
      contextSignalId: threadKey,
    })
      .then((conv) => {
        if (cancelled) return
        conversationByThread.set(threadKey, conv.id)
        setConversationId(conv.id)
        setInitialMessage('Summarize this thread and suggest how to respond.')
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not start an assistant chat.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, threadKey, thread.emailSubject, thread.contactName, thread.channel])

  return (
    <aside className="flex h-full min-h-0 w-[380px] shrink-0 flex-col border-l border-border/50 bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          <Sparkles size={12} className="text-accent" />
          Ask assistant
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-0.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          aria-label="Close assistant panel"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {error ? (
          <p className="px-4 py-6 text-[12px] text-status-error">{error}</p>
        ) : !conversationId ? (
          <div className="flex justify-center pt-16 text-text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <DirectChatPanel
            conversationId={conversationId}
            hideHeader
            initialMessage={initialMessage}
            onCopyText={onCopyToComposer}
          />
        )}
      </div>
    </aside>
  )
}
