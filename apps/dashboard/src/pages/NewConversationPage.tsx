import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUp, Bot, Check, ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useChatSessions } from '../context/ChatSessionsContext'
import {
  bokitoCreateConversation,
  bokitoListChatTargets,
  type ChatTarget,
} from '../lib/bokito-api'
import { agentChatPath, assistantPath } from '../lib/messages-paths'

type PickerFilter = 'all' | 'company'

/**
 * Composer-first "New conversation" surface: pick a recipient in the To-field
 * (personal assistant preselected), type, and Enter starts the chat.
 */
export default function NewConversationPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refresh: refreshSessions } = useChatSessions()

  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [selected, setSelected] = useState<ChatTarget | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerFilter, setPickerFilter] = useState<PickerFilter>('all')
  // Seed the composer from a ?prefill= query (e.g. "Ask assistant" from a
  // customer thread). Read once on mount so user edits are never overwritten.
  const [draft, setDraft] = useState(() => searchParams.get('prefill') ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pickerInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) return
      setLoadingTargets(true)
      try {
        const data = await bokitoListChatTargets(token)
        if (cancelled) return
        setTargets(data.items)
        const preselect =
          data.items.find((t) => t.id === data.default_agent_id) ?? data.items[0] ?? null
        setSelected(preselect)
      } catch {
        if (!cancelled) setError('Could not load chat targets.')
      } finally {
        if (!cancelled) setLoadingTargets(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    composerRef.current?.focus()
  }, [loadingTargets])

  // Close the picker when clicking outside.
  useEffect(() => {
    if (!pickerOpen) return
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [pickerOpen])

  const filteredTargets = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return targets.filter((t) => {
      if (pickerFilter === 'company' && t.kind !== 'company') return false
      if (q && !t.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [targets, pickerQuery, pickerFilter])

  const openPicker = (filter: PickerFilter = 'all') => {
    setPickerFilter(filter)
    setPickerQuery('')
    setPickerOpen(true)
    window.setTimeout(() => pickerInputRef.current?.focus(), 0)
  }

  const choose = (target: ChatTarget) => {
    setSelected(target)
    setPickerOpen(false)
    composerRef.current?.focus()
  }

  const start = useCallback(async () => {
    const content = draft.trim()
    if (!content || !token || !selected || sending) return
    setSending(true)
    setError(null)
    try {
      const created = await bokitoCreateConversation(token, content.slice(0, 60), selected.id)
      void refreshSessions()
      const path =
        selected.kind === 'company'
          ? agentChatPath(selected.id, created.id)
          : assistantPath(created.id)
      navigate(path, { state: { autoSend: content } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the conversation.')
      setSending(false)
    }
  }, [draft, token, selected, sending, navigate, refreshSessions])

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void start()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-border/40 px-4">
        <p className="text-[13px] font-medium text-text-primary">New conversation</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] px-4 pt-10">
          {/* To: picker */}
          <div ref={pickerRef} className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-bg-surface px-3 py-2">
              <span className="text-[12px] font-medium text-text-muted">To:</span>
              {pickerOpen ? (
                <input
                  ref={pickerInputRef}
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredTargets.length > 0) {
                      e.preventDefault()
                      choose(filteredTargets[0])
                    }
                    if (e.key === 'Escape') setPickerOpen(false)
                  }}
                  placeholder="Search assistants and agents..."
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => openPicker('all')}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {loadingTargets ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-text-muted">
                      <Loader2 size={12} className="animate-spin" /> Loading targets...
                    </span>
                  ) : selected ? (
                    <>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg-elevated text-accent">
                        <Bot size={11} />
                      </span>
                      <span className="truncate text-[13px] text-text-primary">{selected.name}</span>
                      {selected.kind === 'company' ? (
                        <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated px-1.5 py-px text-[10px] text-text-muted">
                          Company agent
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-accent/30 bg-accent/8 px-1.5 py-px text-[10px] text-accent">
                          My assistant
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[13px] text-text-muted">Choose a recipient</span>
                  )}
                  <ChevronDown size={13} className="ml-auto shrink-0 text-text-muted" />
                </button>
              )}
            </div>

            {pickerOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-border/70 bg-bg-surface shadow-xl">
                <div className="max-h-[300px] overflow-y-auto p-1">
                  {filteredTargets.length === 0 ? (
                    <p className="px-3 py-2.5 text-[12px] text-text-muted">No matches.</p>
                  ) : (
                    filteredTargets.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => choose(t)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover/60"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg-elevated text-accent">
                          <Bot size={12} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-text-primary">{t.name}</span>
                          <span className="block text-[10.5px] text-text-muted">
                            {t.kind === 'personal' ? 'Your personal assistant' : `Company agent · ${t.role}`}
                          </span>
                        </span>
                        {selected?.id === t.id ? <Check size={13} className="shrink-0 text-accent" /> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Quick chips */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => openPicker('company')}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-surface/70 px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              <Sparkles size={11} />
              Message an agent
            </button>
          </div>

          {/* Composer */}
          <div className="mt-6">
            {error ? <p className="mb-2 px-1 text-[12px] text-status-error">{error}</p> : null}
            <div className="flex items-end gap-2 rounded-2xl border border-border/70 bg-bg-surface px-3 py-2 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.45)] focus-within:border-accent/50">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={Math.min(8, Math.max(3, draft.split('\n').length))}
                placeholder={
                  selected
                    ? `Message ${selected.name}...`
                    : 'Choose a recipient and start typing...'
                }
                className="max-h-[220px] min-h-[64px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void start()}
                disabled={!draft.trim() || !selected || sending}
                title="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[10.5px] text-text-muted">
              Enter to send, Shift+Enter for a new line
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
