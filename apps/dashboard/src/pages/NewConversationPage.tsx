import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Hash,
  Loader2,
  Mail,
  User,
  X as XIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useChatSessions } from '../context/ChatSessionsContext'
import {
  bokitoCreateConversation,
  bokitoListChatTargets,
  startConversation,
  type ChatTarget,
} from '../lib/signals-api'
import { agentRoleLabel } from '../lib/agent-role-label'
import { lastInboxPath } from '../lib/inbox-prefs'
import { agentChatPath, channelPath } from '../lib/messages-paths'
import { ComposerCard } from '../components/ui/ComposerCard'
import { canComposeToAddress } from '../lib/compose-intent'
import { useMailboxConnections } from '../hooks/useMailboxConnections'
import { isSendableMailbox, sendNewEmail } from '../lib/email-api'
import MailComposer, {
  type MailRecipientSuggestion,
  type MailSendPayload,
} from '../components/inbox/MailComposer'
import {
  clearStoredMailDraft,
  readStoredMailDraft,
  type StoredMailDraft,
} from '../lib/mail-draft-store'
import type { MailComposerIntent } from '../lib/mail-reply'
import { readLastChatTarget, writeLastChatTarget } from '../lib/last-chat-target'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { humanizeContactName } from '../lib/contact-label'
import { AiAvatar } from '../components/ui/AiAvatar'
import { ChoiceSelect } from '../components/ui/ChoiceSelect'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { BrandMark } from '../components/integrations/BrandMark'
import { listChannelAccounts, type ChannelAccountRow } from '../lib/channel-accounts-api'
import { listCategories, type CategoryRow } from '../lib/tickets-api'
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

type Intent = 'contact' | 'agent' | 'teammate' | 'whatsapp' | 'ticket'

const NO_PROJECT = '__none__'

