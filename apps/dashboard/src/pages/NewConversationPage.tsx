import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUp, Bot, Check, ChevronDown, Loader2, Mail, Sparkles, User } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useChatSessions } from '../context/ChatSessionsContext'
import {
  bokitoCreateConversation,
  bokitoListChatTargets,
  type ChatTarget,
} from '../lib/bokito-api'
import { agentRoleLabel } from '../lib/agent-role-label'
import { agentChatPath, assistantPath } from '../lib/messages-paths'
import { ComposerCard } from '../components/ui/ComposerCard'
import { canComposeToAddress, composeEmailPath } from '../lib/compose-intent'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { humanizeContactName } from '../lib/contact-label'

type PickerFilter = 'all' | 'company' | 'people'

/**
 * Composer-first "New conversation" surface: pick a recipient in the To-field
 * (personal assistant preselected), type, and Enter starts the chat.
 */
export default function NewConversationPage() {
  const { t } = useTranslation(['communication', 'nav'])
  const { token } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refresh: refreshSessions } = useChatSessions()

  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
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
  // ?autosend=1 (first-run tour setup chat): fire the prefilled message as
  // soon as the default recipient is resolved, once.
  const autoSendRequested = useRef(searchParams.get('autosend') === '1')

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pickerInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) return
      setLoadingTargets(true)
      try {
        const [data, people] = await Promise.all([
          bokitoListChatTargets(token),
          listContacts(token).catch(() => [] as ContactRow[]),
        ])
        if (cancelled) return
        setTargets(data.items)
        setContacts(people)
        const preselect =
          data.items.find((t) => t.id === data.default_agent_id) ?? data.items[0] ?? null
        setSelected(preselect)
      } catch {
        if (!cancelled) setError(t('newConversation.loadError'))
      } finally {
        if (!cancelled) setLoadingTargets(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token, t])

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
      if (pickerFilter === 'people') return false
      if (pickerFilter === 'company' && t.kind !== 'company') return false
      if (q && !t.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [targets, pickerQuery, pickerFilter])

  const filteredContacts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return contacts
      .filter((contact) => canComposeToAddress(contact.channel, contact.address))
      .filter((contact) => {
        if (pickerFilter === 'company') return false
        if (!q) return pickerFilter === 'people' || pickerFilter === 'all'
        const name = `${contact.displayName} ${contact.address}`.toLowerCase()
        return name.includes(q)
      })
      .slice(0, 8)
  }, [contacts, pickerQuery, pickerFilter])

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
      setError(err instanceof Error ? err.message : t('newConversation.startError'))
      setSending(false)
    }
  }, [draft, token, selected, sending, navigate, refreshSessions, t])

  useEffect(() => {
    if (!autoSendRequested.current || loadingTargets || !selected || !draft.trim()) return
    autoSendRequested.current = false
    void start()
  }, [loadingTargets, selected, draft, start])

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void start()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-border/40 px-4">
        <p className="text-[13px] font-medium text-text-primary">{t('newConversation.title')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] px-4 pt-10">
          {/* To: picker */}
          <div ref={pickerRef} className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-3 py-2 shadow-card">
              <span className="text-[12px] font-medium text-text-muted">{t('newConversation.to')}</span>
              {pickerOpen ? (
                <input
                  ref={pickerInputRef}
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (filteredTargets[0] || filteredContacts[0])) {
                      e.preventDefault()
                      if (filteredTargets[0]) choose(filteredTargets[0])
                      else if (filteredContacts[0]) {
                        navigate(composeEmailPath({ to: filteredContacts[0].address }))
                      }
                    }
                    if (e.key === 'Escape') setPickerOpen(false)
                  }}
                  placeholder={t('newConversation.searchPlaceholder')}
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
                      <Loader2 size={12} className="animate-spin" /> {t('newConversation.loading')}
                    </span>
                  ) : selected ? (
                    <>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-ai/25 bg-ai/10 text-ai-ink">
                        <Bot size={11} />
                      </span>
                      <span className="truncate text-[13px] text-text-primary">{selected.name}</span>
                      {selected.kind === 'company' ? (
                        <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated px-1.5 py-px text-[10px] text-text-muted">
                          {t('newConversation.companyAgent')}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-ai/25 bg-ai/10 px-1.5 py-px text-[10px] text-ai-ink">
                          {t('newConversation.myAssistant')}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[13px] text-text-muted">{t('newConversation.chooseRecipient')}</span>
                  )}
                  <ChevronDown size={13} className="ml-auto shrink-0 text-text-muted" />
                </button>
              )}
            </div>

            {pickerOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-xl">
                <div className="max-h-[300px] overflow-y-auto p-1">
                  {filteredTargets.length === 0 && filteredContacts.length === 0 ? (
                    <div className="px-3 py-2.5">
                      <p className="text-[12px] text-text-muted">
                        {targets.length === 0 && contacts.length === 0
                          ? t('newConversation.noAgents')
                          : t('newConversation.noMatches')}
                      </p>
                      {targets.length === 0 ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          <Link to="/agents" className="inline-block text-[11px] font-medium text-accent hover:underline">
                            {t('newConversation.openAgents')}
                          </Link>
                          <Link to="/knowledge" className="inline-block text-[11px] font-medium text-accent hover:underline">
                            {t('newConversation.openKnowledge')}
                          </Link>
                          <Link to="/settings/setup" className="inline-block text-[11px] font-medium text-accent hover:underline">
                            {t('newConversation.openSetup')}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      {filteredTargets.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => choose(target)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover/60"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ai/25 bg-ai/10 text-ai-ink">
                            <Bot size={12} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-text-primary">{target.name}</span>
                            <span className="block text-[10.5px] text-text-muted">
                              {target.kind === 'personal'
                                ? t('newConversation.personalAssistant')
                                : t('newConversation.companyAgentRole', { role: agentRoleLabel(target.role, t) })}
                            </span>
                          </span>
                          {selected?.id === target.id ? <Check size={13} className="shrink-0 text-accent" /> : null}
                        </button>
                      ))}
                      {filteredContacts.length > 0 ? (
                        <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          {t('newConversation.people')}
                        </p>
                      ) : null}
                      {filteredContacts.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => navigate(composeEmailPath({ to: contact.address }))}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover/60"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg-elevated text-text-muted">
                            <User size={12} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-text-primary">
                              {humanizeContactName(
                                contact.displayName,
                                contact.address,
                                t('contactPanel.widgetVisitor'),
                              ) || contact.address}
                            </span>
                            <span className="block text-[10.5px] text-text-muted">
                              {t('newConversation.emailContact')} · {contact.address}
                            </span>
                          </span>
                        </button>
                      ))}
                    </>
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
              className="inline-flex items-center gap-1.5 rounded-full border border-ai/25 bg-ai/10 px-2.5 py-1 text-[11.5px] text-ai-ink transition-colors hover:border-ai/40 hover:bg-ai/15"
            >
              <Sparkles size={11} />
              {t('newConversation.messageAnAgent')}
            </button>
            <button
              type="button"
              onClick={() => openPicker('people')}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              <User size={11} />
              {t('newConversation.writeToPerson')}
            </button>
            <Link
              to={composeEmailPath()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              <Mail size={11} />
              {t('newConversation.writeEmail')}
            </Link>
          </div>

          {/* Composer */}
          <div className="mt-6">
            {error ? <p className="mb-2 px-1 text-[12px] text-status-error">{error}</p> : null}
            <ComposerCard
              ref={composerRef}
              mode="chat"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={
                selected
                  ? t('newConversation.messageName', { name: selected.name })
                  : t('newConversation.chooseAndType')
              }
              className="border-border/60 bg-bg-surface"
            >
              <button
                type="button"
                onClick={() => void start()}
                disabled={!draft.trim() || !selected || sending}
                title={t('newConversation.send')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </button>
            </ComposerCard>
            <p className="mt-1.5 px-1 text-[10.5px] text-text-muted">
              {t('composer.hintChat')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
