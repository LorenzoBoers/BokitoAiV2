import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  ChevronLeft,
  ChevronRight,
  Hash,
  Loader2,
  Mail,
  Mic,
  Plus,
  StickyNote,
  X as XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'
import { useChatSessions } from '../context/ChatSessionsContext'
import {
  bokitoCreateConversation,
  bokitoListChatTargets,
  startConversation,
  type ChatTarget,
  type NavRow,
} from '../lib/signals-api'
import { useCommunicationNav } from '../hooks/useCommunicationNav'
import { agentFunctionLabel } from '../lib/workforce-nav-agents'
import { lastInboxPath } from '../lib/inbox-prefs'
import { agentChatPath, channelPath, inboxPath } from '../lib/messages-paths'
import PlanDialog from '../components/inbox/PlanDialog'
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
import { stashChatContinue } from '../lib/chat-auto-continue'
import { readLastChatTarget, writeLastChatTarget } from '../lib/last-chat-target'
import { listContacts, type ContactRow } from '../lib/contacts-api'
import { humanizeContactName } from '../lib/contact-label'
import { AgentMark } from '../components/ui/AgentMark'
import { UserAvatar } from '../components/ui/UserAvatar'
import { agentProfileAccentColor, resolveAgentAvatarColor } from '../lib/agent-avatar'
import { ChoiceSelect } from '../components/ui/ChoiceSelect'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { BrandMark } from '../components/integrations/BrandMark'
import { DotGridBackground } from '../components/ui/DotGridBackground'
import { PROVIDER_TO_HOST_SLUG } from '../lib/integration-brand'
import { listChannelAccounts, type ChannelAccountRow } from '../lib/channel-accounts-api'
import { listCategories, type CategoryRow } from '../lib/tickets-api'
import { useMembers } from '../hooks/useMembers'
import { useMentionDraft } from '../hooks/useMentionDraft'
import { useSpeechDictation, appendSpeechChunk } from '../hooks/useSpeechDictation'
import MentionPopover from '../components/inbox/MentionPopover'
import { MentionHighlight } from '../components/inbox/MentionHighlight'
import ComposerWriteAssist from '../components/inbox/ComposerWriteAssist'
import { ComposerDictationRow, DictationMicButton } from '../components/inbox/DictationMicButton'
import MessageAttachments from '../components/inbox/MessageAttachments'
import type { MentionItem } from '../lib/mentions'
import type { MessageAttachment } from '../lib/inbox-api'
import { uploadAttachment } from '../lib/uploads-api'
import {
  fetchOutboundConnectionId,
  readLocalOutboundConnectionId,
  resolveOutboundConnectionId,
  saveOutboundConnectionId,
} from '../lib/outbound-channel-pref'
import { cn } from '../lib/utils'

type Intent = 'contact' | 'agent' | 'teammate' | 'whatsapp' | 'ticket' | 'note' | 'transcript'

const NO_PROJECT = '__none__'

/** Pinned folder rows as `Parent / Child` options; virtual group children are skipped. */
function flattenNavFolders(rows: NavRow[], prefix: string[] = []): { id: string; path: string }[] {
  return rows.flatMap((row) => {
    if (row.virtual) return []
    const chain = [...prefix, row.name]
    return [{ id: row.id, path: chain.join(' / ') }, ...flattenNavFolders(row.children ?? [], chain)]
  })
}

function brandSlugFor(provider: string, channel: string): string {
  const raw = (provider || '').trim().toLowerCase()
  if (raw && raw !== 'email' && raw !== 'mail') return PROVIDER_TO_HOST_SLUG[raw] || raw
  const ch = (channel || '').trim().toLowerCase()
  if (ch && ch !== 'email' && ch !== 'mail') return PROVIDER_TO_HOST_SLUG[ch] || ch
  return 'smtp'
}

function parseIntent(raw: string | null): Intent | null {
  if (
    raw === 'contact' ||
    raw === 'agent' ||
    raw === 'teammate' ||
    raw === 'whatsapp' ||
    raw === 'ticket' ||
    raw === 'note' ||
    raw === 'transcript' ||
    raw === 'channel'
  ) {
    return raw
  }
  return null
}

/**
 * Draft "New conversation" surface inside Communication.
 * Intent first (Contact / Agent / Teammate); thread is created only on send.
 */
const NEW_COMPOSER_GLASS =
  'rounded-2xl border-[rgb(var(--color-border-light))] bg-bg-surface shadow-none'

