import { useEffect, useMemo, useState } from 'react'
import type { ApiConfig } from '../index'
import { createConversation, listDecisions } from '../index'
import { ChatPanel } from './ChatPanel'
import { DecisionPanel } from './DecisionPanel'

type Props = {
  config: ApiConfig
  defaultOpen?: boolean
}

export function FloatingMessenger({ config, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [tab, setTab] = useState<'chat' | 'decisions'>('chat')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

  const stableConfig = useMemo(() => config, [config.baseUrl, config.getToken])

  useEffect(() => {
    createConversation(stableConfig, 'Assistant').then((c) => setConversationId(c.id)).catch(console.error)
  }, [stableConfig])

  useEffect(() => {
    const refresh = () => {
      listDecisions(stableConfig)
        .then((d) => setPendingCount(d.length))
        .catch(() => {})
    }
    refresh()
    const id = window.setInterval(refresh, 20000)
    return () => window.clearInterval(id)
  }, [stableConfig])

  return (
    <div className="bk-floating-messenger">
      {open ? (
        <div className="bk-floating-panel">
          <header className="bk-floating-header">
            <div className="bk-floating-tabs">
              <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
                Chat
              </button>
              <button type="button" className={tab === 'decisions' ? 'active' : ''} onClick={() => setTab('decisions')}>
                OS {pendingCount > 0 ? `(${pendingCount})` : ''}
              </button>
            </div>
            <button type="button" className="bk-floating-close" onClick={() => setOpen(false)} aria-label="Close">
              Close
            </button>
          </header>
          <div className="bk-floating-body">
            {tab === 'chat' && conversationId ? (
              <ChatPanel config={stableConfig} conversationId={conversationId} />
            ) : null}
            {tab === 'decisions' ? <DecisionPanel config={stableConfig} /> : null}
          </div>
        </div>
      ) : null}
      <button type="button" className="bk-floating-launcher" onClick={() => setOpen((v) => !v)}>
        Assistant{pendingCount > 0 ? ` (${pendingCount})` : ''}
      </button>
    </div>
  )
}
