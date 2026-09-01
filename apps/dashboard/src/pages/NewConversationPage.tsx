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
} from '../lib/signals-api'
import { agentRoleLabel } from '../lib/agent-role-label'
import { lastInboxPath } from '../lib/inbox-prefs'
import { agentChatPath } from '../lib/messages-paths'
import { ComposerCard } from '../components/ui/ComposerCard'
import { canComposeToAddress, composeEmailPath } from '../lib/compose-intent'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { readLastChatTarget, writeLastChatTarget } from '../lib/last-chat-target'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { humanizeContactName } from '../lib/contact-label'
import { AiAvatar } from '../components/ui/AiAvatar'
import { useMembers } from '../hooks/useMembers'
import { useMentionDraft } from '../hooks/useMentionDraft'
import MentionPopover from '../components/inbox/MentionPopover'
import { MentionHighlight } from '../components/inbox/MentionHighlight'
import type { MentionItem } from '../lib/mentions'

type PickerFilter = 'all' | 'company' | 'people'

/**
 * Composer-first "New conversation" surface: pick a company agent (or email a
 * person), type, and Enter starts the chat. An agent must be chosen explicitly;
 * `default_agent_id` may preselect when it is in the permitted list.
 */
export default function NewConversationPage() {
  const { t } = useTranslation(['communication', 'nav'])
  const { token } = useAuth()
  const navigate = useNavigate()
  const { activeConnections } = useMailboxConnections()
  const canSendEmail = activeConnections.length > 0
  const [searchParams] = useSearchParams()
  const { refresh: refreshSessions } = useChatSessions()

  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selected, setSelected] = useState<ChatTarget | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerFilter, setPickerFilter] = useState<PickerFilter>('all')
  // Seed the composer from a ?prefill= query (e.g. "Ask assistant" from a
  // customer thread). Read once on mount so user edits are never overwritten.
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ?autosend=1 (first-run tour setup chat): fire the prefilled message as
  // soon as the default recipient is resolved, once.
  const autoSendRequested = useRef(searchParams.get('autosend') === '1')
  const { members } = useMembers()
  const mentionItems = useMemo<MentionItem[]>(
    () => [
      ...members.map((member) => ({
        type: 'user' as const,
        id: String(member.id),
        name: member.name,
        email: member.email,
        avatarUrl: member.avatarUrl,
      })),
      ...targets.map((target) => ({
        type: 'agent' as const,
        id: target.id,
        name: target.name,
      })),
    ],
    [members, targets],
  )
  const mention = useMentionDraft({
    initialRaw: searchParams.get('prefill') ?? '',
    items: mentionItems,
  })
  const composerRef = mention.textareaRef
  const pickerInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const loadTargets = useCallback(async () => {
    if (!token) return
    setLoadingTargets(true)
    setLoadFailed(false)
    setError(null)
    try {
      const [data, people] = await Promise.all([
        bokitoListChatTargets(token),
        listContacts(token).catch(() => [] as ContactRow[]),
      ])
      setTargets(data.items)
      setContacts(people)
      const agentParam = searchParams.get('agent')?.trim()
      const last = readLastChatTarget()
      const defaultId = data.default_agent_id
      const preselect =
        data.items.find((row) => row.id === agentParam) ??
        data.items.find((row) => row.id === last) ??
        (defaultId ? data.items.find((row) => row.id === defaultId) : undefined) ??
        null
      setSelected(preselect)
    } catch {
      setLoadFailed(true)
      setError(t('newConversation.loadError'))
    } finally {
      setLoadingTargets(false)
    }
  }, [token, t, searchParams])

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  useEffect(() => {
    const to = searchParams.get('to')?.trim()
    if (to && canComposeToAddress('email', to)) {
      navigate(composeEmailPath({ to }), { replace: true })
    }
  }, [searchParams, navigate])

  useEffect(() => {
    composerRef.current?.focus()
  }, [loadingTargets])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pickerOpen) return
      if (mention.raw.trim()) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.value.trim()) return
      }
      event.preventDefault()
      navigate(lastInboxPath())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerOpen, mention.raw, navigate])

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
    return targets.filter((row) => {
      if (pickerFilter === 'people') return false
      if (q && !row.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [targets, pickerQuery, pickerFilter])

  const matchingContacts = useMemo(() => {
    if (!canSendEmail) return []
    const q = pickerQuery.trim().toLowerCase()
    return contacts
      .filter((contact) => canComposeToAddress(contact.channel, contact.address))
      .filter((contact) => {
        if (pickerFilter === 'company') return false
        if (!q) return pickerFilter === 'people' || pickerFilter === 'all'
        const name = `${contact.displayName} ${contact.address}`.toLowerCase()
        return name.includes(q)
      })
  }, [canSendEmail, contacts, pickerQuery, pickerFilter])
  const filteredContacts = matchingContacts.slice(0, 8)

  const targetLabel = (target: ChatTarget) => target.name

  const directEmailQuery = useMemo(() => {
    if (!canSendEmail) return null
    const q = pickerQuery.trim()
    if (pickerFilter === 'company') return null
    if (!canComposeToAddress('email', q)) return null
    const exists = contacts.some((c) => c.address.trim().toLowerCase() === q.toLowerCase())
    return exists ? null : q
  }, [canSendEmail, pickerQuery, pickerFilter, contacts])

  const openPicker = (filter: PickerFilter = 'all') => {
    setPickerFilter(filter)
    setPickerQuery('')
    setPickerOpen(true)
    window.setTimeout(() => pickerInputRef.current?.focus(), 0)
  }

  const choose = (target: ChatTarget) => {
    writeLastChatTarget(target.id)
    setSelected(target)
    setPickerOpen(false)
    composerRef.current?.focus()
  }

  const start = useCallback(async () => {
    const content = mention.raw.trim()
    if (!content || !token || !selected || sending) return
    setSending(true)
    setError(null)
    try {
      const created = await bokitoCreateConversation(token, content.slice(0, 60), selected.id)
      void refreshSessions()
      navigate(agentChatPath(selected.id, created.id), { state: { autoSend: content } })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('newConversation.startError')
      if (/no agents available/i.test(message)) {
        setError(t('newConversation.noAgentsAvailableForUser'))
      } else {
        setError(message)
      }
      setSending(false)
    }
  }, [mention.raw, token, selected, sending, navigate, refreshSessions, t])

  useEffect(() => {
    if (!autoSendRequested.current || loadingTargets || !selected || !mention.raw.trim()) return
    autoSendRequested.current = false
    void start()
  }, [loadingTargets, selected, mention.raw, start])

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    mention.onKeyDown(e, () => void start())
  }

  const noAgents = !loadingTargets && targets.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/40 px-4">
        <Link
          to={lastInboxPath()}
          className="text-[12px] font-medium text-text-muted hover:text-text-primary"
        >
          {t('newConversation.back')}
        </Link>
        <p className="text-[13px] font-medium text-text-primary">{t('newConversation.title')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] px-4 pt-10">
          {noAgents ? (
            <div className="rounded-xl border border-border/60 bg-bg-surface px-5 py-8 text-center shadow-card">
              <Bot size={28} className="mx-auto text-text-muted" />
              <p className="mt-3 text-[15px] font-medium text-text-primary">
                {t('newConversation.noAgentsAvailable')}
              </p>
              <p className="mt-1.5 text-[12.5px] text-text-muted">
                {t('newConversation.noAgentsAvailableForUser')}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
                <Link to="/agents" className="text-[12px] font-medium text-accent hover:underline">
                  {t('newConversation.openAgents')}
                </Link>
                <Link to="/docs/ai/agents" className="text-[12px] font-medium text-accent hover:underline">
                  {t('pageGuides.learnMore', { ns: 'nav' })}
                </Link>
              </div>
            </div>
          ) : null}

          {/* To: picker */}
          {!noAgents ? (
          <div ref={pickerRef} className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-3 py-2 shadow-card">
              <span className="text-[12px] font-medium text-text-muted" title={t('newConversation.toHint')}>{t('newConversation.to')}</span>
              {pickerOpen ? (
                <input
                  ref={pickerInputRef}
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (filteredTargets[0] || filteredContacts[0] || directEmailQuery)) {
                      e.preventDefault()
                      if (filteredTargets[0]) choose(filteredTargets[0])
                      else if (filteredContacts[0]) {
                        navigate(composeEmailPath({ to: filteredContacts[0].address }))
                      } else if (directEmailQuery) {
                        navigate(composeEmailPath({ to: directEmailQuery }))
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
                      <AiAvatar
                        name={selected.name}
                        seed={selected.id}
                        size={20}
                        kind={selected.avatar_kind}
                        icon={selected.avatar_icon}
                        color={selected.avatar_color}
                        imageUrl={selected.avatar_image_url}
                      />
                      <span className="truncate text-[13px] text-text-primary">{targetLabel(selected)}</span>
                      <span className="shrink-0 rounded-full border border-border/60 bg-bg-elevated px-1.5 py-px text-[10px] text-text-muted">
                        {t('newConversation.companyAgent')}
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-text-muted">{t('newConversation.chooseRecipient')}</span>
                  )}
                  <ChevronDown size={13} className="ml-auto shrink-0 text-text-muted" />
                </button>
              )}
            </div>
            {!pickerOpen && !selected ? (
              <p className="mt-1.5 px-1 text-[11px] text-text-muted">{t('newConversation.toHint')}</p>
            ) : null}

            {pickerOpen ? (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-xl">
                <div className="max-h-[300px] overflow-y-auto p-1">
                  {filteredTargets.length === 0 && filteredContacts.length === 0 && !directEmailQuery ? (
                    <div className="px-3 py-2.5">
                      <p className="text-[12px] text-text-muted">
                        {targets.length === 0
                          ? t('newConversation.noAgentsAvailable')
                          : t('newConversation.noMatches')}
                      </p>
                      {targets.length === 0 ? (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          <Link to="/agents" className="inline-block text-[11px] font-medium text-accent hover:underline">
                            {t('newConversation.openAgents')}
                          </Link>
                          <Link to="/docs/ai/agents" className="inline-block text-[11px] font-medium text-accent hover:underline">
                            {t('pageGuides.learnMore', { ns: 'nav' })}
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
                          <AiAvatar
                            name={target.name}
                            seed={target.id}
                            size={24}
                            kind={target.avatar_kind}
                            icon={target.avatar_icon}
                            color={target.avatar_color}
                            imageUrl={target.avatar_image_url}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-text-primary">{targetLabel(target)}</span>
                            <span className="block text-[10.5px] text-text-muted">
                              {t('newConversation.companyAgentRole', { role: agentRoleLabel(target.role, t) })}
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
                      {directEmailQuery ? (
                        <button
                          type="button"
                          onClick={() => navigate(composeEmailPath({ to: directEmailQuery }))}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover/60"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-bg-elevated text-text-muted">
                            <Mail size={12} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-text-primary">
                              {t('newConversation.emailAddressDirect', { address: directEmailQuery })}
                            </span>
                            <span className="block text-[10.5px] text-text-muted">
                              {t('newConversation.emailAddressDirectHint')}
                            </span>
                          </span>
                        </button>
                      ) : null}
                      {matchingContacts.length > 8 ? (
                        <Link
                          to="/contacts"
                          className="mt-1 block px-2.5 pb-2 text-[11px] font-medium text-accent hover:underline"
                        >
                          {t('newConversation.openContacts')}
                        </Link>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          ) : null}

          {/* Quick chips */}
          {!noAgents ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Link
              to={canSendEmail ? composeEmailPath() : '/settings/channels'}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              <Mail size={11} />
              {canSendEmail ? t('newConversation.emailACustomer') : t('newConversation.connectMailbox')}
            </Link>
            <button
              type="button"
              onClick={() => openPicker('company')}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
            >
              <Sparkles size={11} />
              {t('newConversation.messageAnAgent')}
            </button>
            {canSendEmail ? (
              <button
                type="button"
                onClick={() => openPicker('people')}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
              >
                <User size={11} />
                {t('newConversation.writeToPerson')}
              </button>
            ) : null}
          </div>
          ) : null}

          {/* Composer */}
          {!noAgents ? (
          <div className="mt-6">
            {error ? (
              <div className="mb-2 flex items-center gap-2 px-1">
                <p className="text-[12px] text-status-error">{error}</p>
                {loadFailed ? (
                  <button
                    type="button"
                    className="text-[12px] font-medium text-accent hover:underline"
                    onClick={() => void loadTargets()}
                  >
                    {t('newConversation.retry')}
                  </button>
                ) : null}
              </div>
            ) : null}
            <ComposerCard
              ref={composerRef}
              mode="chat"
              value={mention.display}
              onChange={(e) =>
                mention.onChange(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)
              }
              onClick={(e) =>
                mention.refreshMentionState(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                )
              }
              onKeyDown={onComposerKeyDown}
              highlighter={<MentionHighlight raw={mention.raw} />}
              overlay={
                mention.mentionOpen ? (
                  <MentionPopover
                    items={mention.mentionMatches}
                    activeIndex={mention.mentionIndex}
                    onSelect={mention.selectMention}
                    onHover={mention.setMentionIndex}
                  />
                ) : null
              }
              placeholder={
                selected
                  ? t('newConversation.messageName', { name: targetLabel(selected) })
                  : t('newConversation.chooseAndType')
              }
              className="border-border/60 bg-bg-surface"
            >
              <button
                type="button"
                onClick={() => void start()}
                disabled={!mention.raw.trim() || !selected || sending}
                title={`${t('newConversation.send')} — ${t('composer.hintChat')}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </button>
            </ComposerCard>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