function NewComposerHalo({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-24 -top-16 bottom-0"
        style={{
          background:
            'radial-gradient(closest-side, rgb(var(--color-bg)) 34%, rgb(var(--color-bg) / 0.72) 62%, transparent 100%)',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}

export default function NewConversationPage() {
  const { t } = useTranslation(['communication', 'nav'])
  const { t: tNav } = useTranslation('nav')
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
  const [planOpen, setPlanOpen] = useState(false)

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
  const [toAddress, setToAddress] = useState(toParam)
  const [connectionId, setConnectionId] = useState<number | null>(
    connectionParam ? Number(connectionParam) || null : readLocalOutboundConnectionId(),
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(memberParam || null)
  const [mailOpen, setMailOpen] = useState(false)
  const [mailRestore, setMailRestore] = useState(false)
  const [mailBody, setMailBody] = useState('')
  const pendingMailResume = useRef(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteBody, setNoteBody] = useState('')
  const [channelAccounts, setChannelAccounts] = useState<ChannelAccountRow[]>([])
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
        activity: target.status,
        avatarKind: target.avatar_kind,
        avatarIcon: target.avatar_icon,
        avatarColor: target.avatar_color,
        avatarShape: target.avatar_shape,
        avatarImageUrl: target.avatar_image_url,
      })),
    ],
    [members, targets],
  )
  const mention = useMentionDraft({
    initialRaw: searchParams.get('prefill') ?? bodyParam,
    items: mentionItems,
  })
  const composerRef = mention.textareaRef
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [dictationInterim, setDictationInterim] = useState('')
  const dictationInterimRef = useRef('')
  dictationInterimRef.current = dictationInterim

  const setMentionRaw = mention.setRaw
  const appendDictation = useCallback(
    (chunk: string) => {
      setMentionRaw((prev) => appendSpeechChunk(prev, chunk))
      setDictationInterim('')
    },
    [setMentionRaw],
  )
  const dictation = useSpeechDictation({
    onFinal: appendDictation,
    onInterim: setDictationInterim,
  })
  const confirmDictation = useCallback(() => {
    const pending = dictationInterimRef.current.trim()
    dictation.stop()
    if (pending) appendDictation(pending)
    else setDictationInterim('')
  }, [appendDictation, dictation])
  const composerValue = useMemo(() => {
    if (!dictation.listening || !dictationInterim.trim()) return mention.display
    return mention.display ? `${mention.display} ${dictationInterim}` : dictationInterim
  }, [mention.display, dictation.listening, dictationInterim])

  const onPickFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : []
      if (!list.length || !token) return
      setUploading(true)
      try {
        const uploaded: MessageAttachment[] = []
        for (const file of list) {
          uploaded.push(await uploadAttachment(token, file))
        }
        setAttachments((prev) => [...prev, ...uploaded])
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('composer.uploadError')))
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [token, t],
  )

  const onComposerPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!token) return
      const images: File[] = []
      const items = e.clipboardData?.items
      if (items?.length) {
        for (const item of Array.from(items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file && file.size > 0) images.push(file)
          }
        }
      }
      if (!images.length && e.clipboardData?.files?.length) {
        for (const file of Array.from(e.clipboardData.files)) {
          if (file.type.startsWith('image/') && file.size > 0) images.push(file)
        }
      }
      if (!images.length) return
      e.preventDefault()
      const named = images.map((file, index) => {
        const type = file.type || 'image/png'
        const ext = type.split('/')[1] || 'png'
        const generic = !file.name || file.name === 'image.png' || file.name === 'blob'
        const stamp = Date.now()
        return generic
          ? new File(
              [file],
              `pasted-${stamp}${images.length > 1 ? `-${index + 1}` : ''}.${ext}`,
              { type },
            )
          : file
      })
      void onPickFiles(named)
    },
    [token, onPickFiles],
  )

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
      const leadFirst = [...data.items.filter((row) => row.is_lead), ...data.items.filter((row) => !row.is_lead)]
      const preselect =
        data.items.find((row) => row.id === agentParam) ??
        data.items.find((row) => row.id === last) ??
        (defaultId ? data.items.find((row) => row.id === defaultId) : undefined) ??
        leadFirst[0] ??
        null
      setSelectedAgent(preselect ?? null)
    } catch {
      setLoadFailed(true)
      setError(t('newConversation.loadError'))
    } finally {
      setLoadingTargets(false)
    }
  }, [token, t, agentParam])

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
      const enabled = accounts.filter((row) => row.isEnabled)
      setChannelAccounts(enabled)
      const ready = enabled.filter((row) => row.channel === 'whatsapp')
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
      if (mention.raw.trim() && intent === 'agent') return
      event.preventDefault()
      if (intent && intent !== 'agent' && intent !== 'teammate') setIntent(null)
      else navigate(lastInboxPath())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mention.raw, intent, setIntent, navigate])

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
    setIntent('agent', { agent: target.id })
    composerRef.current?.focus()
  }

  const chooseTeammate = (memberId: string, email: string) => {
    setSelectedMemberId(memberId)
    setToAddress(email)
    setIntent('teammate', { member: memberId, to: email })
  }

  const chooseNote = () => setIntent('note')

  const chooseTranscript = () => setIntent('transcript')

  const chooseMailbox = (id: number) => {
    setConnectionId(id)
    if (!toParam) setToAddress('')
    setIntent('contact', { connectionId: String(id) })
  }

  const chooseChannel = (account: ChannelAccountRow) => {
    if (account.channel === 'whatsapp') {
      setWhatsappAccountId(account.id)
      setIntent('whatsapp', { account: account.id })
      return
    }
    setIntent('channel', { account: account.id })
  }

  const carouselItems = useMemo(() => {
    const mailboxAddress = new Set(
      sendableMailboxes.map((row) => row.mailboxEmail.trim().toLowerCase()).filter(Boolean),
    )
    return [
      ...[...targets.filter((row) => row.is_lead), ...targets.filter((row) => !row.is_lead)].map((agent) => ({
        key: `agent:${agent.id}`,
        kind: 'agent' as const,
        agent,
      })),
      ...teammateOptions.map((member) => ({
        key: `member:${member.id}`,
        kind: 'member' as const,
        member,
      })),
      { key: 'note', kind: 'note' as const },
      { key: 'transcript', kind: 'transcript' as const },
      ...sendableMailboxes.map((mailbox) => ({
        key: `email:${mailbox.id}`,
        kind: 'email' as const,
        mailbox,
      })),
      ...channelAccounts
        .filter((account) => {
          if (account.channel === 'email' && mailboxAddress.has(account.address.trim().toLowerCase())) return false
          return true
        })
        .map((account) => ({
          key: `channel:${account.id}`,
          kind: 'channel' as const,
          account,
        })),
    ]
  }, [targets, teammateOptions, sendableMailboxes, channelAccounts])

  const accountParam = searchParams.get('account')?.trim() || ''
  const activeCarousel =
    (intent === 'note'
      ? carouselItems.find((item) => item.kind === 'note')
      : intent === 'transcript'
        ? carouselItems.find((item) => item.kind === 'transcript')
      : intent === 'contact'
        ? carouselItems.find((item) => item.kind === 'email' && item.mailbox.id === connectionId) ??
          carouselItems.find((item) => item.kind === 'email')
        : intent === 'whatsapp'
          ? carouselItems.find(
              (item) =>
                item.kind === 'channel' &&
                item.account.channel === 'whatsapp' &&
                item.account.id === (accountParam || whatsappAccountId),
            ) ?? carouselItems.find((item) => item.kind === 'channel' && item.account.channel === 'whatsapp')
          : intent === 'channel'
            ? carouselItems.find((item) => item.kind === 'channel' && item.account.id === accountParam)
            : intent === 'teammate'
              ? carouselItems.find((item) => item.kind === 'member' && String(item.member.id) === selectedMemberId)
              : carouselItems.find((item) => item.kind === 'agent' && item.agent.id === selectedAgent?.id)) ??
    carouselItems[0]

  const resumeNewMailDraft = () => {
    if (!toParam) setToAddress('')
    if (intent === 'contact' && activeCarousel?.kind === 'email') {
      setMailRestore(true)
      setMailOpen(true)
      return
    }
    pendingMailResume.current = true
    setIntent('contact')
  }

  useEffect(() => {
    if (pendingMailResume.current) {
      pendingMailResume.current = false
      setMailRestore(true)
      setMailOpen(true)
      setNoteOpen(false)
      setNoteBody('')
      return
    }
    setMailOpen(false)
    setMailRestore(false)
    setMailBody('')
    setNoteOpen(false)
    setNoteBody('')
  }, [activeCarousel?.key])

  const [slideDir, setSlideDir] = useState<-1 | 1>(1)
  const [dragX, setDragX] = useState(0)
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)

  const stepCarousel = (direction: -1 | 1) => {
    if (carouselItems.length < 2 || !activeCarousel) return
    const index = carouselItems.findIndex((item) => item.key === activeCarousel.key)
    const next = carouselItems[(index + direction + carouselItems.length) % carouselItems.length]
    if (!next || next.key === activeCarousel.key) return
    setSlideDir(direction)
    setDragX(0)
    if (next.kind === 'agent') chooseAgent(next.agent)
    else if (next.kind === 'member') chooseTeammate(String(next.member.id), next.member.email)
    else if (next.kind === 'note') chooseNote()
    else if (next.kind === 'transcript') chooseTranscript()
    else if (next.kind === 'email') chooseMailbox(next.mailbox.id)
    else chooseChannel(next.account)
  }

  const onCarouselPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (carouselItems.length < 2) return
    if ((event.target as HTMLElement).closest('button')) return
    dragOrigin.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onCarouselPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current
    if (!origin) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) return
    setDragX(Math.max(-96, Math.min(96, dx)))
  }

  const onCarouselPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current
    dragOrigin.current = null
    if (!origin) return
    const dx = event.clientX - origin.x
    setDragX(0)
    if (dx <= -40) stepCarousel(1)
    else if (dx >= 40) stepCarousel(-1)
  }

  const canSendAgent = Boolean(
    selectedAgent && (mention.raw.trim() || dictationInterim.trim() || attachments.length > 0) && !uploading,
  )

  const startAgent = useCallback(async () => {
    const pending = dictation.listening ? dictationInterimRef.current.trim() : ''
    if (dictation.listening) dictation.stop()
    const content = (pending ? appendSpeechChunk(mention.raw, pending) : mention.raw).trim()
    if (pending) setMentionRaw(content)
    setDictationInterim('')
    if ((!content && attachments.length === 0) || !token || !selectedAgent || sending || uploading) {
      return
    }
    setSending(true)
    setError(null)
    try {
      // Persist the opener with the thread so a lost navigation state cannot
      // leave an empty "Untitled chat". ThreadDetail then continues the agent.
      const created = await bokitoCreateConversation(token, 'New conversation', selectedAgent.id, {
        message: content || undefined,
        attachments: attachments.length ? attachments : undefined,
      })
      const path = agentChatPath(selectedAgent.id, created.id)
      if (created.has_opener) {
        stashChatContinue(created.id, { mode: 'continue' })
        navigate(path, { state: { continuePending: true } })
      } else {
        // Server did not store the opener — fall back to a re-send.
        stashChatContinue(created.id, {
          mode: 'send',
          text: content,
          attachments: attachments.length ? attachments : undefined,
        })
        navigate(path, { state: { autoSend: content } })
      }
      void refreshSessions()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('newConversation.startError')
      if (/no agents available/i.test(message)) {
        setError(t('newConversation.noAgentsAvailableForUser'))
      } else {
        setError(message)
      }
      setSending(false)
    }
  }, [
    mention.raw,
    attachments,
    token,
    selectedAgent,
    sending,
    uploading,
    navigate,
    refreshSessions,
    dictation,
    setMentionRaw,
    t,
  ])

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
      // Optional: filing in a folder adds that folder's tags to the new thread.
      const projectId = ticketProjectId === NO_PROJECT ? null : ticketProjectId || null
      const result = await startConversation(token, {
        kind: 'ticket',
        tagId: selectedCategory.id,
        subject: ticketSubject,
        note: ticketNote,
        projectId,
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
    ticketProjectId,
    ticketSubject,
    ticketNote,
    ticketFields,
    navigate,
    t,
  ])

  const startNote = useCallback(async (subject: string, note: string) => {
    if (!token || sending) return
    const text = note.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const result = await startConversation(token, {
        kind: 'note',
        subject: subject.trim(),
        note: text,
      })
      navigate(channelPath('internal', { threadId: result.threadId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newConversation.startError'))
      setSending(false)
    }
  }, [token, sending, navigate, t])

  const startTeammate = useCallback(async () => {
    const member = activeCarousel?.kind === 'member' ? activeCarousel.member : null
    const pending = dictation.listening ? dictationInterimRef.current.trim() : ''
    if (dictation.listening) dictation.stop()
    const content = (pending ? appendSpeechChunk(mention.raw, pending) : mention.raw).trim()
    if (pending) setMentionRaw(content)
    setDictationInterim('')
    if (!content || !token || !member?.uuid || sending) return
    setSending(true)
    setError(null)
    try {
      const result = await startConversation(token, {
        kind: 'chat',
        memberId: member.uuid,
        message: content,
      })
      navigate(channelPath('internal', { threadId: result.threadId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newConversation.startError'))
      setSending(false)
    }
  }, [activeCarousel, mention.raw, token, sending, navigate, dictation, setMentionRaw, t])

  const start = useCallback(async () => {
    if (activeCarousel?.kind === 'member') return startTeammate()
    return startAgent()
  }, [activeCarousel, startTeammate, startAgent])

  useEffect(() => {
    if (!autoSendRequested.current || intent !== 'agent') return
    if (loadingTargets || !selectedAgent || !mention.raw.trim()) return
    autoSendRequested.current = false
    void startAgent()
  }, [loadingTargets, selectedAgent, mention.raw, intent, startAgent])

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    mention.onKeyDown(e, () => void start())
  }

  const showAgentHome =
    !intent ||
    intent === 'agent' ||
    intent === 'teammate' ||
    intent === 'note' ||
    intent === 'transcript' ||
    intent === 'contact' ||
    intent === 'whatsapp' ||
    intent === 'channel'
  const noAgents = !loadingTargets && carouselItems.length === 0 && showAgentHome

  // Intent for the embedded mail composer; the recipient follows deeplinks
  // (?to=) and teammate chips, the subject follows ?subject=.
  const mailIntent = useMemo<MailComposerIntent>(
    () => ({
      mode: 'new',
      sourceMessageId: '',
      // A resumed draft fills To itself. A fresh start stays empty unless
      // the link named a recipient (?to=).
      to: mailRestore || !toParam ? '' : toAddress,
      cc: '',
      subject: mailRestore ? '' : subjectParam,
      quotedHtml: '',
      quotedPreview: '',
    }),
    [mailRestore, toAddress, toParam, subjectParam],
  )
  const defaultFromAddress = useMemo(
    () => sendableMailboxes.find((c) => c.id === connectionId)?.mailboxEmail ?? null,
    [sendableMailboxes, connectionId],
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <DotGridBackground />
      <div className="relative z-10 flex h-11 shrink-0 items-center gap-3 border-b border-border/40 bg-bg px-4">
        <button
          type="button"
          onClick={() => (showAgentHome ? navigate(lastInboxPath()) : setIntent(null))}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={13} />
          {showAgentHome ? t('newConversation.back') : t('newConversation.changeType')}
        </button>
        {showAgentHome && !noAgents ? null : (
          <>
            <p className="text-sm font-medium text-text-primary">
              {intent === 'contact' || intent === 'teammate'
                ? t('newConversation.draftContact')
                : intent === 'whatsapp'
                  ? t('newConversation.draftWhatsapp')
                  : intent === 'ticket'
                    ? t('newConversation.draftTicket')
                    : intent === 'note'
                      ? t('newConversation.draftNote')
                      : intent === 'transcript'
                        ? t('newConversation.draftTranscript')
                        : t('newConversation.title')}
            </p>
            <span className="rounded-md border border-border/50 bg-bg-elevated px-1.5 py-0.5 text-2xs font-medium text-text-muted">
              {t('newConversation.draftBadge')}
            </span>
          </>
        )}
      </div>

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        {showAgentHome && !noAgents ? (
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
            <div className="w-full max-w-[560px] space-y-6">
              {newMailDraft ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-bg-surface px-3 py-2">
                  <Mail size={14} className="shrink-0 text-accent" />
                  <button
                    type="button"
                    onClick={resumeNewMailDraft}
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
                    onClick={resumeNewMailDraft}
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
              {!canSendEmail ? (
                <p className="text-center text-xs text-text-muted">
                  {t('newConversation.connectMailboxHint')}{' '}
                  <Link to="/settings/channels" className="font-medium text-accent hover:underline">
                    {t('newConversation.connectMailbox')}
                  </Link>
                </p>
              ) : null}
              <div
                className="relative h-[16.125rem] touch-pan-y overflow-hidden pt-20 text-center"
                onPointerDown={onCarouselPointerDown}
                onPointerMove={onCarouselPointerMove}
                onPointerUp={onCarouselPointerUp}
                onPointerCancel={onCarouselPointerUp}
              >
                {carouselItems.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => stepCarousel(-1)}
                      aria-label={t('newConversation.previousAgent')}
                      className="absolute left-0 top-1/2 z-[1] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                    >
                      <ChevronLeft size={22} />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepCarousel(1)}
                      aria-label={t('newConversation.nextAgent')}
                      className="absolute right-0 top-1/2 z-[1] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                    >
                      <ChevronRight size={22} />
                    </button>
                  </>
                ) : null}
                {activeCarousel ? (
                  <div
                    key={activeCarousel.key}
                    className={cn('flex flex-col items-center', dragX === 0 && 'carousel-slide')}
                    style={{
                      transform: dragX ? `translateX(${dragX}px)` : undefined,
                      ['--slide-from' as string]: slideDir > 0 ? '40px' : '-40px',
                    }}
                  >
                    <div className="flex h-[72px] items-center justify-center">
                      {activeCarousel.kind === 'agent' ? (
                        <div className="relative" style={{ width: 72, height: 72 }}>
                          <span
                            aria-hidden
                            className="specialist-glow pointer-events-none absolute inset-[-28%] rounded-full blur-2xl"
                            style={{
                              backgroundColor: agentProfileAccentColor(
                                resolveAgentAvatarColor(activeCarousel.agent.avatar_color),
                              ),
                            }}
                          />
                          <AgentMark
                            agent={activeCarousel.agent}
                            size={72}
                            decorative={false}
                            mode="live"
                            className="relative z-[1]"
                          />
                        </div>
                      ) : activeCarousel.kind === 'member' ? (
                        <UserAvatar
                          name={activeCarousel.member.name || activeCarousel.member.email}
                          email={activeCarousel.member.email}
                          avatarUrl={activeCarousel.member.avatarUrl}
                          presence={activeCarousel.member.presence}
                          size={72}
                        />
                      ) : activeCarousel.kind === 'note' || activeCarousel.kind === 'transcript' ? (
                        <span className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-bg-elevated text-accent">
                          {activeCarousel.kind === 'note' ? <StickyNote size={32} /> : <Mic size={32} />}
                        </span>
                      ) : (
                        <BrandMark
                          slug={
                            activeCarousel.kind === 'email'
                              ? brandSlugFor(activeCarousel.mailbox.provider, 'email')
                              : brandSlugFor(activeCarousel.account.provider, activeCarousel.account.channel)
                          }
                          size={64}
                        />
                      )}
                    </div>
                    <CarouselCaption item={activeCarousel} />
                  </div>
                ) : (
                  <span className="mx-auto flex h-[72px] w-14 items-center justify-center rounded-full border border-border/50 bg-bg-surface text-text-muted">
                    <Bot size={24} />
                  </span>
                )}
              </div>

              {error ? (
                <div className="flex items-center justify-center gap-2">
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

              <div className="flex w-full flex-col gap-3">
              <NewComposerHalo>
              {activeCarousel?.kind === 'note' || activeCarousel?.kind === 'transcript' ? (
                noteOpen ? (
                  <NoteStart
                    mode={activeCarousel.kind}
                    sending={sending}
                    error={error}
                    initialNote={noteBody}
                    onSubmit={(subject, note) => void startNote(subject, note)}
                  />
                ) : (
                  <ComposerCard
                    className={NEW_COMPOSER_GLASS}
                    mode="chat"
                    tone="default"
                    value={noteBody}
                    onChange={(event) => {
                      const next = event.currentTarget.value
                      if (next.trim()) {
                        setNoteBody(next)
                        setNoteOpen(true)
                        return
                      }
                      setNoteBody(next)
                    }}
                    placeholder={t('newConversation.messageName', {
                      name: t(
                        activeCarousel.kind === 'note'
                          ? 'newConversation.carouselNote'
                          : 'newConversation.carouselTranscript',
                      ),
                    })}
                  >
                    <button
                      type="button"
                      disabled
                      title={t('newConversation.send')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-text-heading text-bg opacity-40"
                    >
                      <ArrowUp size={16} strokeWidth={2.25} />
                    </button>
                  </ComposerCard>
                )
              ) : activeCarousel?.kind === 'email' ||
                (activeCarousel?.kind === 'channel' && activeCarousel.account.channel === 'email') ? (
                mailOpen ? (
                  <MailComposer
                    key={mailRestore ? 'resume' : 'fresh'}
                    intent={mailIntent}
                    draftKey="new"
                    restoreDraft={mailRestore}
                    defaultFromAddress={
                      activeCarousel.kind === 'email'
                        ? activeCarousel.mailbox.mailboxEmail
                        : activeCarousel.account.address
                    }
                    recipientSuggestions={recipientSuggestions}
                    initialBody={mailBody || bodyParam}
                    preferSeedBody={!mailRestore}
                    variant="page"
                    saving={sending}
                    onSend={handleMailSend}
                    onCancel={() => {
                      setMailOpen(false)
                      setMailBody('')
                    }}
                  />
                ) : (
                  <ComposerCard
                    className={NEW_COMPOSER_GLASS}
                    mode="chat"
                    tone="default"
                    value={mailBody}
                    onChange={(event) => {
                      const next = event.currentTarget.value
                      if (next.trim()) {
                        setMailBody(next)
                        if (!toParam) setToAddress('')
                        setMailRestore(false)
                        setMailOpen(true)
                        return
                      }
                      setMailBody(next)
                    }}
                    placeholder={t('newConversation.writeMessage')}
                  >
                    <button
                      type="button"
                      disabled
                      title={t('newConversation.send')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-text-heading text-bg opacity-40"
                    >
                      <ArrowUp size={16} strokeWidth={2.25} />
                    </button>
                  </ComposerCard>
                )
              ) : activeCarousel?.kind === 'channel' && activeCarousel.account.channel === 'whatsapp' ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void startWhatsapp()
                  }}
                >
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-text-muted">{t('newConversation.whatsappTo')}</span>
                    <Input
                      value={whatsappTo}
                      onChange={(event) => setWhatsappTo(event.target.value)}
                      placeholder={t('newConversation.whatsappToPlaceholder')}
                      inputMode="tel"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-text-muted">{t('newConversation.writeMessage')}</span>
                    <Textarea
                      value={whatsappBody}
                      onChange={(event) => setWhatsappBody(event.target.value)}
                      placeholder={t('newConversation.whatsappBodyPlaceholder')}
                      rows={4}
                    />
                  </label>
                  <p className="text-xs text-text-muted">{t('newConversation.whatsappHint')}</p>
                  <button
                    type="submit"
                    disabled={sending || whatsappTo.trim().length < 8 || !whatsappBody.trim()}
                    className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : t('newConversation.send')}
                  </button>
                </form>
              ) : activeCarousel?.kind === 'channel' ? (
                <p className="text-center text-xs text-text-muted">{t('newConversation.channelInbound')}</p>
              ) : (
              <ComposerCard
                className={NEW_COMPOSER_GLASS}
                ref={composerRef}
                mode="chat"
                tone="default"
                value={composerValue}
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
                onPaste={onComposerPaste}
                highlighter={<MentionHighlight raw={mention.raw} />}
                header={
                  attachments.length || uploading ? (
                    <MessageAttachments
                      placement="composer"
                      attachments={attachments}
                      pending={uploading}
                      onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
                    />
                  ) : null
                }
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
                  activeCarousel?.kind === 'member'
                    ? t('newConversation.messageName', {
                        name: activeCarousel.member.name || activeCarousel.member.email,
                      })
                    : selectedAgent
                      ? t('newConversation.messageName', { name: selectedAgent.name })
                      : t('newConversation.chooseAndType')
                }
                leading={
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void onPickFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={uploading || sending}
                      onClick={() => fileInputRef.current?.click()}
                      title={t('composer.attachFile')}
                      aria-label={t('composer.attachFile')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
                    >
                      <Plus size={16} />
                    </button>
                  </>
                }
              >
                {activeCarousel?.kind === 'member' ? (
                  <ComposerWriteAssist
                    body={mention.raw}
                    disabled={sending || uploading}
                    onApply={(text) => {
                      setMentionRaw(text)
                      requestAnimationFrame(() => composerRef.current?.focus())
                    }}
                  />
                ) : null}
                <ComposerDictationRow
                  supported={dictation.supported}
                  listening={dictation.listening}
                  disabled={sending || uploading}
                  onStart={() => dictation.start()}
                  onConfirm={confirmDictation}
                >
                  <button
                    type="button"
                    onClick={() => void start()}
                    disabled={sending || !(activeCarousel?.kind === 'member' ? mention.raw.trim() || dictationInterim.trim() : canSendAgent)}
                    title={t('newConversation.send')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-text-heading text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.25} />}
                  </button>
                </ComposerDictationRow>
              </ComposerCard>
              )}
              </NewComposerHalo>
              <HomeShortcuts />
              </div>
            </div>
          </div>
        ) : (
        <div className="mx-auto w-full max-w-[720px] px-4 pb-10 pt-8">
          {showAgentHome && noAgents ? (
            <div className="mx-auto flex min-h-full max-w-[560px] flex-col justify-center gap-6 py-12">
              <HomeShortcuts />
              <div className="panel px-5 py-8 text-center">
                <Bot size={28} className="mx-auto text-text-muted" />
                <p className="mt-3 text-lg font-medium text-text-primary">
                  {t('newConversation.noAgentsAvailable')}
                </p>
                <Link to="/agents" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
                  {t('newConversation.openAgents')}
                </Link>
              </div>
            </div>
          ) : null}

          {intent === 'contact' ? (
            <div className="space-y-3">
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

          {intent === 'note' || intent === 'transcript' ? (
            <NoteStart
              mode={intent}
              sending={sending}
              error={error}
              onSubmit={(subject, note) => void startNote(subject, note)}
            />
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

        </div>
        )}
      </div>
      <PlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        onSaved={(created) => {
          if (created) navigate(inboxPath('scheduled', String(created.id)))
        }}
      />
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
  const { nav } = useCommunicationNav()
  const category = categories.find((row) => row.id === tagId) ?? null
  const folders = useMemo(() => flattenNavFolders(nav.projects), [nav.projects])
  const intake = category?.intake_fields ?? []
  const missingRequired = intake.some((field) => field.required && !(fields[field.key] || '').trim())
  const ready = Boolean(category && subject.trim() && !missingRequired)

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
      {folders.length > 0 ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('tags.chooseProject')}</span>
          <ChoiceSelect
            aria-label={t('tags.chooseProject')}
            placeholder={t('tags.noProject')}
            value={projectId || NO_PROJECT}
            onValueChange={onProject}
            groups={[
              {
                items: [
                  { value: NO_PROJECT, label: t('tags.noProject'), kind: 'project' as const },
                  ...folders.map((folder) => ({
                    value: folder.id,
                    label: folder.path,
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

function CarouselCaption({
  item,
}: {
  item:
    | { kind: 'agent'; agent: ChatTarget }
    | { kind: 'member'; member: { name: string; email: string } }
    | { kind: 'note' }
    | { kind: 'transcript' }
    | { kind: 'email'; mailbox: { displayName: string; mailboxEmail: string } }
    | { kind: 'channel'; account: ChannelAccountRow }
}) {
  const { t } = useTranslation('communication')
  const { t: tNav } = useTranslation('nav')
  const address =
    item.kind === 'email' ? item.mailbox.mailboxEmail : item.kind === 'channel' ? item.account.address : ''
  const title =
    item.kind === 'agent'
      ? item.agent.name
      : item.kind === 'member'
        ? item.member.name || item.member.email
        : item.kind === 'note'
          ? t('newConversation.carouselNote')
          : item.kind === 'transcript'
            ? t('newConversation.carouselTranscript')
            : item.kind === 'email'
            ? item.mailbox.displayName || address
            : item.account.displayName || address
  const channelKind = item.kind === 'channel' ? item.account.channel : item.kind === 'email' ? 'email' : ''
  const kicker =
    channelKind === 'email'
      ? t('newConversation.mailFromLabel')
      : channelKind === 'whatsapp'
        ? t('newConversation.whatsappFromLabel')
        : channelKind
          ? t(`newConversation.channel.${channelKind}`, { defaultValue: channelKind })
          : t('newConversation.messageTo')
  const detail =
    item.kind === 'member'
      ? t('newConversation.teammate')
      : item.kind === 'note'
        ? t('newConversation.carouselNoteHint')
        : item.kind === 'transcript'
          ? t('newConversation.carouselTranscriptHint')
          : address && address.trim() !== title.trim()
          ? address
          : ''
  const detailText = item.kind === 'agent' ? agentFunctionLabel(item.agent, tNav) : detail
  return (
    <div className="mt-4 flex h-[5.625rem] w-full max-w-lg flex-col items-center px-6">
      <p className="text-xs leading-4 text-text-muted">{kicker}</p>
      <h1 className="mt-0.5 line-clamp-1 max-w-full text-xl font-semibold leading-7 tracking-tight text-text-heading">
        {title}
      </h1>
      <p
        className={cn(
          'mt-1 line-clamp-2 h-10 max-w-full text-sm font-medium leading-5',
          item.kind === 'agent' ? '' : 'break-all text-text-secondary',
        )}
        style={
          item.kind === 'agent'
            ? { color: agentProfileAccentColor(resolveAgentAvatarColor(item.agent.avatar_color)) }
            : undefined
        }
      >
        {detailText || '\u00a0'}
      </p>
    </div>
  )
}

function NoteStart({
  mode,
  sending,
  error,
  initialNote = '',
  onSubmit,
}: {
  mode: 'note' | 'transcript'
  sending: boolean
  error: string | null
  initialNote?: string
  onSubmit: (subject: string, note: string) => void
}) {
  const { t } = useTranslation('communication')
  const [subject, setSubject] = useState('')
  const [note, setNote] = useState(initialNote)
  const [interim, setInterim] = useState('')
  const interimRef = useRef('')
  interimRef.current = interim
  const append = useCallback((chunk: string) => {
    setNote((prev) => appendSpeechChunk(prev, chunk))
    setInterim('')
  }, [])
  const dictation = useSpeechDictation({ onFinal: append, onInterim: setInterim })
  const shown = dictation.listening && interim.trim() ? (note ? `${note} ${interim}` : interim) : note
  const confirm = () => {
    const pending = interimRef.current.trim()
    dictation.stop()
    if (pending) append(pending)
    else setInterim('')
  }
  const recording = mode === 'transcript'
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        const pending = dictation.listening ? interimRef.current.trim() : ''
        if (dictation.listening) dictation.stop()
        const text = (pending ? appendSpeechChunk(note, pending) : note).trim()
        onSubmit(subject, text)
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('newConversation.subjectPlaceholder')}</span>
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={recording ? t('newConversation.transcriptSubjectPlaceholder') : t('newConversation.noteSubjectPlaceholder')}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">
          {recording ? t('newConversation.transcriptBody') : t('newConversation.ticketNote')}
        </span>
        <Textarea
          value={shown}
          readOnly={dictation.listening}
          onChange={(event) => {
            if (dictation.listening) return
            setNote(event.target.value)
          }}
          placeholder={
            dictation.listening
              ? t('composer.dictationListening')
              : recording
                ? t('newConversation.transcriptPlaceholder')
                : t('newConversation.notePlaceholder')
          }
          rows={8}
        />
      </label>
      {recording && dictation.supported ? (
        <div className="flex items-center gap-2">
          <DictationMicButton
            listening={dictation.listening}
            disabled={sending}
            onStart={() => dictation.start()}
            onConfirm={confirm}
          />
          <span className="text-xs text-text-muted">
            {dictation.listening ? t('newConversation.transcriptListening') : t('newConversation.transcriptMic')}
          </span>
        </div>
      ) : recording ? (
        <p className="text-xs text-text-muted">{t('newConversation.transcriptNoMic')}</p>
      ) : null}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <p className="text-xs text-text-muted">
        {recording ? t('newConversation.transcriptHint') : t('newConversation.noteHint')}
      </p>
      <button
        type="submit"
        disabled={sending || !shown.trim()}
        className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40"
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : t('newConversation.saveNote')}
      </button>
    </form>
  )
}

function HomeShortcuts() {
  const { t } = useTranslation('communication')
  const links = [
    { to: lastInboxPath(), label: t('newConversation.pageCommunication') },
    { to: '/agenda', label: t('newConversation.pageAgenda') },
    { to: '/contacts', label: t('newConversation.pageContacts') },
  ]
  return (
    <div className="relative z-10 flex flex-col items-center gap-4 text-center">
      <p className="text-2xs text-text-muted">{t('newConversation.poweredBy')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {links.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className="text-xs text-text-muted transition-colors hover:text-text-primary"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

