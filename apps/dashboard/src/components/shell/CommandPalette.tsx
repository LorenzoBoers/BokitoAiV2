import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Bot,
  CircleHelp,
  Clock,
  CornerDownLeft,
  FileText,
  FolderKanban,
  Inbox,
  Mail,
  MessageSquare,
  Moon,
  Plus,
  Settings,
  User,
  UserPlus,
} from 'lucide-react'
import { SETTINGS_PALETTE_LINKS } from './SettingsLayout'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useChatSessions } from '../../context/ChatSessionsContext'
import { TAB_GROUPS, iconForTab, pathForTab, subtitleForTab, titleForTab } from '../../lib/navigation'
import { agentRunsPath, assistantPath, inboxPath } from '../../lib/messages-paths'
import { lastInboxPath, looksLikeThreadQuery } from '../../lib/inbox-prefs'
import { agentWorkforceRunUrl } from '../../lib/workforce-run-urls'
import { useOptionalInboxCommunication } from '../../context/InboxCommunicationContext'
import { threadHubPath } from '../../lib/message-composer'
import { composeEmailPath, newAgentPath, newContactPath } from '../../lib/compose-intent'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import { MY_ASSISTANT_SETTINGS_PATH } from '../../lib/assistant-settings-path'
import { listRecentPages } from '../../lib/recent-pages'
import { listSignalThreads } from '../../lib/signals-api'
import { listContacts, type ContactRow } from '../../lib/contacts-api'
import type { InboxThread } from '../../lib/inbox-api'
import { searchWorkspace, type WorkspaceSearchHit } from '../../lib/workspace-api'
import { humanizeKnowledgeTitle } from '../../lib/knowledge-title'
import type { LucideIcon } from 'lucide-react'

type PaletteItem = {
  id: string
  label: string
  hint?: string
  href?: string
  group: string
  icon: LucideIcon
  run: () => void
}

