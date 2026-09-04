import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  Mail,
  User,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useChatSessions } from '../context/ChatSessionsContext'
import {
  bokitoCreateConversation,
  bokitoListChatTargets,
  type ChatTarget,
} from '../lib/signals-api'
import { agentRoleLabel } from '../lib/agent-role-label'
import { lastInboxPath } from '../lib/inbox-prefs'
import { agentChatPath, channelPath } from '../lib/messages-paths'
import { ComposerCard } from '../components/ui/ComposerCard'
import { canComposeToAddress } from '../lib/compose-intent'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { isSendableMailbox, sendNewEmail } from '../lib/email-api'
import { readLastChatTarget, writeLastChatTarget } from '../lib/last-chat-target'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { humanizeContactName } from '../lib/contact-label'
import { AiAvatar } from '../components/ui/AiAvatar'
import { useMembers } from '../hooks/useMembers'
import { useMentionDraft } from '../hooks/useMentionDraft'
import MentionPopover from '../components/inbox/MentionPopover'
import { MentionHighlight } from '../components/inbox/MentionHighlight'
import type { MentionItem } from '../lib/mentions'
import {
  fetchOutboundConnectionId,
  readLocalOutboundConnectionId,
  resolveOutboundConnectionId,
  saveOutboundConnectionId,
} from '../lib/outbound-channel-pref'
import { cn } from '../lib/utils'

type Intent = 'contact' | 'agent' | 'teammate'

function parseIntent(raw: string | null): Intent | null {
  if (raw === 'contact' || raw === 'agent' || raw === 'teammate') return raw
  return null
}

/**
 * Draft "New conversation" surface inside Communication.
 * Intent first (Contact / Agent / Teammate); thread is created only on send.
 */
