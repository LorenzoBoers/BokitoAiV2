import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { bokitoListConversations, type ConversationWithAgent } from '../lib/signals-api'
import { agentChatPath, newConversationPath } from '../lib/messages-paths'
import { onGatewayEvent } from '../lib/gateway'

const GATEWAY_DEBOUNCE_MS = 1_200

type ChatSessionsContextValue = {
  conversations: ConversationWithAgent[]
  loading: boolean
  refresh: () => Promise<void>
  /** Navigate to a fresh chat (conversation is created on first message). */
  startNewChat: () => void
  openConversation: (id: string) => void
}

const ChatSessionsContext = createContext<ChatSessionsContextValue | null>(null)

export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<ConversationWithAgent[]>([])
  const [loading, setLoading] = useState(false)
  const fetchIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!token) {
      setConversations([])
      return
    }
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    try {
      const rows = await bokitoListConversations(token, 'assistant')
      if (fetchIdRef.current === fetchId) setConversations(rows)
    } catch {
      if (fetchIdRef.current === fetchId) setConversations([])
    } finally {
      if (fetchIdRef.current === fetchId) setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live updates: thread events refresh the session list only when we cannot
  // apply a row locally. Assistant-channel upserts patch the list in place.
  useEffect(() => {
    if (!token) return
    let timer: number | null = null
    const scheduleFullRefresh = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void refresh()
      }, GATEWAY_DEBOUNCE_MS)
    }
    const unsub = onGatewayEvent('threads', (event) => {
      if (event.event !== 'message' && event.event !== 'thread') {
        scheduleFullRefresh()
        return
      }
      const data = event.data as Record<string, unknown>
      const thread = (data.thread ?? data) as Record<string, unknown>
      const channel = String(thread.channel ?? '')
      if (channel !== 'assistant') {
        scheduleFullRefresh()
        return
      }
      const id = String(thread.id ?? '')
      if (!id) {
        scheduleFullRefresh()
        return
      }
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === id)
        const title = String(
          thread.email_subject ?? thread.subject ?? ((idx >= 0 ? prev[idx].title : '') || ''),
        )
        const nextRow: ConversationWithAgent = {
          id,
          title,
          channel: 'assistant',
          updated_at: String(
            thread.last_message_at ?? (idx >= 0 ? prev[idx].updated_at : new Date().toISOString()),
          ),
          agent_id:
            thread.agent_id != null
              ? String(thread.agent_id)
              : idx >= 0
                ? prev[idx].agent_id ?? null
                : null,
          agent_name:
            thread.agent_name != null
              ? String(thread.agent_name)
              : idx >= 0
                ? prev[idx].agent_name ?? null
                : null,
          agent_kind: idx >= 0 ? prev[idx].agent_kind ?? null : null,
        }
        if (idx < 0) return [nextRow, ...prev]
        const copy = [...prev]
        copy[idx] = { ...prev[idx], ...nextRow }
        return copy
      })
    })
    return () => {
      unsub()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [token, refresh])

  const startNewChat = useCallback(() => {
    navigate(newConversationPath())
  }, [navigate])

  const openConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id)
      if (conv?.agent_id) {
        navigate(agentChatPath(conv.agent_id, id))
        return
      }
      navigate(newConversationPath())
    },
    [navigate, conversations],
  )

  const value = useMemo(
    () => ({ conversations, loading, refresh, startNewChat, openConversation }),
    [conversations, loading, refresh, startNewChat, openConversation],
  )

  return <ChatSessionsContext.Provider value={value}>{children}</ChatSessionsContext.Provider>
}

export function useChatSessions(): ChatSessionsContextValue {
  const ctx = useContext(ChatSessionsContext)
  if (!ctx) throw new Error('useChatSessions must be used within ChatSessionsProvider')
  return ctx
}
