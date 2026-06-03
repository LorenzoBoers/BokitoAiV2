import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ApiConfig, Conversation, InboxItem, TenantAppearance } from '../index'
import { createConversation, listDecisions } from '../index'
import { ChatPanel } from './ChatPanel'
import { DecisionPanel } from './DecisionPanel'
import { InboxList } from './InboxList'
import { ThreadList } from './ThreadList'

type Props = {
  config: ApiConfig
  defaultOpen?: boolean
  appearance?: TenantAppearance
}

const DEFAULT_APPEARANCE: TenantAppearance = {
  main_color: '#111827',
  chatbot_name: 'Assistant',
  powered_by: true,
}

export function FloatingMessenger({ config, defaultOpen = false, appearance }: Props) {
  const branding = { ...DEFAULT_APPEARANCE, ...appearance }
  const [open, setOpen] = useState(defaultOpen)
  const [tab, setTab] = useState<'chat' | 'inbox' | 'decisions'>('chat')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

  const stableConfig = useMemo(() => config, [config.baseUrl, config.getToken])

  const style = useMemo(
    () =>
      ({
        '--bk-brand-color': branding.main_color ?? '#111827',
      }) as CSSProperties,
    [branding.main_color],
  )

  useEffect(() => {
    createConversation(stableConfig, branding.chatbot_name ?? 'Assistant')
      .then((c) => setConversationId(c.id))
      .catch(console.error)
  }, [stableConfig, branding.chatbot_name])

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

  function handleThreadSelect(thread: Conversation) {
    setConversationId(thread.id)
    setTab('chat')
  }

  async function handleNewThread() {
    try {
      const c = await createConversation(stableConfig, branding.chatbot_name ?? 'Assistant')
      setConversationId(c.id)
      setTab('chat')
    } catch (e) {
      console.error(e)
    }
  }

  function handleInboxSelect(item: InboxItem) {
    if (item.kind === 'conversation' || item.conversation_id) {
      setConversationId(item.kind === 'conversation' ? item.id : (item.conversation_id ?? item.id))
      setTab('chat')
      return
    }
    if (item.kind === 'decision') {
      setTab('decisions')
    }
  }

  const launcherLabel = branding.chatbot_name ?? 'Assistant'

  return (
    <div className="bk-floating-messenger" style={style}>
      {open ? (
        <div className="bk-floating-panel">
          <header className="bk-floating-header">
            <div className="bk-floating-brand">
              {branding.logo ? (
                <img src={branding.logo} alt="" className="bk-floating-logo" />
              ) : null}
              <span>{launcherLabel}</span>
            </div>
            <div className="bk-floating-tabs">
              <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
                Chat
              </button>
              <button type="button" className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
                Inbox
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
            {tab === 'chat' ? (
              <div className="bk-floating-chat-layout">
                <ThreadList
                  config={stableConfig}
                  activeId={conversationId}
                  onSelect={handleThreadSelect}
                  onCreate={() => void handleNewThread()}
                />
                {conversationId ? (
                  <ChatPanel config={stableConfig} conversationId={conversationId} />
                ) : (
                  <p className="bk-decisions-empty">Loading chat...</p>
                )}
              </div>
            ) : null}
            {tab === 'inbox' ? (
              <InboxList config={stableConfig} onSelect={handleInboxSelect} />
            ) : null}
            {tab === 'decisions' ? <DecisionPanel config={stableConfig} /> : null}
          </div>
          {branding.powered_by !== false ? (
            <footer className="bk-floating-footer">Powered by Bokito</footer>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="bk-floating-launcher" onClick={() => setOpen((v) => !v)}>
        {launcherLabel}
        {pendingCount > 0 ? ` (${pendingCount})` : ''}
      </button>
    </div>
  )
}