export default function NewConversationPage() {
  const { t } = useTranslation(['communication', 'nav'])
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { refresh: refreshSessions } = useChatSessions()
  const { activeConnections } = useMailboxConnections()
  const sendableMailboxes = useMemo(
    () => activeConnections.filter(isSendableMailbox),
    [activeConnections],
  )
  const canSendEmail = sendableMailboxes.length > 0

  const intent = parseIntent(searchParams.get('intent'))
  const agentParam = searchParams.get('agent')?.trim() || ''
  const toParam = searchParams.get('to')?.trim() || ''
  const subjectParam = searchParams.get('subject')?.trim() || ''
  const bodyParam = searchParams.get('body')?.trim() || ''
  const connectionParam = searchParams.get('connectionId')?.trim() || ''
  const memberParam = searchParams.get('member')?.trim() || ''
  const autoSendRequested = useRef(searchParams.get('autosend') === '1')

  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<ChatTarget | null>(null)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')
  const [toAddress, setToAddress] = useState(toParam)
  const [toQuery, setToQuery] = useState('')
  const [toPickerOpen, setToPickerOpen] = useState(false)
  const [subject, setSubject] = useState(subjectParam)
  const [connectionId, setConnectionId] = useState<number | null>(
    connectionParam ? Number(connectionParam) || null : readLocalOutboundConnectionId(),
  )
  const [rememberFrom, setRememberFrom] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(memberParam || null)

  const { members } = useMembers()
  const selfEmail = (user?.email || '').trim().toLowerCase()
  const teammateOptions = useMemo(
    () =>
      members.filter((m) => {
        const email = (m.email || '').trim().toLowerCase()
        if (!email || !email.includes('@')) return false
        if (selfEmail && email === selfEmail) return false
        return true
      }),
    [members, selfEmail],
  )

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
    initialRaw: searchParams.get('prefill') ?? bodyParam,
    items: mentionItems,
  })
  const composerRef = mention.textareaRef
  const agentPickerRef = useRef<HTMLDivElement>(null)
  const toPickerRef = useRef<HTMLDivElement>(null)

  const setIntent = useCallback(
    (next: Intent | null, extra?: Record<string, string>) => {
      const params = new URLSearchParams()
      if (next) params.set('intent', next)
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (v) params.set(k, v)
        }
      }
      setSearchParams(params, { replace: true })
    },
    [setSearchParams],
  )

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
      const last = readLastChatTarget()
      const defaultId = data.default_agent_id
      const preselect =
        data.items.find((row) => row.id === agentParam) ??
        (intent === 'agent'
          ? data.items.find((row) => row.id === last) ??
            (defaultId ? data.items.find((row) => row.id === defaultId) : undefined)
          : undefined) ??
        null
      setSelectedAgent(preselect ?? null)
    } catch {
      setLoadFailed(true)
      setError(t('newConversation.loadError'))
    } finally {
      setLoadingTargets(false)
    }
  }, [token, t, agentParam, intent])

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchOutboundConnectionId(token)
      .then((id) => {
        if (cancelled || connectionParam) return
        setConnectionId((prev) => prev ?? id)
      })
      .catch(() => {
        /* local fallback already applied */
      })
    return () => {
      cancelled = true
    }
  }, [token, connectionParam])

  useEffect(() => {
    if (connectionParam) {
      const n = Number(connectionParam)
      if (Number.isFinite(n) && n > 0) setConnectionId(n)
      return
    }
    const resolved = resolveOutboundConnectionId(
      sendableMailboxes.map((c) => c.id),
      connectionId ?? readLocalOutboundConnectionId(),
    )
    if (resolved != null && resolved !== connectionId) setConnectionId(resolved)
  }, [sendableMailboxes, connectionParam]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (toParam) setToAddress(toParam)
  }, [toParam])

  useEffect(() => {
    if (!memberParam || !teammateOptions.length) return
    const member = teammateOptions.find((m) => String(m.id) === memberParam || m.uuid === memberParam)
    if (member?.email) {
      setSelectedMemberId(String(member.id))
      setToAddress(member.email)
    }
  }, [memberParam, teammateOptions])

  useEffect(() => {
    if (!intent) return
    window.setTimeout(() => composerRef.current?.focus(), 40)
  }, [intent, loadingTargets])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (agentPickerOpen || toPickerOpen) {
        setAgentPickerOpen(false)
        setToPickerOpen(false)
        return
      }
      if (mention.raw.trim() || toAddress.trim() || subject.trim()) return
      event.preventDefault()
      if (intent) setIntent(null)
      else navigate(lastInboxPath())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agentPickerOpen, toPickerOpen, mention.raw, toAddress, subject, intent, setIntent, navigate])

  useEffect(() => {
    if (!agentPickerOpen && !toPickerOpen) return
    const onClick = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setAgentPickerOpen(false)
      }
      if (toPickerRef.current && !toPickerRef.current.contains(e.target as Node)) {
        setToPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [agentPickerOpen, toPickerOpen])

  const filteredAgents = useMemo(() => {
    const q = agentQuery.trim().toLowerCase()
    return targets.filter((row) => !q || row.name.toLowerCase().includes(q))
  }, [targets, agentQuery])

  const matchingContacts = useMemo(() => {
    const q = (toPickerOpen ? toQuery : toAddress).trim().toLowerCase()
    return contacts
      .filter((contact) => canComposeToAddress(contact.channel, contact.address))
      .filter((contact) => {
        if (!q) return true
        return `${contact.displayName} ${contact.address}`.toLowerCase().includes(q)
      })
      .slice(0, 8)
  }, [contacts, toAddress, toQuery, toPickerOpen])

  const directEmailQuery = useMemo(() => {
    const q = (toPickerOpen ? toQuery : toAddress).trim()
    if (!canComposeToAddress('email', q)) return null
    const exists = contacts.some((c) => c.address.trim().toLowerCase() === q.toLowerCase())
    return exists ? null : q
  }, [toAddress, toQuery, toPickerOpen, contacts])

  const chooseAgent = (target: ChatTarget) => {
    writeLastChatTarget(target.id)
    setSelectedAgent(target)
    setAgentPickerOpen(false)
    setIntent('agent', { agent: target.id })
    composerRef.current?.focus()
  }

  const chooseContactAddress = (address: string) => {
    setToAddress(address.trim())
    setToQuery('')
    setToPickerOpen(false)
    composerRef.current?.focus()
  }

  const chooseTeammate = (memberId: string, email: string) => {
    setSelectedMemberId(memberId)
    setToAddress(email)
    setIntent('teammate', { member: memberId, to: email })
  }

  const onFromChange = (nextId: number) => {
    setConnectionId(nextId)
    if (rememberFrom && token) {
      void saveOutboundConnectionId(token, nextId).catch(() => {
        /* keep local */
      })
    } else {
      // Session-only switch for this draft; still keep local paint for next open
      // unless the user unchecked remember — then only update local when they send.
    }
  }

  const canSendContact =
    canSendEmail &&
    connectionId != null &&
    canComposeToAddress('email', toAddress) &&
    mention.raw.trim().length > 0

  const canSendAgent = Boolean(selectedAgent && mention.raw.trim())
  const canSendTeammate = canSendContact

  const startAgent = useCallback(async () => {
    const content = mention.raw.trim()
    if (!content || !token || !selectedAgent || sending) return
    setSending(true)
    setError(null)
    try {
      const created = await bokitoCreateConversation(token, content.slice(0, 60), selectedAgent.id)
      void refreshSessions()
      navigate(agentChatPath(selectedAgent.id, created.id), { state: { autoSend: content } })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('newConversation.startError')
      if (/no agents available/i.test(message)) {
        setError(t('newConversation.noAgentsAvailableForUser'))
      } else {
        setError(message)
      }
      setSending(false)
    }
  }, [mention.raw, token, selectedAgent, sending, navigate, refreshSessions, t])

  const startOutboundEmail = useCallback(async () => {
    const content = mention.raw.trim()
    const to = toAddress.trim()
    if (!token || !canComposeToAddress('email', to) || !content || connectionId == null || sending) return
    setSending(true)
    setError(null)
    try {
      if (rememberFrom) {
        void saveOutboundConnectionId(token, connectionId).catch(() => undefined)
      }
      const result = await sendNewEmail(token, {
        toAddresses: to,
        subject: subject.trim() || t('compose.noSubject'),
        bodyText: content,
        connectionId,
      })
      navigate(channelPath('email', { connectionId, queue: 'open', threadId: result.threadId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newConversation.startError'))
      setSending(false)
    }
  }, [mention.raw, toAddress, token, connectionId, sending, rememberFrom, subject, navigate, t])

  const start = useCallback(async () => {
    if (intent === 'agent') return startAgent()
    if (intent === 'contact' || intent === 'teammate') return startOutboundEmail()
  }, [intent, startAgent, startOutboundEmail])

  useEffect(() => {
    if (!autoSendRequested.current || intent !== 'agent') return
    if (loadingTargets || !selectedAgent || !mention.raw.trim()) return
    autoSendRequested.current = false
    void startAgent()
  }, [loadingTargets, selectedAgent, mention.raw, intent, startAgent])

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    mention.onKeyDown(e, () => void start())
  }

  const noAgents = !loadingTargets && targets.length === 0 && intent === 'agent'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/40 px-4">
        <button
          type="button"
          onClick={() => (intent ? setIntent(null) : navigate(lastInboxPath()))}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={13} />
          {intent ? t('newConversation.changeType') : t('newConversation.back')}
        </button>
        <p className="text-[13px] font-medium text-text-primary">
          {intent === 'contact'
            ? t('newConversation.draftContact')
            : intent === 'agent'
              ? t('newConversation.draftAgent')
              : intent === 'teammate'
                ? t('newConversation.draftTeammate')
                : t('newConversation.title')}
        </p>
        <span className="rounded-md border border-border/50 bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          {t('newConversation.draftBadge')}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 pt-8 pb-10">
          {!intent ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-lg font-semibold text-text-primary">{t('newConversation.pickTitle')}</h1>
                <p className="mt-1 text-sm text-text-muted">{t('newConversation.pickHint')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <IntentCard
                  icon={<Mail size={22} />}
                  title={t('newConversation.intentContact')}
                  hint={t('newConversation.intentContactHint')}
                  disabled={!canSendEmail}
                  onClick={() => setIntent('contact')}
                />
                <IntentCard
                  icon={<Bot size={22} />}
                  title={t('newConversation.intentAgent')}
                  hint={t('newConversation.intentAgentHint')}
                  onClick={() => setIntent('agent')}
                />
                <IntentCard
                  icon={<Users size={22} />}
                  title={t('newConversation.intentTeammate')}
                  hint={t('newConversation.intentTeammateHint')}
                  disabled={!canSendEmail || teammateOptions.length === 0}
                  onClick={() => setIntent('teammate')}
                />
              </div>
              {!canSendEmail ? (
                <p className="text-[12px] text-text-muted">
                  {t('newConversation.connectMailboxHint')}{' '}
                  <Link to="/settings/channels" className="font-medium text-accent hover:underline">
                    {t('newConversation.connectMailbox')}
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}

          {intent === 'contact' || intent === 'teammate' ? (
            <div className="space-y-3">
              {intent === 'teammate' ? (
                <div className="space-y-1.5">
                  <p className="text-[12px] font-medium text-text-muted">{t('newConversation.teammate')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {teammateOptions.map((member) => {
                      const active = selectedMemberId === String(member.id)
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => chooseTeammate(String(member.id), member.email)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]',
                            active
                              ? 'border-accent/40 bg-accent/10 text-text-heading'
                              : 'border-border/60 text-text-secondary hover:border-accent/30 hover:text-text-primary',
                          )}
                        >
                          <User size={12} />
                          {member.name || member.email}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div ref={toPickerRef} className="relative">
                  <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-3 py-2 shadow-card">
                    <span className="text-[12px] font-medium text-text-muted">{t('newConversation.to')}</span>
                    {toPickerOpen ? (
                      <input
                        value={toQuery}
                        onChange={(e) => setToQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (matchingContacts[0]) chooseContactAddress(matchingContacts[0].address)
                            else if (directEmailQuery) chooseContactAddress(directEmailQuery)
                          }
                          if (e.key === 'Escape') setToPickerOpen(false)
                        }}
                        placeholder={t('newConversation.searchContacts')}
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setToQuery(toAddress)
                          setToPickerOpen(true)
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {toAddress ? (
                          <span className="truncate text-[13px] text-text-primary">{toAddress}</span>
                        ) : (
                          <span className="text-[13px] text-text-muted">{t('newConversation.chooseContact')}</span>
                        )}
                        <ChevronDown size={13} className="ml-auto shrink-0 text-text-muted" />
                      </button>
                    )}
                  </div>
                  {toPickerOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-xl">
                      <div className="max-h-[280px] overflow-y-auto p-1">
                        {matchingContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => chooseContactAddress(contact.address)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg-hover/60"
                          >
                            <User size={14} className="shrink-0 text-text-muted" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] text-text-primary">
                                {humanizeContactName(
                                  contact.displayName,
                                  contact.address,
                                  t('contactPanel.widgetVisitor'),
                                ) || contact.address}
                              </span>
                              <span className="block text-[10.5px] text-text-muted">{contact.address}</span>
                            </span>
                          </button>
                        ))}
                        {directEmailQuery ? (
                          <button
                            type="button"
                            onClick={() => chooseContactAddress(directEmailQuery)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg-hover/60"
                          >
                            <Mail size={14} className="shrink-0 text-text-muted" />
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
                        {!matchingContacts.length && !directEmailQuery ? (
                          <p className="px-3 py-2.5 text-[12px] text-text-muted">{t('newConversation.noMatches')}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-3 py-2 shadow-card">
                <span className="text-[12px] font-medium text-text-muted">{t('newConversation.from')}</span>
                {!canSendEmail ? (
                  <Link to="/settings/channels" className="text-[13px] font-medium text-accent hover:underline">
                    {t('newConversation.connectMailbox')}
                  </Link>
                ) : sendableMailboxes.length === 1 ? (
                  <span className="truncate text-[13px] text-text-primary">{sendableMailboxes[0].mailboxEmail}</span>
                ) : (
                  <select
                    value={connectionId ?? ''}
                    onChange={(e) => onFromChange(Number(e.target.value))}
                    className="min-w-0 flex-1 rounded-md border border-border/50 bg-bg-input px-2 py-1 text-[13px] text-text-primary"
                  >
                    {sendableMailboxes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.mailboxEmail}
                      </option>
                    ))}
                  </select>
                )}
                {canSendEmail && sendableMailboxes.length > 1 ? (
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted">
                    <input
                      type="checkbox"
                      checked={rememberFrom}
                      onChange={(e) => setRememberFrom(e.target.checked)}
                      className="rounded border-border"
                    />
                    {t('newConversation.rememberFrom')}
                  </label>
                ) : null}
              </div>

              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t('newConversation.subjectPlaceholder')}
                className="w-full rounded-xl border border-border/60 bg-bg-surface px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted shadow-card focus:border-border-focus focus:outline-none"
              />
            </div>
          ) : null}

          {intent === 'agent' ? (
            <div ref={agentPickerRef} className="relative">
              {noAgents ? (
                <div className="rounded-xl border border-border/60 bg-bg-surface px-5 py-8 text-center shadow-card">
                  <Bot size={28} className="mx-auto text-text-muted" />
                  <p className="mt-3 text-[15px] font-medium text-text-primary">
                    {t('newConversation.noAgentsAvailable')}
                  </p>
                  <Link to="/agents" className="mt-3 inline-block text-[12px] font-medium text-accent hover:underline">
                    {t('newConversation.openAgents')}
                  </Link>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-bg-surface px-3 py-2 shadow-card">
                  <span className="text-[12px] font-medium text-text-muted">{t('newConversation.to')}</span>
                  {agentPickerOpen ? (
                    <input
                      value={agentQuery}
                      onChange={(e) => setAgentQuery(e.target.value)}
                      placeholder={t('newConversation.searchAgents')}
                      className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAgentQuery('')
                        setAgentPickerOpen(true)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {loadingTargets ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-text-muted">
                          <Loader2 size={12} className="animate-spin" /> {t('newConversation.loading')}
                        </span>
                      ) : selectedAgent ? (
                        <>
                          <AiAvatar
                            name={selectedAgent.name}
                            seed={selectedAgent.id}
                            size={20}
                            kind={selectedAgent.avatar_kind}
                            icon={selectedAgent.avatar_icon}
                            color={selectedAgent.avatar_color}
                            imageUrl={selectedAgent.avatar_image_url}
                          />
                          <span className="truncate text-[13px] text-text-primary">{selectedAgent.name}</span>
                        </>
                      ) : (
                        <span className="text-[13px] text-text-muted">{t('newConversation.chooseRecipient')}</span>
                      )}
                      <ChevronDown size={13} className="ml-auto shrink-0 text-text-muted" />
                    </button>
                  )}
                </div>
              )}
              {agentPickerOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-xl">
                  <div className="max-h-[280px] overflow-y-auto p-1">
                    {filteredAgents.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => chooseAgent(target)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg-hover/60"
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
                          <span className="block truncate text-[12.5px] text-text-primary">{target.name}</span>
                          <span className="block text-[10.5px] text-text-muted">
                            {t('newConversation.companyAgentRole', { role: agentRoleLabel(target.role, t) })}
                          </span>
                        </span>
                        {selectedAgent?.id === target.id ? <Check size={13} className="text-accent" /> : null}
                      </button>
                    ))}
                    {!filteredAgents.length ? (
                      <p className="px-3 py-2.5 text-[12px] text-text-muted">{t('newConversation.noMatches')}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {intent && !(intent === 'agent' && noAgents) ? (
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
              <p className="mb-2 px-1 text-[11px] text-text-muted">{t('newConversation.draftHint')}</p>
              <ComposerCard
                ref={composerRef}
                mode={intent === 'agent' ? 'chat' : 'email'}
                value={mention.display}
                onChange={(e) =>
                  mention.onChange(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart ?? e.currentTarget.value.length,
                  )
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
                  intent === 'agent'
                    ? selectedAgent
                      ? t('newConversation.messageName', { name: selectedAgent.name })
                      : t('newConversation.chooseAndType')
                    : t('newConversation.writeMessage')
                }
                className="border-border/60 bg-bg-surface"
              >
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={
                    sending ||
                    (intent === 'agent' ? !canSendAgent : intent === 'teammate' ? !canSendTeammate : !canSendContact)
                  }
                  title={t('newConversation.send')}
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

function IntentCard({
  icon,
  title,
  hint,
  onClick,
  disabled,
}: {
  icon: ReactNode
  title: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border border-border/60 bg-bg-surface p-4 text-left shadow-card transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:border-accent/40 hover:bg-bg-hover/40',
      )}
    >
      <span className="text-accent">{icon}</span>
      <span className="text-[14px] font-semibold text-text-primary">{title}</span>
      <span className="text-[12px] leading-snug text-text-muted">{hint}</span>
    </button>
  )
}
