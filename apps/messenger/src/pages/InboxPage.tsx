import { useNavigate } from 'react-router-dom'
import { InboxList, type InboxItem } from '@bokito/messenger-ui'
import { useAuth } from '../context/AuthContext'

export function InboxPage() {
  const { apiConfig } = useAuth()
  const navigate = useNavigate()

  function handleSelect(item: InboxItem) {
    if (item.kind === 'conversation') {
      navigate(`/chat/${item.id}`)
      return
    }
    if (item.kind === 'decision') {
      navigate('/decisions')
      return
    }
    if (item.conversation_id) {
      navigate(`/chat/${item.conversation_id}`)
    }
  }

  return (
    <div className="messenger-shell">
      <header className="messenger-header">
        <h1>Inbox</h1>
      </header>
      <main className="messenger-main messenger-inbox-full">
        <InboxList config={apiConfig} onSelect={handleSelect} />
      </main>
    </div>
  )
}
