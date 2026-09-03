import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  Activity,
  Bot,
  ChevronRight,
  Inbox,
  Plus,
  Scale,
  Settings,
  Tag,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { useSignalTags } from '../../hooks/useSignalTags'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { isChannelParked } from '../../lib/channel-surface'
import { bokitoListChatTargets, mergeSidebarTagRows, type ChatTarget } from '../../lib/signals-api'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { countForInboxQueue } from '../../lib/nav-badge-counts'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  inboxPath,
  activityTerminalPath,
  agentChatPath,
  decisionsPath,
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
  /** Item count shown as a muted `(n)` after the title. Omit while loading. */
  count?: number | null
  headerAction?: ReactNode
  children: ReactNode
}

/** Square gear control — fixed size so hover/hitbox stay circular, not a thin strip. */
function SectionGearLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary"
      onClick={(e) => e.stopPropagation()}
    >
      <Settings size={12} strokeWidth={2} aria-hidden />
    </Link>
  )
}

const SECTION_GEAR: Partial<
  Record<SidebarSection, { to: string; labelKey: string; defaultLabel: string }>
> = {
  channels: {
    to: '/settings/channels',
    labelKey: 'support.channels.settingsAria',
    defaultLabel: 'Manage channels',
  },
  tags: {
    to: '/settings/channels#tags',
    labelKey: 'support.tags.settingsAria',
    defaultLabel: 'Manage tags',
  },
  agents: {
    to: '/agents',
    labelKey: 'support.agents.settingsAria',
    defaultLabel: 'Manage agents',
  },
}