function parseIntent(raw: string | null): Intent | null {
  if (raw === 'contact' || raw === 'agent' || raw === 'teammate' || raw === 'whatsapp' || raw === 'ticket') {
    return raw
  }
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
  const [connectionId, setConnectionId] = useState<number | null>(
    connectionParam ? Number(connectionParam) || null : readLocalOutboundConnectionId(),
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(memberParam || null)
  const [whatsappAccounts, setWhatsappAccounts] = useState<ChannelAccountRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [whatsappAccountId, setWhatsappAccountId] = useState('')
  const [whatsappTo, setWhatsappTo] = useState('')
  const [whatsappBody, setWhatsappBody] = useState('')
  const [ticketTagId, setTicketTagId] = useState('')
  const [ticketProjectId, setTicketProjectId] = useState('')
  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketNote, setTicketNote] = useState('')
  const [ticketFields, setTicketFields] = useState<Record<string, string>>({})

  // Unsent new-mail draft: the chooser shows it as a resumable chip instead
  // of only a passive "Draft" badge, so the saved mail is one click away.
  const [newMailDraft, setNewMailDraft] = useState<StoredMailDraft | null>(() =>
    readStoredMailDraft('new'),
  )
  useEffect(() => {
    if (!intent) setNewMailDraft(readStoredMailDraft('new'))
  }, [intent])

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
    if (!token) return
    let cancelled = false
    void Promise.all([
      listChannelAccounts(token).catch(() => [] as ChannelAccountRow[]),
      listCategories().catch(() => [] as CategoryRow[]),
    ]).then(([accounts, tags]) => {
      if (cancelled) return
      const ready = accounts.filter((row) => row.channel === 'whatsapp' && row.isEnabled)
      setWhatsappAccounts(ready)
      setWhatsappAccountId((prev) => prev || ready[0]?.id || '')
      setCategories(tags.filter((row) => row.workstream_id))
    })
    return () => {
      cancelled = true
    }
  }, [token])

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
      if (agentPickerOpen) {
        setAgentPickerOpen(false)
        return
      }
      // Email intents: the mail composer handles Esc itself (and autosaves
      // its draft); this listener only fires when it is not focused.
      if (mention.raw.trim() && intent === 'agent') return
      event.preventDefault()
      if (intent) setIntent(null)
      else navigate(lastInboxPath())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agentPickerOpen, mention.raw, intent, setIntent, navigate])

  useEffect(() => {
    if (!agentPickerOpen) return
    const onClick = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setAgentPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [agentPickerOpen])

  const filteredAgents = useMemo(() => {
    const q = agentQuery.trim().toLowerCase()
    return targets.filter((row) => !q || row.name.toLowerCase().includes(q))
  }, [targets, agentQuery])

  // Contact typeahead inside the mail composer's To field.
  const recipientSuggestions = useMemo<MailRecipientSuggestion[]>(() => {
    const rows: MailRecipientSuggestion[] = contacts
      .filter((contact) => canComposeToAddress(contact.channel, contact.address))
      .map((contact) => ({
        label:
          humanizeContactName(
            contact.displayName,
            contact.address,
            t('contactPanel.widgetVisitor'),
          ) || contact.address,
        address: contact.address,
      }))
    const seen = new Set(rows.map((row) => row.address.trim().toLowerCase()))
    for (const member of teammateOptions) {
      const address = member.email.trim()
      if (seen.has(address.toLowerCase())) continue
      seen.add(address.toLowerCase())
      rows.push({ label: member.name || address, address })
    }
    return rows
  }, [contacts, teammateOptions, t])

  const whatsappSuggestions = useMemo(
    () =>
      contacts.filter(
        (contact) => contact.channel === 'whatsapp' || contact.channel === 'phone',
      ),
    [contacts],
  )

  const chooseAgent = (target: ChatTarget) => {
    writeLastChatTarget(target.id)
    setSelectedAgent(target)
    setAgentPickerOpen(false)
    setIntent('agent', { agent: target.id })
    composerRef.current?.focus()
  }

  const chooseTeammate = (memberId: string, email: string) => {
    setSelectedMemberId(memberId)
    setToAddress(email)
    setIntent('teammate', { member: memberId, to: email })
  }

  const canSendAgent = Boolean(selectedAgent && mention.raw.trim())

  const startAgent = useCallback(async () => {
    const content = mention.raw.trim()
    if (!content || !token || !selectedAgent || sending) return
    setSending(true)
    setError(null)
    try {
      const created = await bokitoCreateConversation(token, 'New conversation', selectedAgent.id)
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

  // Send from the embedded mail composer: creates the thread and delivers
  // the mail in one call, then opens the new conversation.
  const handleMailSend = useCallback(
    async (payload: MailSendPayload) => {
      if (!token || sending) return
      setSending(true)
      setError(null)
      try {
        // Map the chosen From mailbox back to its numeric connection id.
        const fromEmail = (payload.fromAddress || '').trim().toLowerCase()
        const connection =
          sendableMailboxes.find((c) => c.mailboxEmail.trim().toLowerCase() === fromEmail) ??
          sendableMailboxes.find((c) => c.id === connectionId) ??
          sendableMailboxes[0]
        if (!connection) throw new Error(t('newConversation.connectMailbox'))
        void saveOutboundConnectionId(token, connection.id).catch(() => undefined)
        const result = await sendNewEmail(token, {
          toAddresses: payload.to,
          subject: payload.subject?.trim() || t('compose.noSubject'),
          bodyText: payload.bodyText,
          cc: payload.cc,
          bcc: payload.bcc,
          attachments: payload.attachments,
          connectionId: connection.id,
        })
        navigate(channelPath(`email:${connection.id}`, { threadId: result.threadId }))
      } finally {
        setSending(false)
      }
    },
    [token, sending, sendableMailboxes, connectionId, navigate, t],
  )

  const selectedCategory = categories.find((row) => row.id === ticketTagId) ?? null
  const ticketNeedsProject = (selectedCategory?.project_choices.length ?? 0) > 0

  const startWhatsapp = useCallback(async () => {
    if (!token || sending) return
    setSending(true)
    setError(null)
    try {
      const result = await startConversation(token, {
        kind: 'whatsapp',
        to: whatsappTo,
        bodyText: whatsappBody,
        channelAccountId: whatsappAccountId || undefined,
      })
      navigate(channelPath('whatsapp', { threadId: result.threadId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newConversation.startError'))
      setSending(false)
    }
  }, [token, sending, whatsappTo, whatsappBody, whatsappAccountId, navigate, t])

  const startTicket = useCallback(async () => {
    if (!token || sending || !selectedCategory) return
    setSending(true)
    setError(null)
    try {
      const projectId =
        !ticketNeedsProject || ticketProjectId === NO_PROJECT ? null : ticketProjectId || null
      const result = await startConversation(token, {
        kind: 'ticket',
        tagId: selectedCategory.id,
        subject: ticketSubject,
        note: ticketNote,
        projectId: ticketNeedsProject ? projectId : null,
        fields: ticketFields,
      })
      navigate(channelPath('internal', { threadId: result.threadId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newConversation.startError'))
      setSending(false)
    }
  }, [
    token,
    sending,
    selectedCategory,
    ticketNeedsProject,
    ticketProjectId,
    ticketSubject,
    ticketNote,
    ticketFields,
    navigate,
    t,
  ])

  const start = useCallback(async () => {
    if (intent === 'agent') return startAgent()
  }, [intent, startAgent])

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

  // Intent for the embedded mail composer; the recipient follows deeplinks
  // (?to=) and teammate chips, the subject follows ?subject=.
  const mailIntent = useMemo<MailComposerIntent>(
    () => ({
      mode: 'new',
      sourceMessageId: '',
      to: toAddress,
      cc: '',
      subject: subjectParam,
      quotedHtml: '',
      quotedPreview: '',
    }),
    [toAddress, subjectParam],
  )
  const defaultFromAddress = useMemo(
    () => sendableMailboxes.find((c) => c.id === connectionId)?.mailboxEmail ?? null,
    [sendableMailboxes, connectionId],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/40 px-4">
        <button
          type="button"
          onClick={() => (intent ? setIntent(null) : navigate(lastInboxPath()))}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={13} />
          {intent ? t('newConversation.changeType') : t('newConversation.back')}
        </button>
        <p className="text-sm font-medium text-text-primary">
          {intent === 'contact' || intent === 'teammate'
            ? t('newConversation.draftContact')
            : intent === 'agent'
              ? t('newConversation.draftAgent')
              : intent === 'whatsapp'
                ? t('newConversation.draftWhatsapp')
                : intent === 'ticket'
                  ? t('newConversation.draftTicket')
                  : t('newConversation.title')}
        </p>
        <span className="rounded-md border border-border/50 bg-bg-elevated px-1.5 py-0.5 text-2xs font-medium text-text-muted">
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
              {newMailDraft ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-bg-surface px-3 py-2">
                  <Mail size={14} className="shrink-0 text-accent" />
                  <button
                    type="button"
                    onClick={() => setIntent('contact')}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate-fade text-xs font-medium text-text-primary">
                      {t('mailComposer.draftChip')}
                      {newMailDraft.to ? ` — ${newMailDraft.to}` : ''}
                    </span>
                    <span className="block truncate-fade text-2xs text-text-muted">
                      {newMailDraft.subject || newMailDraft.body}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIntent('contact')}
                    className="shrink-0 text-xs font-medium text-accent hover:underline"
                  >
                    {t('mailComposer.draftChipResume')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearStoredMailDraft('new')
                      setNewMailDraft(null)
                    }}
                    title={t('mailComposer.draftChipDiscard')}
                    aria-label={t('mailComposer.draftChipDiscard')}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <IntentCard
                  icon={<Mail size={22} />}
                  title={t('newConversation.intentEmail')}
                  hint={t('newConversation.intentEmailHint')}
                  disabled={!canSendEmail}
                  onClick={() => setIntent('contact')}
                />
                {whatsappAccounts.length > 0 ? (
                  <IntentCard
                    icon={<BrandMark slug="whatsapp" size={22} />}
                    title={t('newConversation.intentWhatsapp')}
                    hint={t('newConversation.intentWhatsappHint')}
                    onClick={() => setIntent('whatsapp')}
                  />
                ) : null}
                <IntentCard
                  icon={<Hash size={22} />}
                  title={t('newConversation.intentTicket')}
                  hint={t('newConversation.intentTicketHint')}
                  onClick={() => setIntent('ticket')}
                />
                <IntentCard
                  icon={<Bot size={22} />}
                  title={t('newConversation.intentAgent')}
                  hint={t('newConversation.intentAgentHint')}
                  onClick={() => setIntent('agent')}
                />
              </div>
              {!canSendEmail ? (
                <p className="text-xs text-text-muted">
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
                  <p className="text-xs font-medium text-text-muted">{t('newConversation.teammate')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {teammateOptions.map((member) => {
                      const active = selectedMemberId === String(member.id)
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => chooseTeammate(String(member.id), member.email)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
                            active
                              ? 'border-border-light bg-bg-hover text-text-heading'
                              : 'border-border/60 text-text-secondary hover:border-border-light hover:text-text-primary',
                          )}
                        >
                          <User size={12} />
                          {member.name || member.email}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {!canSendEmail ? (
                <p className="text-xs text-text-muted">
                  {t('newConversation.connectMailboxHint')}{' '}
                  <Link to="/settings/channels" className="font-medium text-accent hover:underline">
                    {t('newConversation.connectMailbox')}
                  </Link>
                </p>
              ) : (
                <>
                  {error ? <p className="px-1 text-xs text-status-error">{error}</p> : null}
                  <p className="px-1 text-xs text-text-muted">{t('newConversation.draftHint')}</p>
                  <MailComposer
                    intent={mailIntent}
                    draftKey="new"
                    defaultFromAddress={defaultFromAddress}
                    recipientSuggestions={recipientSuggestions}
                    initialBody={bodyParam}
                    variant="page"
                    saving={sending}
                    onSend={handleMailSend}
                    onCancel={() => setIntent(null)}
                  />
                </>
              )}
            </div>
          ) : null}

          {intent === 'whatsapp' ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                void startWhatsapp()
              }}
            >
              {whatsappAccounts.length > 1 ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-text-muted">{t('newConversation.from')}</span>
                  <ChoiceSelect
                    aria-label={t('newConversation.from')}
                    value={whatsappAccountId}
                    onValueChange={setWhatsappAccountId}
                    groups={[
                      {
                        items: whatsappAccounts.map((account) => ({
                          value: account.id,
                          label: account.displayName || account.address,
                          kind: 'icon' as const,
                          brandSlug: 'whatsapp',
                        })),
                      },
                    ]}
                  />
                </label>
              ) : null}
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('newConversation.whatsappTo')}</span>
                <Input
                  value={whatsappTo}
                  onChange={(event) => setWhatsappTo(event.target.value)}
                  placeholder={t('newConversation.whatsappToPlaceholder')}
                  inputMode="tel"
                  autoComplete="off"
                  list="whatsapp-contacts"
                />
                <datalist id="whatsapp-contacts">
                  {whatsappSuggestions.map((contact) => (
                    <option key={contact.id} value={contact.address}>
                      {contact.displayName}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('newConversation.writeMessage')}</span>
                <Textarea
                  value={whatsappBody}
                  onChange={(event) => setWhatsappBody(event.target.value)}
                  placeholder={t('newConversation.whatsappBodyPlaceholder')}
                  rows={5}
                />
              </label>
              {error ? <p className="text-xs text-status-error">{error}</p> : null}
              <p className="text-xs text-text-muted">{t('newConversation.whatsappHint')}</p>
              <button
                type="submit"
                disabled={sending || whatsappTo.trim().length < 8 || !whatsappBody.trim()}
                className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : t('newConversation.send')}
              </button>
            </form>
          ) : null}

          {intent === 'ticket' ? (
            <TicketStart
              categories={categories}
              tagId={ticketTagId}
              projectId={ticketProjectId}
              subject={ticketSubject}
              note={ticketNote}
              fields={ticketFields}
              sending={sending}
              error={error}
              onTag={(id) => {
                setTicketTagId(id)
                setTicketProjectId('')
                setTicketFields({})
              }}
              onProject={setTicketProjectId}
              onSubject={setTicketSubject}
              onNote={setTicketNote}
              onField={(key, value) => setTicketFields((prev) => ({ ...prev, [key]: value }))}
              onSubmit={() => void startTicket()}
            />
          ) : null}

          {intent === 'agent' ? (
            <div ref={agentPickerRef} className="relative">
              {noAgents ? (
                <div className="panel px-5 py-8 text-center">
                  <Bot size={28} className="mx-auto text-text-muted" />
                  <p className="mt-3 text-lg font-medium text-text-primary">
                    {t('newConversation.noAgentsAvailable')}
                  </p>
                  <Link to="/agents" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
                    {t('newConversation.openAgents')}
                  </Link>
                </div>
              ) : (
                <div className="panel flex items-center gap-2 px-3 py-2">
                  <span className="text-xs font-medium text-text-muted">{t('newConversation.to')}</span>
                  {agentPickerOpen ? (
                    <input
                      value={agentQuery}
                      onChange={(e) => setAgentQuery(e.target.value)}
                      placeholder={t('newConversation.searchAgents')}
                      className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
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
                        <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
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
                            imageUrl={selectedAgent.avatar_image_url}
                          />
                          <span className="truncate-fade text-sm text-text-primary">{selectedAgent.name}</span>
                        </>
                      ) : (
                        <span className="text-sm text-text-muted">{t('newConversation.chooseRecipient')}</span>
                      )}
                      <ChevronDown size={13} className="ml-auto shrink-0 text-text-muted" />
                    </button>
                  )}
                </div>
              )}
              {agentPickerOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-lg border border-border/60 bg-bg-surface shadow-overlay">
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
                          imageUrl={target.avatar_image_url}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate-fade text-sm text-text-primary">{target.name}</span>
                          <span className="block text-2xs text-text-muted">
                            {t('newConversation.companyAgentRole', { role: agentRoleLabel(target.role, t) })}
                          </span>
                        </span>
                        {selectedAgent?.id === target.id ? <Check size={13} className="text-accent" /> : null}
                      </button>
                    ))}
                    {!filteredAgents.length ? (
                      <p className="px-3 py-2.5 text-xs text-text-muted">{t('newConversation.noMatches')}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {intent === 'agent' && !noAgents ? (
            <div className="mt-6">
              {error ? (
                <div className="mb-2 flex items-center gap-2 px-1">
                  <p className="text-xs text-status-error">{error}</p>
                  {loadFailed ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={() => void loadTargets()}
                    >
                      {t('newConversation.retry')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <p className="mb-2 px-1 text-xs text-text-muted">{t('newConversation.draftHint')}</p>
              <ComposerCard
                ref={composerRef}
                mode="chat"
                tone="ai"
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
                  selectedAgent
                    ? t('newConversation.messageName', { name: selectedAgent.name })
                    : t('newConversation.chooseAndType')
                }
                className="border-border/60 bg-bg-surface"
              >
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={sending || !canSendAgent}
                  title={t('newConversation.send')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40"
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

function TicketStart({
  categories,
  tagId,
  projectId,
  subject,
  note,
  fields,
  sending,
  error,
  onTag,
  onProject,
  onSubject,
  onNote,
  onField,
  onSubmit,
}: {
  categories: CategoryRow[]
  tagId: string
  projectId: string
  subject: string
  note: string
  fields: Record<string, string>
  sending: boolean
  error: string | null
  onTag: (id: string) => void
  onProject: (id: string) => void
  onSubject: (value: string) => void
  onNote: (value: string) => void
  onField: (key: string, value: string) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation('communication')
  const category = categories.find((row) => row.id === tagId) ?? null
  const needsProject = (category?.project_choices.length ?? 0) > 0
  const intake = category?.intake_fields ?? []
  const missingRequired = intake.some((field) => field.required && !(fields[field.key] || '').trim())
  const ready = Boolean(category && subject.trim() && (!needsProject || projectId) && !missingRequired)

  if (categories.length === 0) {
    return (
      <div className="panel px-5 py-8 text-center">
        <Hash size={28} className="mx-auto text-text-muted" />
        <p className="mt-3 text-sm text-text-primary">{t('newConversation.noActionTags')}</p>
        <Link to="/workstreams" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
          {t('newConversation.openFlows')}
        </Link>
      </div>
    )
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit()
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('tags.actionTag')}</span>
        <ChoiceSelect
          aria-label={t('tags.actionTag')}
          placeholder={t('newConversation.chooseActionTag')}
          value={tagId}
          onValueChange={onTag}
          groups={[
            {
              items: categories.map((row) => ({
                value: row.id,
                label: row.name,
                kind: 'tag' as const,
                category: true,
              })),
            },
          ]}
        />
      </label>
      {needsProject ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('tags.chooseProject')}</span>
          <ChoiceSelect
            aria-label={t('tags.chooseProject')}
            placeholder={t('tags.chooseProject')}
            value={projectId}
            onValueChange={onProject}
            groups={[
              {
                items: [
                  { value: NO_PROJECT, label: t('tags.noProject'), kind: 'project' as const },
                  ...category!.project_choices.map((project) => ({
                    value: project.id,
                    label: project.name,
                    kind: 'project' as const,
                  })),
                ],
              },
            ]}
          />
        </label>
      ) : null}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('newConversation.subjectPlaceholder')}</span>
        <Input
          value={subject}
          onChange={(event) => onSubject(event.target.value)}
          placeholder={t('newConversation.ticketSubjectPlaceholder')}
        />
      </label>
      {intake.map((field) => (
        <label key={field.key} className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">
            {field.name}
            {field.required ? ` · ${t('tags.intakeRequired')}` : ''}
          </span>
          <Input
            value={fields[field.key] ?? ''}
            onChange={(event) => onField(field.key, event.target.value)}
          />
        </label>
      ))}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('newConversation.ticketNote')}</span>
        <Textarea
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder={t('newConversation.ticketNotePlaceholder')}
          rows={4}
        />
      </label>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <p className="text-xs text-text-muted">{t('newConversation.ticketHint')}</p>
      <button
        type="submit"
        disabled={sending || !ready}
        className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : t('newConversation.logTicket')}
      </button>
    </form>
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
        'panel flex flex-col items-start gap-2 p-4 text-left transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:border-border-light hover:bg-bg-hover/40',
      )}
    >
      <span className="text-accent">{icon}</span>
      <span className="text-base font-semibold text-text-primary">{title}</span>
      <span className="text-xs leading-snug text-text-muted">{hint}</span>
    </button>
  )
}
