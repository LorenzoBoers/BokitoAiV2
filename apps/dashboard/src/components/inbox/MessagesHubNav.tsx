import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ChevronDown, Folder, FolderKanban, Inbox, Plus, Settings, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AiAvatar } from '../ui/AiAvatar'
import { TeamAvatar } from '../ui/TeamAvatar'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import { openTeamRoom } from '../../lib/teams-api'
import { asAgentStatus } from '../../lib/presence'
import { useAgentLive, seedAgentPresence } from '../../hooks/useAgentPresence'
import { NavSectionSkeleton } from '../ui/skeleton'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { isChannelParked } from '../../lib/channel-surface'
import {
  bokitoListChatTargets,
  folderFilterFromParams,
  folderFilterQuery,
  sameFolderFilter,
  type ChatTarget,
  type InboxFolder,
} from '../../lib/signals-api'
import { useInboxFolders } from '../../hooks/useInboxFolders'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { countForInboxQueue, countForTeam } from '../../lib/nav-badge-counts'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  activityTerminalPath,
  inboxPath,
  leafFromPath,
  leafKey,
  newConversationPath,
  teamPath,
  type HubLeaf,
  type InboxQueue,
  type SubQueue,
} from '../../lib/messages-paths'
import { openEntityPath } from '../../lib/open-entity'
import type { Team } from '../../lib/teams-api'
import { useTeams } from '../../hooks/useTeams'
import { SidebarFolder } from './QueueSublist'
import NavCountBadge from '../layout/NavCountBadge'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import ScrollFade from '../ui/ScrollFade'
import { Tip } from '../ui/Tip'

const EXTRA_INBOX_ITEMS: ReadonlyArray<{ queue: InboxQueue; labelKey: string }> = [
  { queue: 'snoozed', labelKey: 'support.inbox.snoozed' },
  { queue: 'spam', labelKey: 'support.inbox.spam' },
]

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  folders: { labelKey: 'support.section.folders', defaultLabel: 'Folders' },
  channels: { labelKey: 'support.section.channels', defaultLabel: 'Channels' },
  agents: { labelKey: 'support.section.agents', defaultLabel: 'Chat with agents' },
  teams: { labelKey: 'support.section.teams', defaultLabel: 'Teams' },
  settings: { labelKey: 'support.section.settings', defaultLabel: 'Settings' },
}

function isLeafActive(activeLeaf: HubLeaf | null, leaf: HubLeaf): boolean {
  return activeLeaf != null && leafKey(activeLeaf) === leafKey(leaf)
}

type CollapsibleSectionProps = {
  section: SidebarSection
  title: string
  count?: number | null
  headerAction?: ReactNode
  children: ReactNode
}

/** Square gear control — fixed size so hover/hitbox stay circular, not a thin strip. */
function SectionGearLink({ to, label }: { to: string; label: string }) {
  return (
    <Tip label={label}>
      <Link
        to={to}
        aria-label={label}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary"
        onClick={(e) => e.stopPropagation()}
      >
        <Settings size={12} strokeWidth={2} aria-hidden />
      </Link>
    </Tip>
  )
}

const SECTION_GEAR: Partial<
  Record<SidebarSection, { to: string; labelKey: string; defaultLabel: string }>
> = {
  folders: {
    to: '/settings/channels#folders',
    labelKey: 'support.folders.settingsAria',
    defaultLabel: 'Manage folders',
  },
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
  teams: {
    to: '/team',
    labelKey: 'support.teams.settingsAria',
    defaultLabel: 'Manage teams',
  },
}

/** Section header with persisted collapse state from sidebar prefs. */
function CollapsibleSection({ section, title, count, headerAction, children }: CollapsibleSectionProps) {
  const { prefs, setSectionCollapsed } = useSidebarPrefs()
  const collapsed = prefs.collapsed.includes(section)
  const open = !collapsed
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
    <Tip label={label}>
      <Link
        to={to}
        aria-label={label}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-heading"
      >
        <Plus size={13} />
      </Link>
    </Tip>
  )
}