/** Section header with persisted collapse state from sidebar prefs. */
function CollapsibleSection({ section, title, count, headerAction, children }: CollapsibleSectionProps) {
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
          className="nav-row flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted hover:text-text-secondary"
          aria-expanded={open}
        >
          <ChevronRight
            size={11}
            strokeWidth={2.25}
            aria-hidden
            className={cn(
              'shrink-0 text-text-muted/55 transition-transform duration-150 ease-out',
              open && 'rotate-90 text-text-muted/80',
            )}
          />
          <span className="min-w-0 truncate text-left">{title}</span>
          {count != null ? (
            <span className="shrink-0 font-medium normal-case tracking-normal text-text-muted/65">
              ({count})
            </span>
          ) : null}
          <span className="min-w-0 flex-1" aria-hidden />
        </button>
        {/* Section tools stay hidden until the section (or a row in it) is
            hovered or focused, so the rail reads as folders only. */}
        {headerAction ? (
          <span className="inline-flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100">
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
  folders: ChannelFolder[]
  loading: boolean
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}

type ChannelFolder = {
  leaf: HubLeaf
  label: string
  icon: ReactNode
  title?: string
}

/** Connected channel folders shown under the Channels section (email + enabled accounts). */
function useConnectedChannelFolders(t: TFn): { folders: ChannelFolder[]; loading: boolean } {
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
  const folders = useMemo(() => {
    const enabledAccounts = accounts.filter((a) => a.isEnabled)
    const hasWidget = enabledAccounts.some((a) => a.channel === 'widget')
    const hasSlack =
      !isChannelParked('slack') && enabledAccounts.some((a) => a.channel === 'slack')
    const hasWhatsApp = enabledAccounts.some((a) => a.channel === 'whatsapp')

    // Only list channels that are actually connected — empty stubs clutter the rail.
    const next: ChannelFolder[] = [
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
    return next
  }, [accounts, connections, t])

  return { folders, loading }
}

function ChannelsSection({ folders, loading, activeLeaf, defaultQueueFor, t }: ChannelsSectionProps) {
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
  rows: ReturnType<typeof mergeSidebarTagRows> | null
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}

function useSidebarTagRows() {
  const { prefs } = useInboxFolderPrefs()
  const { rows: catalog } = useSignalTags()
  return useMemo(
    () => (catalog == null ? null : mergeSidebarTagRows(prefs.sidebarTags, catalog)),
    [catalog, prefs.sidebarTags],
  )
}

function TagsSection({ rows, activeLeaf, defaultQueueFor, t }: TagsSectionProps) {
  return (
    <div className="space-y-0.5">
      {rows === null ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.tags.loading')}</p>
      ) : rows.length === 0 ? (
        <div className="space-y-1 px-3 py-1">
          <p className="text-[12px] text-text-muted">{t('support.tags.empty')}</p>
          <Link
            to={inboxPath('open')}
            className="block text-[11px] font-medium text-accent hover:underline"
          >
            {t('support.tags.openToTag')}
          </Link>
        </div>
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
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}

function AgentsSection({ agents, loading, activeLeaf, defaultQueueFor, t }: AgentsSectionProps) {
  const location = useLocation()
  const activityTerminalActive = location.pathname === '/activity' || location.pathname.startsWith('/activity/')
  const locationSearch = location.search
  return (
    <div className="space-y-0.5">
      {loading ? (
        <p className="px-3 py-1 text-[12px] text-text-muted">{t('support.agents.loading')}</p>
      ) : null}
      {!loading && agents.length === 0 ? (
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
        const activityActive =
          activityTerminalActive && new URLSearchParams(locationSearch).get('agent') === agent.id
        return (
          <SidebarFolder
            key={agent.id}
            baseLeaf={baseLeaf}
            label={agent.name}
            icon={<Bot size={14} className="shrink-0 text-ai-ink" />}
            activeLeaf={activeLeaf}
            defaultQueue={defaultQueueFor(baseLeaf)}
            extra={
              <NavLink
                to={activityTerminalPath(agent.id)}
                title={t('support.agents.activityHint')}
                className={() =>
                  cn(
                    'nav-row nav-sub-row flex items-center gap-2 rounded-lg border px-3 py-1 text-[12px] font-medium',
                    activityActive
                      ? 'border-border/60 bg-bg-hover/85 text-text-heading'
                      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
                  )
                }
              >
                <span className="min-w-0 flex-1 truncate">{t('support.agents.activity')}</span>
              </NavLink>
            }
          />
        )
      })}
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
  const { folders: channelFolders, loading: channelsLoading } = useConnectedChannelFolders(t)
  const tagRows = useSidebarTagRows()

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

  const companyAgents = targets.filter((target) => target.kind === 'company')
  const inboxBaseLeaf: HubLeaf = { type: 'inbox' }
  const inboxDefaultQueue = defaultQueueFor(inboxBaseLeaf)
  const inboxBadge = countForInboxQueue(counts, inboxDefaultQueue)

  const sectionCounts: Partial<Record<SidebarSection, number | null>> = {
    channels: channelsLoading ? null : channelFolders.length,
    tags: tagRows == null ? null : tagRows.length,
    agents: targetsLoading ? null : companyAgents.length,
  }

  const sectionContent: Record<Exclude<SidebarSection, 'settings'>, ReactNode> = {
    channels: (
      <ChannelsSection
        folders={channelFolders}
        loading={channelsLoading}
        activeLeaf={activeLeaf}
        defaultQueueFor={defaultQueueFor}
        t={t}
      />
    ),
    tags: (
      <TagsSection
        rows={tagRows}
        activeLeaf={activeLeaf}
        defaultQueueFor={defaultQueueFor}
        t={t}
      />
    ),
    agents: (
      <AgentsSection
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
                {/* Decisions: the human gate lives inside All communication as a
                    purple sub-view — it is a queue over the same threads. */}
                <NavLink
                  to={decisionsPath()}
                  title={t('support.decisions.hint')}
                  className={() =>
                    cn(
                      'nav-row nav-sub-row flex items-center gap-2 rounded-lg border px-3 py-1 text-[12px] font-medium',
                      activeLeaf?.type === 'decisions'
                        ? 'border-ai/35 bg-ai/12 text-ai-ink'
                        : 'border-transparent text-ai-ink hover:border-ai/30 hover:bg-ai/10',
                    )
                  }
                >
                  <Scale size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t('support.decisions.label')}</span>
                  <NavCountBadge count={counts.agentsAttention} placement="inline" />
                </NavLink>
              </>
            }
          />
        </section>

        {visibleSections.map((section) => {
          const gear = SECTION_GEAR[section]
          return (
            <CollapsibleSection
              key={section}
              section={section}
              title={t(SECTION_LABELS[section].labelKey)}
              count={sectionCounts[section]}
              headerAction={
                gear ? (
                  <SectionGearLink
                    to={gear.to}
                    label={t(gear.labelKey, { defaultValue: gear.defaultLabel })}
                  />
                ) : undefined
              }
            >
              {sectionContent[section as Exclude<SidebarSection, 'settings'>]}
            </CollapsibleSection>
          )
        })}
      </div>

      {/* Pinned bottom: platform-wide views that are not communication folders. */}
      <div className="mt-2 shrink-0 space-y-0.5 border-t border-border/40 pt-2">
        <NavLink
          to={activityTerminalPath()}
          title={t('support.activity.hint')}
          className={({ isActive }) =>
            navLinkClass(isActive && !new URLSearchParams(location.search).get('agent'))
          }
        >
          <Activity size={14} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate">{t('support.activity.label')}</span>
        </NavLink>
        <NavLink
          to="/contacts"
          title={t('support.contacts.hint')}
          className={({ isActive }) => navLinkClass(isActive)}
        >
          <Users size={14} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate">{t('support.contacts.label')}</span>
        </NavLink>
        {settingsVisible ? (
          <NavLink
            to="/settings/channels"
            title={t('support.settings.channels')}
            className={({ isActive }) => navLinkClass(isActive)}
          >
            <Settings size={14} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{t('support.section.settings')}</span>
          </NavLink>
        ) : null}
      </div>
    </div>
  )
}
