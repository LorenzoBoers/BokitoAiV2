import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  Bot,
  Inbox,
  Mail,
  Plus,
  Settings,
  Sparkles,
  Tag,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { useSignalTags } from '../../hooks/useSignalTags'
import { bokitoListChatTargets, type ChatTarget } from '../../lib/bokito-api'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { mergeSidebarTagRows } from '../../lib/signals-api'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { countForInboxQueue } from '../../lib/nav-badge-counts'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  agentRunsPath,
  inboxPath,
  leafFromPath,
  leafKey,
  newConversationPath,
  type HubLeaf,
  type InboxQueue,
  type SubQueue,
} from '../../lib/messages-paths'
import { SidebarFolder } from './QueueSublist'
import NavCountBadge from '../layout/NavCountBadge'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { cn } from '../../lib/utils'

function navLinkClass(isActive: boolean) {
  return cn(
    'nav-row flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium',
    isActive
      ? 'border-border/60 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
  )
}

const EXTRA_INBOX_ITEMS: ReadonlyArray<{ queue: InboxQueue; labelKey: string }> = [
  { queue: 'snoozed', labelKey: 'support.inbox.snoozed' },
  { queue: 'spam', labelKey: 'support.inbox.spam' },
]

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  agents: { labelKey: 'support.section.agents', defaultLabel: 'Agents' },
  channels: { labelKey: 'support.section.channels', defaultLabel: 'Channels' },
  tags: { labelKey: 'support.section.tags', defaultLabel: 'Tags' },
  settings: { labelKey: 'support.section.settings', defaultLabel: 'Settings' },
}

function isLeafActive(activeLeaf: HubLeaf | null, leaf: HubLeaf): boolean {
  return activeLeaf != null && leafKey(activeLeaf) === leafKey(leaf)
}

type CollapsibleSectionProps = {
  section: SidebarSection
  title: string
  headerAction?: ReactNode
  children: ReactNode
}

/** Section header with persisted collapse state from sidebar prefs. */
function CollapsibleSection({ section, title, headerAction, children }: CollapsibleSectionProps) {
  const { prefs, setSectionCollapsed } = useSidebarPrefs()
  const collapsed = prefs.collapsed.includes(section)
  const open = !collapsed
  // Keep children mounted through the close animation, then drop them so
  // collapsed sections do not keep fetching (channels/tags/agents).
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setMounted(false)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(timer)
  }, [open])

  return (
    <section data-section={section} className="group/section space-y-0.5">
      <div className="flex items-center gap-0.5 px-2 pb-1">
        <button
          type="button"
          onClick={() => {
            if (collapsed) setMounted(true)
            setSectionCollapsed(section, !collapsed)
          }}
          className="nav-row flex min-w-0 flex-1 items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted hover:text-text-secondary"
          aria-expanded={open}
        >
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        </button>
        {/* Section tools stay hidden until the section (or a row in it) is
            hovered or focused, so the rail reads as folders only. */}
        {headerAction ? (
          <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100">
            {headerAction}
          </span>
        ) : null}
      </div>
      <div className="nav-fold" data-open={open && mounted ? 'true' : undefined} aria-hidden={!open}>
        <div className="nav-fold-inner space-y-0.5">{mounted ? children : null}</div>
      </div>
    </section>
  )
}

type TFn = (key: string, opts?: { defaultValue?: string }) => string

type ChannelsSectionProps = {
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}

function ChannelsSection({ activeLeaf, defaultQueueFor, t }: ChannelsSectionProps) {
  const { token } = useAuth()
  const { activeConnections: connections, loading: connectionsLoading } = useMailboxConnections()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) {
        setAccounts([])
        setAccountsLoading(false)
        return
      }
      setAccountsLoading(true)
      try {
        const rows = await listChannelAccounts(token)
        if (!cancelled) setAccounts(rows)
      } catch {
        if (!cancelled) setAccounts([])
      } finally {
        if (!cancelled) setAccountsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const loading = connectionsLoading || accountsLoading
  const enabledAccounts = accounts.filter((a) => a.isEnabled)
  const hasWidget = enabledAccounts.some((a) => a.channel === 'widget')
  const hasSlack = enabledAccounts.some((a) => a.channel === 'slack')
  const hasWhatsApp = enabledAccounts.some((a) => a.channel === 'whatsapp')

  // Only list channels that are actually connected — empty stubs clutter the rail.
  const folders: Array<{ leaf: HubLeaf; label: string; icon: ReactNode; title?: string }> = [
    ...connections.map((conn) => ({
      leaf: { type: 'channel', channelKey: 'email', connectionId: String(conn.id) } as HubLeaf,
      label: mailboxDisplayLabel(conn.displayName, conn.mailboxEmail),
      icon: <ChannelGlyph channel="email" size={14} />,
    })),
    ...(hasWidget
      ? [
          {
            leaf: { type: 'channel', channelKey: 'webchat' } as HubLeaf,
            label: t('support.channels.webchat'),
            icon: <ChannelGlyph channel="widget" size={14} />,
          },
        ]
      : []),
    ...(hasWhatsApp
      ? [
          {
            leaf: { type: 'channel', channelKey: 'whatsapp' } as HubLeaf,
            label: t('support.channels.whatsapp'),
            icon: <ChannelGlyph channel="whatsapp" size={14} />,
          },
        ]
      : []),
    ...(hasSlack
      ? [
          {
            leaf: { type: 'channel', channelKey: 'slack' } as HubLeaf,
            label: t('support.channels.slack'),
            icon: <ChannelGlyph channel="slack" size={14} />,
          },
        ]
      : []),
  ]

  const hasAnyChannel = folders.length > 0

  return (
    <div className="space-y-0.5">
      {loading ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.channels.loading')}</p>
      ) : null}
      {!loading && !hasAnyChannel ? (
        <Link
          to="/settings/channels"
          title={t('support.channels.connectChannel')}
          className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-1.5 text-[12px] font-medium text-accent transition-colors duration-150 hover:bg-bg-hover/55 active:scale-[0.985]"
        >
          <Plus size={14} className="shrink-0" />
          <span className="min-w-0 truncate">{t('support.channels.connectChannel')}</span>
        </Link>
      ) : null}
      {folders.map((folder) => (
        <SidebarFolder
          key={leafKey(folder.leaf)}
          baseLeaf={folder.leaf}
          label={folder.label}
          icon={folder.icon}
          title={folder.title}
          activeLeaf={activeLeaf}
          defaultQueue={defaultQueueFor(folder.leaf)}
        />
      ))}
    </div>
  )
}

