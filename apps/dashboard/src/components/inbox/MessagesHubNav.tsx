import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Globe,
  Hash,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { bokitoListChatTargets, type ChatTarget } from '../../lib/bokito-api'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { countForInboxQueue } from '../../lib/nav-badge-counts'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  agentChatPath,
  agentRunsPath,
  assistantPath,
  channelPath,
  inboxPath,
  leafFromPath,
  leafKey,
  newConversationPath,
  type HubLeaf,
  type InboxQueue,
} from '../../lib/messages-paths'
import NavCountBadge from '../layout/NavCountBadge'
import { UserAvatar } from '../ui/UserAvatar'
import { cn } from '../../lib/utils'

function navLinkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/60 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
  )
}

const PRIMARY_INBOX_QUEUES: ReadonlyArray<InboxQueue> = ['all', 'mine', 'open', 'unassigned']
const MORE_INBOX_QUEUES: ReadonlyArray<InboxQueue> = ['snoozed', 'closed', 'spam']

const INBOX_QUEUE_ITEMS: ReadonlyArray<{ queue: InboxQueue; labelKey: string; defaultLabel: string }> = [
  { queue: 'all', labelKey: 'support.inbox.all', defaultLabel: 'All' },
  { queue: 'mine', labelKey: 'support.inbox.mine', defaultLabel: 'Mine' },
  { queue: 'open', labelKey: 'support.inbox.open', defaultLabel: 'Open' },
  { queue: 'unassigned', labelKey: 'support.inbox.unassigned', defaultLabel: 'Unassigned' },
  { queue: 'snoozed', labelKey: 'support.inbox.snoozed', defaultLabel: 'Snoozed' },
  { queue: 'closed', labelKey: 'support.inbox.closed', defaultLabel: 'Closed' },
  { queue: 'spam', labelKey: 'support.inbox.spam', defaultLabel: 'Spam' },
]

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  agents: { labelKey: 'support.section.agents', defaultLabel: 'Agents' },
  channels: { labelKey: 'support.section.channels', defaultLabel: 'Channels' },
  settings: { labelKey: 'support.section.settings', defaultLabel: 'Settings' },
}

function isLeafActive(activeLeaf: HubLeaf | null, leaf: HubLeaf): boolean {
  return activeLeaf != null && leafKey(activeLeaf) === leafKey(leaf)
}

type LeafLinkProps = {
  leaf: HubLeaf
  to: string
  label: string
  icon: ReactNode
  badgeCount?: number
  activeLeaf: HubLeaf | null
}

function LeafLink({ leaf, to, label, icon, badgeCount = 0, activeLeaf }: LeafLinkProps) {
  const isActive = isLeafActive(activeLeaf, leaf)
  return (
    <NavLink to={to} className={() => navLinkClass(isActive)}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <NavCountBadge count={badgeCount} placement="inline" />
    </NavLink>
  )
}

type CollapsibleSectionProps = {
  section: SidebarSection
  title: string
  children: ReactNode
}

/** Section header with persisted collapse state from sidebar prefs. */
function CollapsibleSection({ section, title, children }: CollapsibleSectionProps) {
  const { prefs, setSectionCollapsed } = useSidebarPrefs()
  const collapsed = prefs.collapsed.includes(section)

  return (
    <section data-section={section} className="space-y-0.5">
      <button
        type="button"
        onClick={() => setSectionCollapsed(section, !collapsed)}
        className="flex w-full items-center gap-1 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted hover:text-text-secondary"
        aria-expanded={!collapsed}
      >
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {collapsed ? <ChevronRight size={11} className="shrink-0" /> : <ChevronDown size={11} className="shrink-0" />}
      </button>
      {collapsed ? null : children}
    </section>
  )
}

type TFn = (key: string, opts?: { defaultValue?: string }) => string

type ChannelsSectionProps = {
  activeLeaf: HubLeaf | null
  t: TFn
}