type ChannelFolder = {
  leaf: HubLeaf
  label: string
  icon: ReactNode
  title?: string
}

/** Connected channel folders under Channels (email mailboxes + enabled accounts). */
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
    const hasSlack = !isChannelParked('slack') && enabledAccounts.some((a) => a.channel === 'slack')
    const hasWhatsApp = enabledAccounts.some((a) => a.channel === 'whatsapp')

    const next: ChannelFolder[] = [
      ...connections.map((conn) => ({
        leaf: { type: 'channel' as const, channelKey: 'email' as const, connectionId: String(conn.id) },
        label: mailboxDisplayLabel(conn.displayName, conn.mailboxEmail),
        icon: <ChannelGlyph channel="email" size={14} />,
      })),
      ...(hasWidget
        ? [
            {
              leaf: { type: 'channel' as const, channelKey: 'webchat' as const },
              label: t('support.channels.webchat'),
              icon: <ChannelGlyph channel="widget" size={14} />,
            },
          ]
        : []),
      ...(hasWhatsApp
        ? [
            {
              leaf: { type: 'channel' as const, channelKey: 'whatsapp' as const },
              label: t('support.channels.whatsapp'),
              icon: <ChannelGlyph channel="whatsapp" size={14} />,
            },
          ]
        : []),
      ...(hasSlack
        ? [
            {
              leaf: { type: 'channel' as const, channelKey: 'slack' as const },
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

function ChannelsSection({
  folders,
  loading,
  activeLeaf,
  defaultQueueFor,
  t,
}: {
  folders: ChannelFolder[]
  loading: boolean
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}) {
  return (
    <div className="space-y-0.5">
      {loading ? <NavSectionSkeleton rows={3} /> : null}
      {!loading && folders.length === 0 ? (
        <Tip label={t('support.channels.connectChannel')} side="right">
          <Link to="/settings/channels" className="nav-row border border-dashed border-border/80 text-xs">
            <Plus aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.channels.connectChannel')}</span>
          </Link>
        </Tip>
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
            folder.leaf.type === 'channel' &&
            folder.leaf.channelKey === 'email' &&
            folder.leaf.connectionId ? (
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

function AgentFolderRow({
  agent,
  activeLeaf,
  defaultQueueFor,
  t,
}: {
  agent: ChatTarget
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}) {
  const live = useAgentLive(agent.id)
  const activity = live?.status ?? asAgentStatus(agent.status)
  const workHref =
    activity === 'working' ? openEntityPath({ type: 'agent', id: agent.id, live }) : null
  const baseLeaf: HubLeaf = { type: 'agent', agentId: agent.id }
  const activityActive =
    activeLeaf?.type === 'agent' && activeLeaf.agentId === agent.id && activeLeaf.queue === 'activity'
  return (
    <SidebarFolder
      baseLeaf={baseLeaf}
      label={agent.name}
      icon={
        <AiAvatar
          {...toAiAvatarProps(agent)}
          size={14}
          decorative
          activity={activity}
        />
      }
      activeLeaf={activeLeaf}
      defaultQueue={defaultQueueFor(baseLeaf)}
      headerAction={
        <ComposePlusLink
          to={newConversationPath({ intent: 'agent', agentId: agent.id })}
          label={t('support.composeToAgent')}
        />
      }
      extra={
        <>
          {workHref ? (
            <Tip label={t('support.agents.currentWork')} side="right">
              <NavLink to={workHref} className="nav-row nav-sub-row h-[26px] text-xs">
                <Activity size={12} className="shrink-0 text-ai-ink" aria-hidden />
                <span className="min-w-0 flex-1 truncate-fade">
                  {live?.summary || t('support.agents.currentWork')}
                </span>
              </NavLink>
            </Tip>
          ) : null}
          <Tip label={t('support.agents.activity')} side="right">
            <NavLink
              to={activityTerminalPath(agent.id)}
              data-active={activityActive ? 'true' : undefined}
              className="nav-row nav-sub-row h-[26px] text-xs"
            >
              <Activity size={12} className="shrink-0 text-text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate-fade">{t('support.agents.activity')}</span>
            </NavLink>
          </Tip>
        </>
      }
    />
  )
}

function TeamGroupChatRow({ teamId, t }: { teamId: string; t: TFn }) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  return (
    <Tip label={t('support.teams.groupChatHint')} side="right">
      <button
        type="button"
        disabled={busy || !token}
        className="nav-row nav-sub-row h-[26px] text-xs font-medium text-accent"
        onClick={async (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!token || busy) return
          setBusy(true)
          try {
            const room = await openTeamRoom(token, teamId)
            navigate(teamPath(teamId, 'open', room.id))
          } finally {
            setBusy(false)
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate-fade text-left">{t('support.teams.groupChat')}</span>
      </button>
    </Tip>
  )
}

function AgentsSection({
  agents,
  loading,
  activeLeaf,
  defaultQueueFor,
  t,
}: {
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
  t: TFn
}) {
  useEffect(() => {
    if (agents.length === 0) return
    seedAgentPresence(
      agents.map((agent) => ({
        id: agent.id,
        status: agent.status,
        current_activity_summary: agent.current_activity_summary,
        current_thread_id: agent.current_thread_id,
        last_active_at: agent.last_active_at,
      })),
    )
  }, [agents])

  return (
    <div className="space-y-0.5">
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
              {t('support.settings.setupGuide')}
            </Link>
          </div>
        </div>
      ) : null}
      {agents.map((agent) => (
        <AgentFolderRow
          key={agent.id}
          agent={agent}
          activeLeaf={activeLeaf}
          defaultQueueFor={defaultQueueFor}
          t={t}
        />
      ))}
    </div>
  )
}

function FoldersSection({
  folders,
  loading,
  t,
}: {
  folders: InboxFolder[]
  loading: boolean
  t: TFn
}) {
  const location = useLocation()
  const onInbox = location.pathname.startsWith(inboxPath())
  const activeFilter = folderFilterFromParams(new URLSearchParams(location.search))
  return (
    <div className="space-y-0.5">
      {loading ? <NavSectionSkeleton rows={2} /> : null}
      {!loading && folders.length === 0 ? (
        <Link to="/settings/channels#folders" className="nav-row border border-dashed border-border/80 text-xs">
          <Plus aria-hidden />
          <span className="min-w-0 flex-1 truncate-fade">{t('support.folders.empty')}</span>
        </Link>
      ) : null}
      {folders.map((folder) => {
        const active = onInbox && sameFolderFilter(activeFilter, folder.filter)
        const Icon = folder.kind === 'project' ? FolderKanban : Folder
        return (
          <Link
            key={folder.id}
            to={`${inboxPath('open')}${folderFilterQuery(folder.filter)}`}
            data-active={active ? 'true' : undefined}
            aria-current={active ? 'page' : undefined}
            className="nav-row"
            title={folder.name}
          >
            <Icon size={14} className="shrink-0 text-text-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{folder.name}</span>
            <NavCountBadge count={folder.count} placement="inline" />
          </Link>
        )
      })}
    </div>
  )
}

function usePinnedTeams(): { teams: Team[]; loading: boolean } {
  const { teams, loading } = useTeams()
  return { teams: teams.filter((team) => team.pinned && !team.system), loading }
}

/**
 * Communication hub inner rail.
 *
 * Fixed top: New chat + All communication.
 * Middle: Folders, Channels, Agents, Teams (user order) — each folder has For you /
 * Open / Unassigned / Closed.
 * Bottom: Contacts + Settings.
 */
export default function MessagesHubNav() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { counts } = useNavBadges()
  const { visibleSections, settingsVisible } = useSidebarPrefs()
  const { defaultQueueFor } = useInboxFolderPrefs()
  const location = useLocation()
  const activeLeaf = leafFromPath(location.pathname)
  const { teams, loading: teamsLoading } = usePinnedTeams()
  const { folders: channelFolders, loading: channelsLoading } = useConnectedChannelFolders(t)
  const { folders: inboxFolders, loaded: inboxFoldersLoaded } = useInboxFolders(
    visibleSections.includes('folders'),
  )

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

  const companyAgents = targets.filter((target) => target.kind === 'company')
  const inboxBaseLeaf: HubLeaf = { type: 'inbox' }
  const inboxQueueCounts = {
    for_you: counts.inboxByQueue.forYou,
    unassigned: counts.inboxByQueue.unassigned,
  }

  const sectionCounts: Partial<Record<SidebarSection, number | null>> = {
    folders: inboxFolders.length > 0 ? inboxFolders.length : null,
    channels: channelsLoading ? null : channelFolders.length > 0 ? channelFolders.length : null,
    agents: targetsLoading ? null : companyAgents.length > 0 ? companyAgents.length : null,
    teams: teamsLoading ? null : teams.length > 0 ? teams.length : null,
  }

  const sectionContent: Record<Exclude<SidebarSection, 'settings'>, ReactNode> = {
    folders: <FoldersSection folders={inboxFolders} loading={!inboxFoldersLoaded} t={t} />,
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
        defaultQueueFor={defaultQueueFor}
        t={t}
      />
    ),
    teams: (
      <>
        {teamsLoading ? <NavSectionSkeleton rows={2} /> : null}
        {!teamsLoading && teams.length === 0 ? (
          <Link to="/team" className="nav-row border border-dashed border-border/80 text-xs">
            <Plus aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.teams.pinHint')}</span>
          </Link>
        ) : null}
        {teams.map((team) => {
          const leaf: HubLeaf = { type: 'team', teamId: team.id }
          return (
            <SidebarFolder
              key={team.id}
              baseLeaf={leaf}
              label={team.name}
              title={team.description || team.name}
              icon={
                <TeamAvatar
                  {...toTeamAvatarProps(team)}
                  size={14}
                  decorative
                  presence={team.presence?.status}
                />
              }
              activeLeaf={activeLeaf}
              defaultQueue={defaultQueueFor(leaf)}
              badgeCount={countForTeam(counts, team.id)}
              leading={<TeamGroupChatRow teamId={team.id} t={t} />}
            />
          )
        })}
      </>
    ),
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollFade className="space-y-3 pb-1">
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
            defaultQueue={defaultQueueFor(inboxBaseLeaf)}
            badgeCount={counts.inboxByQueue.forYou}
            queueCounts={inboxQueueCounts}
            extra={
              <>
                {EXTRA_INBOX_ITEMS.map((item) => {
                  const leaf: HubLeaf = { type: 'inbox', queue: item.queue }
                  return (
                    <Tip key={item.queue} label={t(`${item.labelKey}Hint`)} side="right">
                      <NavLink
                        to={inboxPath(item.queue)}
                        data-active={isLeafActive(activeLeaf, leaf) ? 'true' : undefined}
                        className="nav-row nav-sub-row h-[26px] text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate-fade">{t(item.labelKey)}</span>
                        <NavCountBadge count={countForInboxQueue(counts, item.queue)} placement="inline" />
                      </NavLink>
                    </Tip>
                  )
                })}
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
      </ScrollFade>

      <div className="mt-1 shrink-0 space-y-px border-t border-border/60 pt-1.5">
        <Tip label={t('support.contacts.hint')} side="right">
          <NavLink to="/contacts" className="nav-row">
            <Users aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.contacts.label')}</span>
          </NavLink>
        </Tip>
        {settingsVisible ? (
          <Tip label={t('support.settings.channels')} side="right">
            <NavLink to="/settings/channels" className="nav-row">
              <Settings aria-hidden />
              <span className="min-w-0 flex-1 truncate-fade">{t('support.settings.channels')}</span>
            </NavLink>
          </Tip>
        ) : null}
      </div>
    </div>
  )
}
