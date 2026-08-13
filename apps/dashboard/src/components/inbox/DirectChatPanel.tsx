import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowUp, Bot, Check, ClipboardCopy, Loader2, PanelRight, Pencil, Square, Trash2, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useChatSessions } from '../../context/ChatSessionsContext'
import { agentChatPath, assistantPath } from '../../lib/messages-paths'
import { onGatewayEvent } from '../../lib/gateway'
import { resolveThreadDecision } from '../../lib/inbox-api'
import {
  bokitoDeleteConversation,
  bokitoListMessages,
  bokitoRenameConversation,
  bokitoStreamMessage,
  type ChatDecision,
  type ChatDecisionOption,
  type ChatMessage,
} from '../../lib/bokito-api'
import { UserAvatar } from '../ui/UserAvatar'
import ThinkingTrace from './ThinkingTrace'
import ReasoningDisclosure from './ReasoningDisclosure'
import { useSignalStream } from '../../hooks/useSignalStream'

type StreamState = {
  text: string
  thinking: string
  active: boolean
}

export type DirectChatPanelProps = {
  conversationId: string
  title?: string | null
  agentName?: string | null
  agentKind?: string | null
  onDeleted?: () => void
  onRefreshThreads?: () => void
  onToggleContext?: () => void
  contextOpen?: boolean
  /** Embedded mode (e.g. Ask-assistant side panel): no header bar. */
  hideHeader?: boolean
  /** Sent automatically once when the conversation is still empty. */
  initialMessage?: string | null
  /** When set, assistant replies get a copy action (e.g. copy to composer). */
  onCopyText?: (text: string) => void
}

function SystemEventDivider({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className="h-px flex-1 bg-border/40" />
      <span className="max-w-[70%] truncate text-[11px] text-text-muted">{text}</span>
      <span className="h-px flex-1 bg-border/40" />
    </div>
  )
}

function MessageBubble({
  message,
  userName,
  userEmail,
  userAvatarUrl,
  conversationId,
  onDecisionResolved,
  onCopyText,
}: {
  message: ChatMessage
  userName: string
  userEmail: string
  userAvatarUrl?: string | null
  conversationId: string
  onDecisionResolved: () => void
  onCopyText?: (text: string) => void
}) {
  const isUser = message.role === 'user'

  if (message.kind === 'system_event' || message.role === 'system') {
    return <SystemEventDivider text={message.content} />
  }

  if (isUser) {
    return (
      <div className="flex items-start justify-end gap-2.5">
        <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-accent/14 px-4 py-2.5 text-[13.5px] leading-relaxed text-text-primary">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <span className="mt-0.5 shrink-0">
          <UserAvatar name={userName} email={userEmail} avatarUrl={userAvatarUrl} size={26} />
        </span>
      </div>
    )
  }

  const hasDecision = Boolean(message.decision_request_id)

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-border/60 bg-bg-elevated text-accent">
        <Bot size={14} />
      </span>
      <div className="min-w-0 max-w-[82%] space-y-1">
        <ReasoningDisclosure
          thinking={message.thinking}
          steps={message.steps}
          usage={message.usage}
          className="max-w-full"
        />
        {hasDecision ? (
          // The decision card carries the title/summary itself; skip the plain
          // bubble so the request is not shown twice.
          <ChatDecisionCard
            conversationId={conversationId}
            messageId={message.id}
            decision={message.decision ?? null}
            fallbackText={message.content}
            onResolved={onDecisionResolved}
          />
        ) : (
          <div className="rounded-2xl rounded-tl-md border border-border/50 bg-bg-surface/85 px-4 py-2.5 text-[13.5px] leading-relaxed text-text-primary">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        )}
        {!hasDecision && onCopyText && message.content.trim() ? (
          <button
            type="button"
            onClick={() => onCopyText(message.content)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
          >
            <ClipboardCopy size={11} />
            Copy to composer
          </button>
        ) : null}
      </div>
    </div>
  )
}

const FALLBACK_DECISION_OPTIONS: ChatDecisionOption[] = [
  { id: 'approve', label: 'Approve' },
  { id: 'later', label: 'Later' },
  { id: 'reject', label: 'Reject' },
]

function decisionActionFor(option: ChatDecisionOption): 'approve' | 'defer' | 'reject' {
  if (option.id === 'reject' || option.id === 'escalate') return 'reject'
  if (option.action_type === 'reject' || option.action_type === 'escalate') return 'reject'
  if (option.id === 'later' || option.id === 'defer' || option.id === 'edit') return 'defer'
  if (option.action_type === 'defer' || option.action_type === 'draft') return 'defer'
  return 'approve'
}