function ChannelsSection({ activeLeaf, t }: ChannelsSectionProps) {
  const { token } = useAuth()
  const { connections, loading: connectionsLoading } = useMailboxConnections()
  const [accounts, setAccounts] = useState<ChannelAccountRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) return
      try {
        const rows = await listChannelAccounts(token)
        if (!cancelled) setAccounts(rows)
      } catch {
        if (!cancelled) setAccounts([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const enabledConnections = useMemo(
    () => connections.filter((c) => c.status !== 'revoked' && c.isEnabled !== false),
    [connections],
  )
  const hasSlack = accounts.some((a) => a.channel === 'slack' && a.isEnabled)
  const hasWhatsApp = accounts.some((a) => a.channel === 'whatsapp' && a.isEnabled)

  return (
    <div className="space-y-0.5">
      {connectionsLoading ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.channels.loading')}</p>
      ) : null}
      {enabledConnections.map((conn) => (
        <LeafLink
          key={conn.id}
          leaf={{ type: 'channel', channelKey: 'email', connectionId: String(conn.id) }}
          to={channelPath('email', { connectionId: conn.id })}
          label={mailboxDisplayLabel(conn.displayName, conn.mailboxEmail)}
          icon={<Mail size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ))}
      <LeafLink
        leaf={{ type: 'channel', channelKey: 'webchat' }}
        to={channelPath('webchat')}
        label={t('support.channels.webchat')}
        icon={<Globe size={14} className="shrink-0 text-text-muted" />}
        activeLeaf={activeLeaf}
      />
      <LeafLink
        leaf={{ type: 'channel', channelKey: 'internal' }}
        to={channelPath('internal')}
        label={t('support.channels.internal')}
        icon={<MessageSquare size={14} className="shrink-0 text-text-muted" />}
        activeLeaf={activeLeaf}
      />
      {hasWhatsApp ? (
        <LeafLink
          leaf={{ type: 'channel', channelKey: 'whatsapp' }}
          to={channelPath('whatsapp')}
          label={t('support.channels.whatsapp')}
          icon={<MessageCircle size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ) : null}
      {hasSlack ? (
        <LeafLink
          leaf={{ type: 'channel', channelKey: 'slack' }}
          to={channelPath('slack')}
          label={t('support.channels.slack')}
          icon={<Hash size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ) : null}
    </div>
  )
}

type AgentsSectionProps = {
  assistant: ChatTarget | null
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}

function AgentsSection({ assistant, agents, loading, activeLeaf, t }: AgentsSectionProps) {
  const activityActive =
    activeLeaf?.type === 'runs' ||
    (activeLeaf?.type === 'channel' && activeLeaf.channelKey === 'agent')

  return (
    <div className="space-y-0.5">
      {assistant ? (
        <LeafLink
          leaf={{ type: 'assistant' }}
          to={assistantPath()}
          label={assistant.name}
          icon={<Sparkles size={14} className="shrink-0 text-ai-ink" />}
          activeLeaf={activeLeaf}
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
      {agents.map((agent) => (
        <LeafLink
          key={agent.id}
          leaf={{ type: 'agent', agentId: agent.id }}
          to={agentChatPath(agent.id)}
          label={agent.name}
          icon={<Bot size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ))}
      <NavLink
        to={agentRunsPath('all')}
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
  const { user, token } = useAuth()
  const { counts } = useNavBadges()
  const { visibleSections, settingsVisible } = useSidebarPrefs()
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
  const activeInboxQueue = activeLeaf?.type === 'inbox' ? activeLeaf.queue : null
  const moreQueueActive = Boolean(activeInboxQueue && MORE_INBOX_QUEUES.includes(activeInboxQueue))
  const [moreQueuesOpen, setMoreQueuesOpen] = useState(moreQueueActive)

  useEffect(() => {
    if (moreQueueActive) setMoreQueuesOpen(true)
  }, [moreQueueActive])

  const primaryQueues = INBOX_QUEUE_ITEMS.filter((item) => PRIMARY_INBOX_QUEUES.includes(item.queue))
  const moreQueues = INBOX_QUEUE_ITEMS.filter((item) => MORE_INBOX_QUEUES.includes(item.queue))
  const moreQueueBadge = moreQueues.reduce((sum, item) => sum + countForInboxQueue(counts, item.queue), 0)

  const sectionContent: Record<Exclude<SidebarSection, 'settings'>, ReactNode> = {
    channels: <ChannelsSection activeLeaf={activeLeaf} t={t} />,
    agents: (
      <AgentsSection
        assistant={assistant}
        agents={companyAgents}
        loading={targetsLoading}
        activeLeaf={activeLeaf}
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
                'flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
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
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('support.section.inbox')}
          </p>
          {primaryQueues.map((item) => (
            <LeafLink
              key={item.queue}
              leaf={{ type: 'inbox', queue: item.queue }}
              to={inboxPath(item.queue)}
              label={t(item.labelKey)}
              icon={
                item.queue === 'mine' ? (
                  <UserAvatar
                    name={user?.name ?? '?'}
                    email={user?.email ?? ''}
                    avatarUrl={user?.avatarUrl}
                    size={14}
                  />
                ) : (
                  <Inbox size={14} className="shrink-0 text-text-muted" />
                )
              }
              badgeCount={countForInboxQueue(counts, item.queue)}
              activeLeaf={activeLeaf}
            />
          ))}
          <button
            type="button"
            onClick={() => setMoreQueuesOpen((open) => !open)}
            className={navLinkClass(moreQueueActive && !moreQueuesOpen)}
            aria-expanded={moreQueuesOpen}
          >
            {moreQueuesOpen ? (
              <ChevronDown size={14} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-text-muted" />
            )}
            <span className="min-w-0 flex-1 truncate text-left">
              {t('support.moreQueues')}
            </span>
            {!moreQueuesOpen ? <NavCountBadge count={moreQueueBadge} placement="inline" /> : null}
          </button>
          {moreQueuesOpen
            ? moreQueues.map((item) => (
                <LeafLink
                  key={item.queue}
                  leaf={{ type: 'inbox', queue: item.queue }}
                  to={inboxPath(item.queue)}
                  label={t(item.labelKey)}
                  icon={<Inbox size={14} className="shrink-0 text-text-muted" />}
                  badgeCount={countForInboxQueue(counts, item.queue)}
                  activeLeaf={activeLeaf}
                />
              ))
            : null}
        </section>

        {visibleSections.map((section) => (
          <CollapsibleSection
            key={section}
            section={section}
            title={t(SECTION_LABELS[section].labelKey)}
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