type TagsSectionProps = {
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}

function TagsSection({ activeLeaf, defaultQueueFor, t }: TagsSectionProps) {
  const { prefs } = useInboxFolderPrefs()
  const { rows: catalog } = useSignalTags()

  const rows = useMemo(
    () => (catalog == null ? null : mergeSidebarTagRows(prefs.sidebarTags, catalog)),
    [catalog, prefs.sidebarTags],
  )

  return (
    <div className="space-y-0.5">
      {rows === null ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.tags.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.tags.empty')}</p>
      ) : (
        rows.map((row) => {
          const leaf: HubLeaf = { type: 'tag', tag: row.tag }
          return (
            <SidebarFolder
              key={row.tag}
              baseLeaf={leaf}
              label={row.tag}
              title={row.tag}
              icon={<Tag size={14} className="shrink-0 text-text-muted" />}
              activeLeaf={activeLeaf}
              defaultQueue={defaultQueueFor(leaf)}
              badgeCount={row.open}
            />
          )
        })
      )}
      {rows != null && rows.length === 0 ? (
        <Link
          to="/settings/channels#tags"
          className="flex items-center gap-2 rounded-lg px-3 py-1 text-[11px] font-medium text-accent hover:underline"
        >
          {t('support.tags.manage')}
        </Link>
      ) : null}
    </div>
  )
}

type AgentsSectionProps = {
  assistant: ChatTarget | null
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}

function AgentsSection({ assistant, agents, loading, activeLeaf, defaultQueueFor, t }: AgentsSectionProps) {
  const activityActive =
    activeLeaf?.type === 'runs' ||
    (activeLeaf?.type === 'channel' && activeLeaf.channelKey === 'agent')

  return (
    <div className="space-y-0.5">
      {assistant ? (
        <SidebarFolder
          baseLeaf={{ type: 'assistant' }}
          label={t('crumbs.myAssistant')}
          title={assistant.name}
          icon={<Sparkles size={14} className="shrink-0 text-ai-ink" />}
          activeLeaf={activeLeaf}
          defaultQueue={defaultQueueFor({ type: 'assistant' })}
        />
      ) : null}
      {loading ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.agents.loading')}</p>
      ) : null}
      {!loading && agents.length === 0 && !assistant ? (
        <div className="space-y-1 px-3 py-1">
          <p className="text-[12px] text-text-muted">
            {t('support.agents.empty')}
          </p>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            <Link to="/agents" className="text-[11px] font-medium text-accent hover:underline">
              {t('tabs.agents.title')}
            </Link>
            <Link to="/settings/setup" className="text-[11px] font-medium text-accent hover:underline">
              {t('settings.links.setupGuide')}
            </Link>
          </div>
        </div>
      ) : null}
      {agents.map((agent) => {
        const baseLeaf: HubLeaf = { type: 'agent', agentId: agent.id }
        return (
          <SidebarFolder
            key={agent.id}
            baseLeaf={baseLeaf}
            label={agent.name}
            icon={<Bot size={14} className="shrink-0 text-text-muted" />}
            activeLeaf={activeLeaf}
            defaultQueue={defaultQueueFor(baseLeaf)}
          />
        )
      })}
      <NavLink
        to={agentRunsPath('all')}
        title={t('support.links.activityHint')}
        className={() => navLinkClass(Boolean(activityActive))}
      >
        <Bot size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t('support.links.activity')}
        </span>
      </NavLink>
    </div>
  )
}

