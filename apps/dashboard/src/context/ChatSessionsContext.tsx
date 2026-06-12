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
import { bokitoListConversations, type ConversationWithAgent } from '../lib/bokito-api'
import { assistantPath, newConversationPath } from '../lib/messages-paths'
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

  // Live updates: thread events refresh the session list (debounced).
  useEffect(() => {
    if (!token) return
    let timer: number | null = null
    const trigger = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void refresh()
      }, GATEWAY_DEBOUNCE_MS)
    }
    const unsub = onGatewayEvent('threads', trigger)
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
      navigate(assistantPath(id))
    },
    [navigate],
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
