import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChatPanel, createConversation } from '@bokito/messenger-ui'
import { useAuth } from '../context/AuthContext'

export function ChatPage() {
  const { apiConfig } = useAuth()
  const [conversationId, setConversationId] = useState<string | null>(null)

  useEffect(() => {
    createConversation(apiConfig, 'Assistant').then((c) => setConversationId(c.id)).catch(console.error)
  }, [apiConfig])

  return (
    <div className="messenger-shell">
      <header className="messenger-header">
        <h1>Assistant</h1>
        <nav>
          <Link to="/decisions">Decisions</Link>
        </nav>
      </header>
      <main className="messenger-main">
        {conversationId ? <ChatPanel config={apiConfig} conversationId={conversationId} /> : <p>Loading...</p>}
      </main>
    </div>
  )
}
