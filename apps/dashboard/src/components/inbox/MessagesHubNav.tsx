import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  ChevronDown,
  Gavel,
  Inbox,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AgentOptionRow } from '../ui/AgentOptionRow'
import { NavSectionSkeleton } from '../ui/skeleton'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { isChannelParked } from '../../lib/channel-surface'
import { bokitoListChatTargets, type ChatTarget } from '../../lib/signals-api'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { countForInboxQueue } from '../../lib/nav-badge-counts'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  decisionsPath,
  inboxPath,
  leafFromPath,
  leafKey,
  leafPath,
  newConversationPath,
  type HubLeaf,
  type InboxQueue,
  type SubQueue,
} from '../../lib/messages-paths'
import { SidebarFolder } from './QueueSublist'
import NavCountBadge from '../layout/NavCountBadge'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import ScrollFade from '../ui/ScrollFade'

function navLinkClass(_isActive: boolean) {
  // Active state is carried by data-active / aria-current (see `.nav-row`).
  return 'nav-row'
}

const EXTRA_INBOX_ITEMS: ReadonlyArray<{ queue: InboxQueue; labelKey: string }> = [
  { queue: 'snoozed', labelKey: 'support.inbox.snoozed' },
  { queue: 'spam', labelKey: 'support.inbox.spam' },
]

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  agents: { labelKey: 'support.section.agents', defaultLabel: 'Chat with agents' },
  channels: { labelKey: 'support.section.channels', defaultLabel: 'Channels' },
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
    <section data-section={section} className="group/section space-y-px">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => {
            if (collapsed) setMounted(true)
            setSectionCollapsed(section, !collapsed)
          }}
          className="nav-folder min-w-0 flex-1"
          aria-expanded={open}
          data-open={open ? 'true' : 'false'}
        >
          <ChevronDown aria-hidden />
          <span className="min-w-0 shrink truncate-fade text-left">{title}</span>
          {count != null ? <span className="shrink-0 tabular-nums text-text-muted/70">{count}</span> : null}
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

function ComposePlusLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-heading"
    >
      <Plus size={13} />
    </Link>
  )
}

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
      {loading ? <NavSectionSkeleton rows={3} /> : null}
      {!loading && !hasAnyChannel ? (
        <Link
          to="/settings/channels"
          title={t('support.channels.connectChannel')}
          className="nav-row border border-dashed border-border/80 text-xs"
        >
          <Plus aria-hidden />
          <span className="min-w-0 flex-1 truncate-fade">{t('support.channels.connectChannel')}</span>
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
          headerAction={
            folder.leaf.type === 'channel' && folder.leaf.channelKey === 'email' && folder.leaf.connectionId ? (
              <ComposePlusLink
                to={newConversationPath({ intent: 'contact', connectionId: folder.leaf.connectionId })}
                label={t('support.composeFromChannel')}
              />
            ) : folder.leaf.type === 'channel' ? (
              <ComposePlusLink
                to={newConversationPath({ intent: 'contact' })}
                label={t('support.composeFromChannel')}
              />
            ) : null
          }
        />
      ))}
    </div>
  )
}

type AgentsSectionProps = {
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}