function ChatDecisionCard({
  conversationId,
  messageId,
  decision,
  fallbackText,
  onResolved,
}: {
  conversationId: string
  messageId: string
  decision: ChatDecision | null
  fallbackText: string
  onResolved: () => void
}) {
  const { token } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Server-driven resolved state: survives reloads and other clients resolving.
  const resolved = decision != null && decision.status !== 'awaiting_human'
  const options =
    decision && decision.options.length > 0 ? decision.options : FALLBACK_DECISION_OPTIONS
  const chosenLabel = decision?.chosen_option_id
    ? options.find((o) => o.id === decision.chosen_option_id)?.label ?? decision.chosen_option_id
    : null
  const bodyText = decision?.summary || fallbackText

  const act = async (option: ChatDecisionOption) => {
    if (!token || busy || resolved) return
    setBusy(true)
    setError(null)
    try {
      await resolveThreadDecision(token, conversationId, messageId, decisionActionFor(option), {
        optionId: option.id,
      })
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve decision.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`rounded-xl border px-3.5 py-2.5 ${
        resolved ? 'border-border/50 bg-bg-surface/70' : 'border-accent/35 bg-accent/6'
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Decision
        </p>
        {resolved ? (
          <span className="rounded-full bg-bg-hover px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            {decision?.status === 'approved'
              ? `Approved${chosenLabel ? ` - ${chosenLabel}` : ''}`
              : decision?.status === 'rejected'
                ? 'Rejected'
                : 'Deferred'}
          </span>
        ) : null}
      </div>
      {decision?.title ? (
        <p className="mt-1 text-[13px] font-medium text-text-primary">{decision.title}</p>
      ) : null}
      {bodyText && bodyText !== decision?.title ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-secondary">
          {bodyText}
        </p>
      ) : null}
      {!resolved ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {options.map((option, idx) => (
            <button
              key={option.id ?? idx}
              type="button"
              disabled={busy}
              onClick={() => void act(option)}
              className={
                decisionActionFor(option) === 'approve'
                  ? 'rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50'
                  : 'rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60 disabled:opacity-50'
              }
            >
              {option.label ?? option.id}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-1.5 text-[11px] text-status-error">{error}</p> : null}
    </div>
  )
}

/**
 * AI chat pane for direct assistant/agent conversations inside the
 * Communication hub thread layout (list + detail + context panel).
 */
export default function DirectChatPanel({
  conversationId,
  title,
  agentName,
  agentKind,
  onDeleted,
  onRefreshThreads,
  onToggleContext,
  contextOpen,
  hideHeader,
  initialMessage,
  onCopyText,
}: DirectChatPanelProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const { refresh: refreshSessions } = useChatSessions()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [draft, setDraft] = useState('')
  const [stream, setStream] = useState<StreamState>({ text: '', thinking: '', active: false })
  const gatewayStream = useSignalStream(conversationId)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingRef = useRef(false)
  const autoSentRef = useRef(false)

  const loadMessages = useCallback(async () => {
    if (!token || !conversationId) {
      setMessages([])
      return
    }
    setLoadingMessages(true)
    try {
      const rows = await bokitoListMessages(token, conversationId)
      setMessages(rows)
    } catch {
      setMessages([])
    } finally {
      setLoadingMessages(false)
      setHasLoadedOnce(true)
    }
  }, [token, conversationId])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  useEffect(() => {
    if (!token || !conversationId) return
    const unsub = onGatewayEvent(`signal:${conversationId}`, () => {
      if (!streamingRef.current) void loadMessages()
    })
    return () => unsub()
  }, [token, conversationId, loadMessages])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, stream.text, stream.thinking, gatewayStream.streamText, gatewayStream.thinkingText])

  const activeStreamText = stream.active ? stream.text : gatewayStream.streamText
  const activeThinkingText = stream.active ? stream.thinking : gatewayStream.thinkingText
  const showStreamBubble = stream.active || gatewayStream.streaming
  const agentSteps = gatewayStream.steps

  useEffect(() => {
    composerRef.current?.focus()
  }, [conversationId])

  const send = useCallback(
    async (contentOverride?: string) => {
      const content = (contentOverride ?? draft).trim()
      if (!content || !token || !conversationId || streamingRef.current) return
      setDraft('')
      setError(null)

      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimistic])
      setStream({ text: '', thinking: '', active: true })
      streamingRef.current = true
      const controller = new AbortController()
      abortRef.current = controller

      try {
        await bokitoStreamMessage(
          token,
          conversationId,
          content,
          (delta) => {
            setStream((prev) => ({ ...prev, text: prev.text + delta, active: true }))
          },
          controller.signal,
          (thinkingDelta) => {
            setStream((prev) => ({ ...prev, thinking: prev.thinking + thinkingDelta, active: true }))
          },
        )
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Message failed.')
        }
      } finally {
        streamingRef.current = false
        abortRef.current = null
        setStream({ text: '', thinking: '', active: false })
        if (token && conversationId) {
          try {
            const rows = await bokitoListMessages(token, conversationId)
            setMessages(rows)
          } catch {
            // keep optimistic state
          }
        }
        void refreshSessions()
        onRefreshThreads?.()
      }
    },
    [draft, token, conversationId, refreshSessions, onRefreshThreads],
  )

  useEffect(() => {
    const state = location.state as { autoSend?: string } | null
    if (!state?.autoSend || autoSentRef.current) return
    autoSentRef.current = true
    navigate(location.pathname, { replace: true, state: null })
    void send(state.autoSend)
  }, [location.state, location.pathname, navigate, send])

  // Embedded mode: seed the conversation once with the provided context message.
  useEffect(() => {
    if (!initialMessage || autoSentRef.current || !hasLoadedOnce || loadingMessages) return
    autoSentRef.current = true
    if (messages.length > 0) return
    void send(initialMessage)
  }, [initialMessage, hasLoadedOnce, loadingMessages, messages.length, send])

  const stopStreaming = () => {
    abortRef.current?.abort()
  }

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const startRename = () => {
    setRenameDraft(title ?? '')
    setRenaming(true)
  }

  const commitRename = async () => {
    if (!token || !conversationId) return
    const nextTitle = renameDraft.trim()
    setRenaming(false)
    if (!nextTitle || nextTitle === title) return
    try {
      await bokitoRenameConversation(token, conversationId, nextTitle)
      void refreshSessions()
      onRefreshThreads?.()
    } catch {
      // non-fatal
    }
  }

  const deleteConversation = async () => {
    if (!token || !conversationId) return
    if (!window.confirm('Delete this conversation?')) return
    try {
      await bokitoDeleteConversation(token, conversationId)
      void refreshSessions()
      onDeleted?.()
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {hideHeader ? null : (
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-4">
        {renaming ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="w-full max-w-[420px] rounded-md border border-border/70 bg-bg-input px-2 py-1 text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
              autoFocus
            />
            <button type="button" onClick={() => void commitRename()} className="rounded-md p-1 text-text-muted hover:text-text-primary" aria-label="Save title">
              <Check size={13} />
            </button>
            <button type="button" onClick={() => setRenaming(false)} className="rounded-md p-1 text-text-muted hover:text-text-primary" aria-label="Cancel rename">
              <X size={13} />
            </button>
          </span>
        ) : (
          <>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg-elevated text-accent">
              <Bot size={12} />
            </span>
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
              {title ?? 'Conversation'}
              {agentName ? (
                <span className="ml-2 rounded-full border border-border/60 bg-bg-elevated px-2 py-0.5 text-[10.5px] font-normal text-text-muted">
                  {agentName}
                  {agentKind === 'company' ? ' · Company agent' : ''}
                </span>
              ) : null}
            </p>
            <button type="button" onClick={startRename} title="Rename conversation" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={() => void deleteConversation()} title="Delete conversation" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-status-error">
              <Trash2 size={13} />
            </button>
            {onToggleContext ? (
              <button
                type="button"
                onClick={onToggleContext}
                title={contextOpen ? 'Hide context' : 'Show context'}
                className={`rounded-md p-1.5 transition-colors hover:bg-bg-hover/60 ${
                  contextOpen ? 'text-accent' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <PanelRight size={14} />
              </button>
            ) : null}
          </>
        )}
      </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] px-4 py-6">
          {loadingMessages && messages.length === 0 ? (
            <div className="flex justify-center pt-16 text-text-muted">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  userName={user?.name ?? 'You'}
                  userEmail={user?.email ?? ''}
                  userAvatarUrl={user?.avatarUrl}
                  conversationId={conversationId}
                  onDecisionResolved={() => void loadMessages()}
                  onCopyText={onCopyText}
                />
              ))}
              {showStreamBubble ? (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-border/60 bg-bg-elevated text-accent">
                    <Bot size={14} />
                  </span>
                  <ThinkingTrace
                    steps={agentSteps}
                    active={stream.active || gatewayStream.streaming}
                    streamText={activeStreamText}
                    thinkingText={activeThinkingText}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-5 pt-2">
        <div className="mx-auto w-full max-w-[820px]">
          {error ? <p className="mb-2 px-1 text-[12px] text-status-error">{error}</p> : null}
          <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-bg-surface px-3 py-2 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.45)] focus-within:border-accent/50">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={Math.min(6, Math.max(1, draft.split('\n').length))}
              placeholder="Message your assistant..."
              className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            {stream.active ? (
              <button type="button" onClick={stopStreaming} title="Stop" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-bg-hover text-text-primary transition-colors hover:bg-bg-hover/80">
                <Square size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim()}
                title="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-text-muted">Enter to send, Shift+Enter for a new line</p>
        </div>
      </div>
    </div>
  )
}

export function DirectChatEmptyState({ agentLabel }: { agentLabel: string }) {
  const navigate = useNavigate()
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-bg-surface text-accent shadow-sm">
        <Bot size={22} />
      </span>
      <h2 className="mt-5 text-[17px] font-semibold text-text-heading">{agentLabel}</h2>
      <p className="mt-1.5 max-w-[360px] text-[13px] text-text-muted">
        Pick a conversation from the list or start a new chat.
      </p>
      <button
        type="button"
        onClick={() => navigate('/communication/new')}
        className="mt-5 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        New chat
      </button>
    </div>
  )
}

export function directPathForAgent(agentId: string, kind: 'personal' | 'company', threadId?: string): string {
  if (kind === 'company') return agentChatPath(agentId, threadId)
  return assistantPath(threadId)
}
