import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
  type RunsQueue,
} from '../../lib/messages-paths'
import NavCountBadge from '../layout/NavCountBadge'
import { UserAvatar } from '../ui/UserAvatar'
import { cn } from '../../lib/utils'

function navLinkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
  )
}

const INBOX_QUEUE_ITEMS: ReadonlyArray<{ queue: InboxQueue; labelKey: string; defaultLabel: string }> = [
  { queue: 'all', labelKey: 'support.inbox.all', defaultLabel: 'All' },
  { queue: 'mine', labelKey: 'support.inbox.mine', defaultLabel: 'Mine' },
  { queue: 'open', labelKey: 'support.inbox.open', defaultLabel: 'Open' },
  { queue: 'unassigned', labelKey: 'support.inbox.unassigned', defaultLabel: 'Unassigned' },
  { queue: 'closed', labelKey: 'support.inbox.closed', defaultLabel: 'Closed' },
]

const RUNS_QUEUE_ITEMS: ReadonlyArray<{ queue: RunsQueue; labelKey: string; defaultLabel: string }> = [
  { queue: 'all', labelKey: 'support.links.agentAll', defaultLabel: 'All activity' },
  { queue: 'updates', labelKey: 'support.links.updates', defaultLabel: 'Updates' },
  { queue: 'results', labelKey: 'support.links.results', defaultLabel: 'Results' },
  { queue: 'awaiting-decision', labelKey: 'support.links.agentDecisions', defaultLabel: 'Decisions' },
]

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  assistant: { labelKey: 'support.section.assistant', defaultLabel: 'Assistant' },
  channels: { labelKey: 'support.section.channels', defaultLabel: 'Channels' },
  agents: { labelKey: 'support.section.agents', defaultLabel: 'Agents' },
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

