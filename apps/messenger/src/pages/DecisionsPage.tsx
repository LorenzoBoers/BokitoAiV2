import { Link } from 'react-router-dom'
import { DecisionPanel } from '@bokito/messenger-ui'
import { useAuth } from '../context/AuthContext'

export function DecisionsPage() {
  const { apiConfig } = useAuth()

  return (
    <div className="messenger-shell">
      <header className="messenger-header">
        <h1>OS Decisions</h1>
        <nav>
          <Link to="/">Chat</Link>
        </nav>
      </header>
      <main className="messenger-main">
        <DecisionPanel config={apiConfig} />
      </main>
    </div>
  )
}