type CommandPaletteProps = {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { activeConnections } = useMailboxConnections()
  const mailboxReady = activeConnections.length > 0
  const { toggleMode, isDark } = useTheme()
  const { conversations, startNewChat } = useChatSessions()
  const inboxComm = useOptionalInboxCommunication()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [threadResults, setThreadResults] = useState<InboxThread[]>([])
  const [contactResults, setContactResults] = useState<ContactRow[]>([])
  const [docResults, setDocResults] = useState<WorkspaceSearchHit[]>([])
  const [recent, setRecent] = useState(() => listRecentPages())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Remote search: threads and contacts matching the typed query (debounced).
  useEffect(() => {
    const q = query.trim()
    if (!token || (q.length < 2 && !looksLikeThreadQuery(q))) {
      setThreadResults([])
      setContactResults([])
      setDocResults([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void listSignalThreads(token, { search: q, perPage: 12 })
        .then((res) => {
          if (!cancelled) setThreadResults(res.items)
        })
        .catch(() => {
          if (!cancelled) setThreadResults([])
        })
      void listContacts(token, { search: q })
        .then((rows) => {
          if (!cancelled) setContactResults(rows.slice(0, 5))
        })
        .catch(() => {
          if (!cancelled) setContactResults([])
        })
      void searchWorkspace(q, 5)
        .then((rows) => {
          if (!cancelled) setDocResults(rows)
        })
        .catch(() => {
          if (!cancelled) setDocResults([])
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [token, query])

  const catalog = useMemo(() => {
    const nav: PaletteItem[] = TAB_GROUPS.flatMap((group) =>
      group.tabs.map((tab) => ({
        id: `nav-${tab}`,
        label: t(`tabs.${tab}.title`, { defaultValue: titleForTab(tab) }),
        hint: t(`tabs.${tab}.subtitle`, { defaultValue: subtitleForTab(tab) }),
        group: t('palette.groupGoTo'),
        icon: iconForTab(tab),
        href: pathForTab(tab),
        run: () => navigate(pathForTab(tab)),
      })),
    )
    const inboxQueues: PaletteItem[] = (
      [
        { id: 'inbox-all', queue: 'all' as const, labelKey: 'support.inbox.all' },
        { id: 'inbox-open', queue: 'open' as const, labelKey: 'support.inbox.open', hintKey: 'palette.inboxOpenHint' },
        { id: 'inbox-mine', queue: 'mine' as const, labelKey: 'support.inbox.mine' },
        { id: 'inbox-unassigned', queue: 'unassigned' as const, labelKey: 'support.inbox.unassigned' },
        { id: 'inbox-snoozed', queue: 'snoozed' as const, labelKey: 'support.inbox.snoozed' },
        { id: 'inbox-closed', queue: 'closed' as const, labelKey: 'support.inbox.closed' },
        { id: 'inbox-spam', queue: 'spam' as const, labelKey: 'support.inbox.spam' },
      ] as const
    ).map((item): PaletteItem => ({
      id: item.id,
      label: t(item.labelKey),
      hint: 'hintKey' in item ? t(item.hintKey) : undefined,
      group: t('palette.groupInbox'),
      icon: Inbox,
      run: () => navigate(inboxPath(item.queue)),
    })).concat([
      {
        id: 'inbox-needs-reply',
        label: t('palette.needsReply'),
        hint: t('palette.inboxOpenHint'),
        group: t('palette.groupInbox'),
        icon: Inbox,
        run: () => {
          inboxComm?.setQuickFilter('needsReply')
          navigate(`${inboxPath('open')}?filter=needsReply`)
        },
      },
      {
        id: 'inbox-assistant',
        label: t('support.section.assistant'),
        group: t('palette.groupInbox'),
        icon: MessageSquare,
        run: () => navigate(assistantPath()),
      },
      {
        id: 'inbox-agent-runs',
        label: t('palette.agentRuns'),
        group: t('palette.groupInbox'),
        icon: Bot,
        run: () => navigate(agentRunsPath('all')),
      },
    ])
    const settings: PaletteItem[] = SETTINGS_PALETTE_LINKS.map((link) => ({
      id: `settings-${link.to}`,
      label: t(link.labelKey),
      hint: link.hintKey ? t(link.hintKey) : undefined,
      href: link.to,
      group: t('palette.groupSettings'),
      icon: Settings,
      run: () => navigate(link.to),
    }))
    const sessions: PaletteItem[] = conversations.slice(0, 8).map((c) => ({
      id: `session-${c.id}`,
      label: c.title || t('palette.untitledConversation'),
      group: t('palette.groupSessions'),
      icon: MessageSquare,
      run: () => navigate(assistantPath(c.id)),
    }))
    const actions: PaletteItem[] = [
      {
        id: 'action-new-chat',
        label: t('palette.newChat'),
        group: t('palette.groupActions'),
        icon: Plus,
        run: () => startNewChat(),
      },
      {
        id: 'action-talk-assistant',
        label: t('palette.talkAssistant'),
        group: t('palette.groupActions'),
        icon: MessageSquare,
        run: () => navigate(talkToAssistantPath(t('palette.talkPrefill'))),
      },
      {
        id: 'action-invite',
        label: t('palette.inviteTeammate'),
        group: t('palette.groupActions'),
        icon: UserPlus,
        run: () => navigate('/settings/members#member-invite'),
      },
      {
        id: 'action-profile',
        label: t('palette.openProfile'),
        group: t('palette.groupActions'),
        icon: User,
        run: () => navigate('/settings/profile'),
      },
      {
        id: 'action-notifications',
        label: t('palette.openNotifications'),
        group: t('palette.groupActions'),
        icon: Settings,
        run: () => navigate('/settings/notifications'),
      },
      {
        id: 'action-bookkeeping',
        label: t('palette.openBookkeeping'),
        group: t('palette.groupActions'),
        icon: BookOpen,
        run: () => navigate('/settings/modules/accounting'),
      },
      {
        id: 'action-my-assistant',
        label: t('assistantSettings.title'),
        group: t('palette.groupActions'),
        icon: Bot,
        run: () => navigate(MY_ASSISTANT_SETTINGS_PATH),
      },
      ...(mailboxReady
        ? [
            {
              id: 'action-new-email',
              label: t('palette.newEmail'),
              group: t('palette.groupActions'),
              icon: Mail,
              run: () => navigate(composeEmailPath()),
            } satisfies PaletteItem,
          ]
        : []),
      {
        id: 'action-new-contact',
        label: t('palette.newContact'),
        group: t('palette.groupActions'),
        icon: UserPlus,
        run: () => navigate(newContactPath()),
      },
      {
        id: 'action-new-agent',
        label: t('palette.newAgent'),
        group: t('palette.groupActions'),
        icon: Bot,
        run: () => navigate(newAgentPath()),
      },
      {
        id: 'action-new-project',
        label: t('palette.newProject'),
        group: t('palette.groupActions'),
        icon: FolderKanban,
        run: () => navigate('/projects?new=1'),
      },
      {
        id: 'action-connect-mailbox',
        label: t('palette.connectMailbox'),
        group: t('palette.groupActions'),
        icon: Inbox,
        run: () => navigate('/settings/channels'),
      },
      {
        id: 'action-setup-guide',
        label: t('palette.openSetupGuide'),
        group: t('palette.groupActions'),
        icon: Settings,
        run: () => navigate('/settings/setup'),
      },
      {
        id: 'action-help',
        label: t('palette.openHelp'),
        group: t('palette.groupActions'),
        icon: CircleHelp,
        run: () => navigate('/learn'),
      },
      {
        id: 'action-theme',
        label: isDark ? t('palette.switchToLight') : t('palette.switchToDark'),
        group: t('palette.groupActions'),
        icon: Moon,
        run: () => toggleMode(),
      },
    ]
    return { nav, inboxQueues, settings, sessions, actions }
  }, [conversations, mailboxReady, navigate, startNewChat, toggleMode, isDark, t])

  const recentItems = useMemo<PaletteItem[]>(
    () =>
      recent
        .filter((row) => {
          const recentPath = row.path.split('?')[0] ?? row.path
          if (recentPath === pathname) return false
          if (pathname.startsWith(`${recentPath}/`)) return false
          if (recentPath.startsWith(`${pathname}/`)) return false
          return true
        })
        .slice(0, 5)
        .map((row) => ({
          id: `recent-${row.path}`,
          label: row.title,
          group: t('palette.groupRecent'),
          icon: Clock,
          href: row.path.split('?')[0] ?? row.path,
          run: () => navigate(row.path),
        })),
    [recent, pathname, navigate, t],
  )

  const remoteItems = useMemo<PaletteItem[]>(() => {
    const q = query.trim()
    const extras: PaletteItem[] = []
    if (q.length >= 2) {
      extras.push({
        id: 'threads-view-all',
        label: t('palette.viewAllInbox'),
        hint: q,
        group: t('palette.groupThreads'),
        icon: Inbox,
        run: () => {
          inboxComm?.setSearch(q)
          navigate(lastInboxPath())
        },
      })
    }
    if (looksLikeThreadQuery(q)) {
      extras.push({
        id: 'open-by-id',
        label: t('palette.openById'),
        hint: q,
        group: t('palette.groupThreads'),
        icon: Inbox,
        run: () => navigate(lastInboxPath(q)),
      })
    }
    const runPair = q.match(/^([0-9a-f-]{8,})\s+([0-9a-f-]{8,})$/i)
    if (runPair) {
      extras.push({
        id: 'open-run',
        label: t('palette.openRun'),
        hint: q,
        group: t('palette.groupThreads'),
        icon: Bot,
        run: () => navigate(agentWorkforceRunUrl(runPair[1]!, runPair[2]!)),
      })
    }
    const threads: PaletteItem[] = threadResults.map((thread) => ({
      id: `thread-${thread.id}`,
      label: thread.emailSubject || t('palette.untitledConversation'),
      hint: thread.contactName || thread.contactEmail || undefined,
      group: t('palette.groupThreads'),
      icon: Inbox,
      run: () => navigate(threadHubPath(thread)),
    }))
    const contacts: PaletteItem[] = contactResults.map((contact) => ({
      id: `contact-${contact.id}`,
      label: contact.displayName || contact.address || t('palette.unnamedContact'),
      hint: contact.address || undefined,
      group: t('palette.groupContacts'),
      icon: User,
      run: () => navigate(`/contacts/${contact.id}`),
    }))
    const docs: PaletteItem[] = docResults
      .filter((hit) => hit.doc_id)
      .map((hit) => ({
        id: `doc-${hit.doc_id}`,
        label: humanizeKnowledgeTitle(hit.title) || t('knowledgePage.emptyTitle'),
        hint: hit.content?.slice(0, 80) || undefined,
        group: t('palette.groupKnowledge'),
        icon: FileText,
        run: () => navigate(`/knowledge/${hit.doc_id}`),
      }))
    return [...extras, ...threads, ...contacts, ...docs]
  }, [threadResults, contactResults, docResults, navigate, t, query, inboxComm])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const unique = (items: PaletteItem[]) => {
      const seen = new Set<string>()
      const next: PaletteItem[] = []
      for (const item of items) {
        const key = item.href ? `href:${item.href}` : item.id
        if (seen.has(item.id) || seen.has(key)) continue
        seen.add(item.id)
        seen.add(key)
        next.push(item)
      }
      return next
    }
    if (!q) return unique([...recentItems, ...catalog.actions, ...catalog.nav])
    const haystack = [
      ...catalog.nav,
      ...catalog.inboxQueues,
      ...catalog.settings,
      ...catalog.sessions,
      ...catalog.actions,
      ...recentItems,
    ]
    const local = haystack.filter(
      (item) => item.label.toLowerCase().includes(q) || item.hint?.toLowerCase().includes(q),
    )
    return unique([...local, ...remoteItems])
  }, [catalog, recentItems, remoteItems, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setRecent(listRecentPages())
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  const runItem = (item: PaletteItem) => {
    onClose()
    item.run()
  }

  const suggestions: PaletteItem[] = [
    catalog.actions[0],
    catalog.nav.find((item) => item.id === 'nav-communication') ?? catalog.actions[1],
    catalog.actions.find((item) => item.id === 'action-setup-guide') ?? catalog.actions[catalog.actions.length - 1],
  ].filter((item): item is PaletteItem => Boolean(item))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[selectedIndex]
      if (item) runItem(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup: string | null = null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh]">
      <button
        type="button"
        aria-label={t('palette.ariaClose')}
        className="absolute inset-0 bg-black/48 backdrop-blur-[6px] animate-fade-in"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-xl border border-border/60 bg-bg-surface shadow-overlay animate-pop-in"
        role="dialog"
        aria-label={t('palette.ariaDialog')}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          className="w-full border-b border-border/60 bg-transparent px-4 py-3.5 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-[13px] text-text-muted">{t('palette.noResults')}</p>
              <p className="mt-1 text-[12px] text-text-secondary">{t('palette.tryInstead')}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => runItem(item)}
                    className="rounded-lg border border-border/60 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            filtered.map((item, index) => {
              const showGroup = item.group !== lastGroup
              lastGroup = item.group
              const Icon = item.icon
              const selected = index === selectedIndex
              return (
                <div key={item.id}>
                  {showGroup ? (
                    <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      {item.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    data-selected={selected}
                    onClick={() => runItem(item)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    data-active={selected || undefined}
                    className={`row-interactive flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                      selected ? 'bg-accent/12 text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50'
                    }`}
                  >
                    <Icon size={14} className={selected ? 'text-accent' : 'text-text-muted'} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="hidden max-w-[200px] truncate text-[11px] text-text-muted sm:block">
                        {item.hint}
                      </span>
                    ) : null}
                    {selected ? <CornerDownLeft size={12} className="text-text-muted" /> : null}
                  </button>
                </div>
              )
            })
          )}
        </div>
        <p className="border-t border-border/50 px-3 py-2 text-[11px] text-text-muted">{t('palette.footerHint')}</p>
      </div>
    </div>
  )
}
