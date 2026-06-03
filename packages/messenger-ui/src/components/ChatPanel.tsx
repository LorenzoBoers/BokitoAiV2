import { useEffect, useRef, useState } from 'react'
import type { ApiConfig, ChatMessage } from '../index'
import { listMessages, sendMessage } from '../index'

type Props = {
  config: ApiConfig
  conversationId: string
  onNewAssistantMessage?: (msg: ChatMessage) => void
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

  return (
    <div className="bk-chat-panel">
      <div className="bk-chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`bk-chat-bubble bk-chat-bubble--${m.role}`}>
            {m.content}
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
