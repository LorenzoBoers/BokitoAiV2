import { useEffect, useRef, useState } from 'react'
import type { ApiConfig, ChatMessage } from '../index'
import { listMessages, sendMessage, submitFeedback } from '../index'
import { DecisionCard } from './DecisionCard'

type Props = {
  config: ApiConfig
  conversationId: string
  onNewAssistantMessage?: (msg: ChatMessage) => void
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderBasicMarkdown(text: string) {
  const escaped = escapeHtml(text)
  const withCode = escaped.replace(/`([^`]+)`/g, '<code>$1</code>')
  const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const withLinks = withBold.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  )
  return withLinks.replace(/\n/g, '<br />')
}

function MessageFeedback({ config, messageId }: { config: ApiConfig; messageId: string }) {
  const [score, setScore] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleScore(value: number) {
    if (busy || score !== null) return
    setBusy(true)
    try {
      await submitFeedback(config, messageId, value)
      setScore(value)
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bk-chat-feedback">
      <span className="bk-chat-feedback-label">Rate response</span>
      <div className="bk-chat-feedback-stars">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className={`bk-chat-feedback-star${score === value ? ' bk-chat-feedback-star--active' : ''}`}
            disabled={busy || score !== null}
            onClick={() => void handleScore(value)}
            aria-label={`Score ${value}`}
          >
            {value}
          </button>
        ))}
      </div>
      {score !== null ? <span className="bk-chat-feedback-thanks">Thanks</span> : null}
    </div>
  )
}

export function ChatPanel({ config, conversationId, onNewAssistantMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listMessages(config, conversationId).then(setMessages).catch(console.error)
  }, [config, conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    if (!input.trim() || loading) return
    const content = input.trim()
    setInput('')
    setLoading(true)
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content }])
    try {
      const res = await sendMessage(config, conversationId, content)
      setMessages((prev) => [...prev, res.message])
      onNewAssistantMessage?.(res.message)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function refreshMessages() {
    listMessages(config, conversationId).then(setMessages).catch(console.error)
  }

  return (
    <div className="bk-chat-panel">
      <div className="bk-chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`bk-chat-bubble bk-chat-bubble--${m.role}`}>
            {m.role === 'assistant' ? (
              <div
                className="bk-chat-markdown"
                dangerouslySetInnerHTML={{ __html: renderBasicMarkdown(m.content) }}
              />
            ) : (
              m.content
            )}
            {m.decision_request_id ? (
              <DecisionCard
                config={config}
                decisionId={m.decision_request_id}
                onResolved={refreshMessages}
              />
            ) : null}
            {m.role === 'assistant' && m.id && !m.id.startsWith('local-') ? (
              <MessageFeedback config={config} messageId={m.id} />
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="bk-chat-compose">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message your assistant..."
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
        />
        <button type="button" onClick={() => void handleSend()} disabled={loading}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
