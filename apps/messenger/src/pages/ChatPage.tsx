import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChatPanel, ThreadList, type Conversation } from '@bokito/messenger-ui'
import { useAuth } from '../context/AuthContext'

export function ChatPage() {
  const { conversationId: routeConversationId } = useParams<{ conversationId?: string }>()
  const { apiConfig } = useAuth()
  const navigate = useNavigate()
  const [conversationId, setConversationId] = useState<string | null>(routeConversationId ?? null)

  useEffect(() => {
    if (routeConversationId) {
      setConversationId(routeConversationId)
    }
  }, [routeConversationId])

  function handleSelect(thread: Conversation) {
    setConversationId(thread.id)
    navigate(`/chat/${thread.id}`)
  }

  return (
    <div className="messenger-shell">
      <header className="messenger-header">
        <h1>Assistant</h1>
        <nav>
          <Link to="/">Inbox</Link>
          <Link to="/decisions">Decisions</Link>
        </nav>
      </header>
      <main className="messenger-main messenger-inbox-layout">
        <aside className="messenger-inbox-sidebar">
          <ThreadList config={apiConfig} activeId={conversationId} onSelect={handleSelect} />
        </aside>
        <div className="messenger-inbox-main">
          {conversationId ? (
            <ChatPanel config={apiConfig} conversationId={conversationId} />
          ) : (
            <div className="messenger-inbox-placeholder">Select a conversation</div>
          )}
        </div>
      </main>
    </div>
  )
}