function SettingsSection({ t }: { t: TFn }) {
  return (
    <div className="space-y-0.5">
      <NavLink to="/settings/channels" className={({ isActive }) => navLinkClass(isActive)}>
        <Mail size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t('support.settings.channels')}
        </span>
      </NavLink>
      <NavLink to="/settings/communication" className={({ isActive }) => navLinkClass(isActive)}>
        <Settings size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t('support.settings.assistant')}
        </span>
      </NavLink>
      <NavLink to="/settings" end className={({ isActive }) => navLinkClass(isActive)}>
        <Settings size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t('support.settings.allSettings')}
        </span>
      </NavLink>
    </div>
  )
}

/**
 * Communication hub inner rail.
 *
 * Fixed top: New chat + Inbox.
 * Scrollable middle: Agents / Channels (user order).
 * Anchored bottom: Settings.
 */
export default function MessagesHubNav() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { counts } = useNavBadges()
  const { visibleSections, settingsVisible } = useSidebarPrefs()
  const { defaultQueueFor } = useInboxFolderPrefs()
  const location = useLocation()
  const activeLeaf = leafFromPath(location.pathname)

  const [targets, setTargets] = useState<ChatTarget[]>([])
  const [targetsLoading, setTargetsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) return
      setTargetsLoading(true)
      try {
        const data = await bokitoListChatTargets(token)
        if (!cancelled) setTargets(data.items)
      } catch {
        if (!cancelled) setTargets([])
      } finally {
        if (!cancelled) setTargetsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const assistant = targets.find((target) => target.kind === 'personal') ?? null
  const companyAgents = targets.filter((target) => target.kind === 'company')
  const inboxBaseLeaf: HubLeaf = { type: 'inbox' }
  const inboxDefaultQueue = defaultQueueFor(inboxBaseLeaf)
  const inboxBadge = countForInboxQueue(counts, inboxDefaultQueue)

  const sectionContent: Record<Exclude<SidebarSection, 'settings'>, ReactNode> = {
    channels: <ChannelsSection activeLeaf={activeLeaf} defaultQueueFor={defaultQueueFor} t={t} />,
    tags: <TagsSection activeLeaf={activeLeaf} defaultQueueFor={defaultQueueFor} t={t} />,
    agents: (
      <AgentsSection
        assistant={assistant}
        agents={companyAgents}
        loading={targetsLoading}
        activeLeaf={activeLeaf}
        defaultQueueFor={defaultQueueFor}
        t={t}
      />
    ),
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {/* Fixed block: New chat + Inbox */}
        <section className="space-y-0.5">
          <NavLink
            to={newConversationPath()}
            className={({ isActive }) =>
              cn(
                'nav-row flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium',
                isActive
                  ? 'border-accent/40 bg-accent/10 text-text-heading'
                  : 'border-border/60 bg-bg-elevated/70 text-text-primary hover:border-accent/50 hover:bg-bg-hover/70',
              )
            }
          >
            <Plus size={14} className="shrink-0 text-accent" />
            <span>{t('support.newChat')}</span>
          </NavLink>
        </section>

        <section className="space-y-0.5">
          <SidebarFolder
            baseLeaf={inboxBaseLeaf}
            label={t('support.inbox.allCommunication')}
            title={t('support.inbox.allCommunicationHint')}
            icon={<Inbox size={14} className="shrink-0 text-text-muted" />}
            activeLeaf={activeLeaf}
            defaultQueue={inboxDefaultQueue}
            badgeCount={inboxBadge}
            extra={
              <>
                {EXTRA_INBOX_ITEMS.map((item) => {
                  const leaf: HubLeaf = { type: 'inbox', queue: item.queue }
                  const isActive = isLeafActive(activeLeaf, leaf)
                  return (
                    <NavLink
                      key={item.queue}
                      to={inboxPath(item.queue)}
                      title={t(`${item.labelKey}Hint`)}
                      className={() =>
                        cn(
                          'nav-row nav-sub-row flex items-center gap-2 rounded-lg border px-3 py-1 text-[12px] font-medium',
                          isActive
                            ? 'border-border/60 bg-bg-hover/85 text-text-heading'
                            : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
                        )
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                      <NavCountBadge count={countForInboxQueue(counts, item.queue)} placement="inline" />
                    </NavLink>
                  )
                })}
              </>
            }
          />
        </section>

        {visibleSections.map((section) => (
          <CollapsibleSection
            key={section}
            section={section}
            title={t(SECTION_LABELS[section].labelKey)}
            headerAction={
              section === 'tags' ? (
                <Link
                  to="/settings/channels#tags"
                  title={t('support.tags.settingsAria')}
                  aria-label={t('support.tags.settingsAria')}
                  className="rounded-md p-1 text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Settings size={12} />
                </Link>
              ) : undefined
            }
          >
            {sectionContent[section as Exclude<SidebarSection, 'settings'>]}
          </CollapsibleSection>
        ))}
      </div>

      {settingsVisible ? (
        <div className="shrink-0 border-t border-border/40 pt-3 mt-2">
          <CollapsibleSection
            section="settings"
            title={t(SECTION_LABELS.settings.labelKey)}
          >
            <SettingsSection t={t} />
          </CollapsibleSection>
        </div>
      ) : null}
    </div>
  )
}