function AssistantSection({ assistant, activeLeaf }: { assistant: ChatTarget | null; activeLeaf: HubLeaf | null }) {
  return (
    <div className="space-y-0.5">
      <LeafLink
        leaf={{ type: 'assistant' }}
        to={assistantPath()}
        label={assistant?.name ?? 'Personal assistant'}
        icon={<Sparkles size={14} className="shrink-0 text-text-muted" />}
        activeLeaf={activeLeaf}
      />
    </div>
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
  const hasWhatsApp = accounts.some((a) => a.channel === 'whatsapp' && a.isEnabled)
  const hasSlack = accounts.some((a) => a.channel === 'slack' && a.isEnabled)

  return (
    <div className="space-y-0.5">
      {connectionsLoading ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.channels.loading', { defaultValue: 'Loading channels...' })}</p>
      ) : null}
      {enabledConnections.map((conn) => (
        <LeafLink
          key={conn.id}
          leaf={{ type: 'channel', channelKey: 'email', connectionId: String(conn.id) }}
          to={channelPath('email', { connectionId: conn.id })}
          label={conn.displayName || conn.mailboxEmail}
          icon={<Mail size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ))}
      <LeafLink
        leaf={{ type: 'channel', channelKey: 'webchat' }}
        to={channelPath('webchat')}
        label={t('support.channels.webchat', { defaultValue: 'Webchat' })}
        icon={<Globe size={14} className="shrink-0 text-text-muted" />}
        activeLeaf={activeLeaf}
      />
      <LeafLink
        leaf={{ type: 'channel', channelKey: 'internal' }}
        to={channelPath('internal')}
        label={t('support.channels.internal', { defaultValue: 'Internal chat' })}
        icon={<MessageSquare size={14} className="shrink-0 text-text-muted" />}
        activeLeaf={activeLeaf}
      />
      <LeafLink
        leaf={{ type: 'channel', channelKey: 'agent' }}
        to={channelPath('agent')}
        label={t('support.channels.agent', { defaultValue: 'Agent messages' })}
        icon={<Bot size={14} className="shrink-0 text-text-muted" />}
        activeLeaf={activeLeaf}
      />
      {hasWhatsApp ? (
        <LeafLink
          leaf={{ type: 'channel', channelKey: 'whatsapp' }}
          to={channelPath('whatsapp')}
          label="WhatsApp"
          icon={<MessageCircle size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ) : null}
      {hasSlack ? (
        <LeafLink
          leaf={{ type: 'channel', channelKey: 'slack' }}
          to={channelPath('slack')}
          label="Slack"
          icon={<Hash size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ) : null}
    </div>
  )
}

type AgentsSectionProps = {
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}

function AgentsSection({ agents, loading, activeLeaf, t }: AgentsSectionProps) {
  return (
    <div className="space-y-0.5">
      {loading ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.agents.loading', { defaultValue: 'Loading agents...' })}</p>
      ) : null}
      {!loading && agents.length === 0 ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">
          {t('support.agents.empty', { defaultValue: 'No agents available for chat.' })}
        </p>
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
      <p className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted/80">
        {t('support.agents.runs', { defaultValue: 'Agent runs' })}
      </p>
      {RUNS_QUEUE_ITEMS.map((item) => (
        <LeafLink
          key={item.queue}
          leaf={{ type: 'runs', queue: item.queue }}
          to={agentRunsPath(item.queue)}
          label={t(item.labelKey, { defaultValue: item.defaultLabel })}
          icon={<Bot size={14} className="shrink-0 text-text-muted" />}
          activeLeaf={activeLeaf}
        />
      ))}
    </div>
  )
}

function SettingsSection({ t }: { t: TFn }) {
  return (
    <div className="space-y-0.5">
      <NavLink to="/settings/channels" className={({ isActive }) => navLinkClass(isActive)}>
        <Mail size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t('support.settings.channels', { defaultValue: 'Channel settings' })}
        </span>
      </NavLink>
      <NavLink to="/settings/assistant" className={({ isActive }) => navLinkClass(isActive)}>
        <Settings size={14} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t('support.settings.assistant', { defaultValue: 'Assistant settings' })}
        </span>
      </NavLink>
    </div>
  )
}

/**
 * Communication hub inner rail.
 *
 * Fixed top: New chat + Inbox queues. Below: user-customizable sections
 * (order, visibility, collapse) persisted via SidebarPrefsContext.
 */
export default function MessagesHubNav() {
  const { t } = useTranslation('nav')
  const { user, token } = useAuth()
  const { counts } = useNavBadges()
  const { visibleSections } = useSidebarPrefs()
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

  const sectionContent: Record<SidebarSection, ReactNode> = {
    assistant: <AssistantSection assistant={assistant} activeLeaf={activeLeaf} />,
    channels: <ChannelsSection activeLeaf={activeLeaf} t={t} />,
    agents: <AgentsSection agents={companyAgents} loading={targetsLoading} activeLeaf={activeLeaf} t={t} />,
    settings: <SettingsSection t={t} />,
  }

  return (
    <div className="space-y-4">
      {/* Fixed block: New chat + Inbox */}
      <section className="space-y-0.5">
        <NavLink
          to={newConversationPath()}
          className={({ isActive }) =>
            cn(
              'flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'border-accent/40 bg-accent/10 text-text-heading'
                : 'border-border/70 bg-bg-elevated/70 text-text-primary hover:border-accent/50 hover:bg-bg-hover/70',
            )
          }
        >
          <Plus size={14} className="shrink-0 text-accent" />
          <span>{t('support.newChat', { defaultValue: 'New chat' })}</span>
        </NavLink>
      </section>

      <section className="space-y-0.5">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {t('support.section.inbox', { defaultValue: 'Inbox' })}
        </p>
        {INBOX_QUEUE_ITEMS.map((item) => (
          <LeafLink
            key={item.queue}
            leaf={{ type: 'inbox', queue: item.queue }}
            to={inboxPath(item.queue)}
            label={t(item.labelKey, { defaultValue: item.defaultLabel })}
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
      </section>

      {/* Customizable sections */}
      {visibleSections.map((section) => (
        <CollapsibleSection
          key={section}
          section={section}
          title={t(SECTION_LABELS[section].labelKey, { defaultValue: SECTION_LABELS[section].defaultLabel })}
        >
          {sectionContent[section]}
        </CollapsibleSection>
      ))}
    </div>
  )
}