/** Talk to a company agent — one row each, no duplicated Open/Mine queue tree. */
function AgentsSection({ agents, loading, activeLeaf, t }: AgentsSectionProps) {
  return (
    <div className="space-y-px">
      {loading ? <NavSectionSkeleton rows={2} /> : null}
      {!loading && agents.length === 0 ? (
        <div className="space-y-1 px-2 py-1">
          <p className="text-xs text-text-muted">{t('support.agents.empty')}</p>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            <Link to="/agents" className="text-xs font-medium text-text-secondary hover:text-text-heading hover:underline">
              {t('tabs.agents.title')}
            </Link>
            <Link
              to="/settings/setup"
              className="text-xs font-medium text-text-secondary hover:text-text-heading hover:underline"
            >
              {t('settings.links.setupGuide')}
            </Link>
          </div>
        </div>
      ) : null}
      {agents.map((agent) => {
        const openLeaf: HubLeaf = { type: 'agent', agentId: agent.id, queue: 'open' }
        const isActive = activeLeaf?.type === 'agent' && activeLeaf.agentId === agent.id
        return (
          <div key={agent.id} className="group/agent flex items-center gap-0.5">
            <NavLink
              to={leafPath(openLeaf)}
              title={t('support.composeToAgent')}
              data-active={isActive ? 'true' : undefined}
              className="nav-row min-w-0 flex-1"
            >
              <AgentOptionRow agent={agent} size={16} className="min-w-0 flex-1" />
            </NavLink>
            <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/agent:opacity-100">
              <ComposePlusLink
                to={newConversationPath({ intent: 'agent', agentId: agent.id })}
                label={t('support.composeToAgent')}
              />
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Communication hub inner rail.
 *
 * Fixed top: New chat + Inbox + Decisions.
 * Scrollable middle: Agents / Channels (user order).
 * Anchored bottom: Contacts + Settings.
 *
 * Decisions is the exception queue (open DecisionRequests). Agent runs stay
 * off the rail — work shows up on the thread that produced it.
 *
 * Personal Bokito helper history stays in the in-app widget only — not listed
 * here as channels.
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
  const decisionsBadge = countForInboxQueue(counts, 'decisions')
  const decisionsActive = activeLeaf?.type === 'decisions'

  // Hide "(0)" — it reads as unfinished; the empty CTA inside the section is enough.
  const sectionCounts: Partial<Record<SidebarSection, number | null>> = {
    channels: channelsLoading ? null : channelFolders.length > 0 ? channelFolders.length : null,
    agents: targetsLoading ? null : companyAgents.length > 0 ? companyAgents.length : null,
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
    agents: (
      <AgentsSection
        agents={companyAgents}
        loading={targetsLoading}
        activeLeaf={activeLeaf}
        t={t}
      />
    ),
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollFade className="space-y-3 pb-1">
        {/* Fixed block: New chat + Inbox */}
        <section>
          <NavLink
            to={newConversationPath()}
            className="nav-row border border-border/70 bg-bg-surface text-text-heading hover:border-border-light"
          >
            <Plus aria-hidden />
            <span>{t('support.newChat')}</span>
          </NavLink>
        </section>

        <section className="space-y-px">
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
                      data-active={isActive ? 'true' : undefined}
                      className="nav-row nav-sub-row h-[26px] text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate-fade">{t(item.labelKey)}</span>
                      <NavCountBadge count={countForInboxQueue(counts, item.queue)} placement="inline" />
                    </NavLink>
                  )
                })}
              </>
            }
          />
        </section>

        <section>
          <NavLink
            to={decisionsPath()}
            title={t('support.decisions.hint')}
            data-active={decisionsActive ? 'true' : undefined}
            className={navLinkClass(decisionsActive)}
          >
            <Gavel aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.decisions.label')}</span>
            <NavCountBadge count={decisionsBadge} placement="inline" />
          </NavLink>
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
      </ScrollFade>

      {/* Pinned bottom: platform-wide views that are not communication folders.
          Agent runs and the activity terminal are not listed — agent work shows
          up in the thread it belongs to. */}
      <div className="mt-1 shrink-0 space-y-px border-t border-border/60 pt-1.5">
        <NavLink to="/contacts" title={t('support.contacts.hint')} className={navLinkClass(false)}>
          <Users aria-hidden />
          <span className="min-w-0 flex-1 truncate-fade">{t('support.contacts.label')}</span>
        </NavLink>
        {settingsVisible ? (
          <NavLink to="/settings/channels" title={t('support.settings.channels')} className={navLinkClass(false)}>
            <Settings aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.settings.channels')}</span>
          </NavLink>
        ) : null}
      </div>
    </div>
  )
}
