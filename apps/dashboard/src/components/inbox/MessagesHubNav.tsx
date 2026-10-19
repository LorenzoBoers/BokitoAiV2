import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { EmptyState } from '../ui/empty-state'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Activity, Clock, Inbox, Mail, Plus, Settings } from 'lucide-react'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { GRID_ICON } from '../../lib/navigation'
import { useTranslation } from 'react-i18next'
import { AiAvatar } from '../ui/AiAvatar'
import { TeamFacepile } from '../ui/TeamFacepile'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { asAgentStatus } from '../../lib/presence'
import { useAgentLive, seedAgentPresence } from '../../hooks/useAgentPresence'
import { NavSectionSkeleton } from '../ui/skeleton'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useSidebarEditor } from '../../context/SidebarEditorContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { listChannelAccounts, type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { isChannelParked } from '../../lib/channel-surface'
import { bokitoListChatTargets, type ChatTarget, type NavRow } from '../../lib/signals-api'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { NavFlashProvider } from '../../hooks/useNavReveal'
import { CommunicationFlowsTree, FolderTagTree } from './FolderTagTree'
import { mailboxDisplayLabel } from '../../lib/mailbox-label'
import { BRAND_ASSET_PATHS } from '../../lib/brand-assets'
import type { EmailConnection } from '../../lib/email-api'
import { countForTeam, pairForInboxQueue } from '../../lib/nav-badge-counts'
import {
  INBOX_SIDEBAR_QUEUES,
  agentItemId,
  applyOrder,
  applyTreeOrder,
  buildCommunicationCatalog,
  catalogStructureKey,
  channelItemId,
  flowItemId,
  folderItemId,
  queueItemId,
  teamItemId,
  type CatalogNode,
  type InboxSidebarQueue,
} from '../../lib/sidebar-catalog'
import { tagPinRef } from '../../lib/communication-sidebar-prefs'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  TEAM_SUB_QUEUES,
  inboxPath,
  leafFromPath,
  leafKey,
  newConversationPath,
  type HubLeaf,
  type SubQueue,
} from '../../lib/messages-paths'
import { openEntityPath } from '../../lib/open-entity'
import type { Team } from '../../lib/teams-api'
import { useTeams } from '../../hooks/useTeams'
import { SidebarFolder } from './QueueSublist'
import { RailEyeButton, RailPenButton } from './RailEditButtons'
import { useHideSidebarRow } from '../../hooks/useHideSidebarRow'
import { NavQueueCounts } from '../layout/NavCountBadge'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { HashtagMark } from '../ui/HashtagMark'
import { TagPill } from '../ui/TagPill'
import ScrollFade from '../ui/ScrollFade'
import { Tip } from '../ui/Tip'
import { SectionLabel } from '../ui/section-label'
import { cn } from '../../lib/utils'

const Users = ENTITY_ICONS.team
const FolderIcon = ENTITY_ICONS.project

function paintCatalog(
  nodes: CatalogNode[],
  icons: Map<string, ReactNode>,
  marks: Map<string, ReactNode>,
): CatalogNode[] {
  return nodes.map((node) => ({
    ...node,
    icon: icons.get(node.id),
    mark: marks.get(node.id),
    children: paintCatalog(node.children, icons, marks),
  }))
}

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  folders: { labelKey: 'support.section.folders', defaultLabel: 'Folders' },
  flows: { labelKey: 'support.section.flows', defaultLabel: 'Flows' },
  channels: { labelKey: 'support.section.channels', defaultLabel: 'Channels' },
  agents: { labelKey: 'support.section.agents', defaultLabel: 'Chat with agents' },
  teams: { labelKey: 'support.section.teams', defaultLabel: 'Departments' },
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
    to: '/folders',
    labelKey: 'support.folders.settingsAria',
    defaultLabel: 'Manage folders',
  },
  flows: {
    to: '/workstreams',
    labelKey: 'support.flows.settingsAria',
    defaultLabel: 'Manage flows',
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

/** Section header with persisted collapse state; whole header drags to reorder. */
function CollapsibleSection({ section, title, count, headerAction, children }: CollapsibleSectionProps) {
  const { t } = useTranslation('nav')
  const { prefs, setSectionCollapsed } = useSidebarPrefs()
  const collapsed = prefs.collapsed.includes(section)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'relative z-10 opacity-60')}
    >
      <SectionLabel
        data-section={section}
        title={title}
        count={count}
        open={!collapsed}
        onOpenChange={(next) => setSectionCollapsed(section, !next)}
        actions={headerAction}
        hoverActions
        contentClassName="space-y-px"
        titleButtonProps={{
          ...attributes,
          ...listeners,
          className: 'cursor-grab active:cursor-grabbing',
          'aria-roledescription': t('support.customize.reorderAria', {
            defaultValue: 'Reorder {{label}}',
            label: title,
          }),
        }}
      >
        {children}
      </SectionLabel>
    </div>
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

const MAILBOX_LOGO: Partial<Record<EmailConnection['provider'], string>> = {
  outlook: BRAND_ASSET_PATHS.outlook.logoUrl,
  gmail: BRAND_ASSET_PATHS.google.logoUrl,
  bokito: BRAND_ASSET_PATHS.bokito.logoUrl,
}

function MailboxMark({ provider, size = 14 }: { provider: EmailConnection['provider']; size?: number }) {
  // SMTP/IMAP and Bokito address: same Lucide envelope; IMAP muted, Bokito accent.
  if (provider === 'smtp_imap') {
    return <Mail size={size} className="shrink-0 text-text-muted" aria-hidden />
  }
  if (provider === 'bokito') {
    return <Mail size={size} className="shrink-0 text-accent" aria-hidden />
  }
  const src = MAILBOX_LOGO[provider]
  if (!src) {
    return <Mail size={size} className="shrink-0 text-text-muted" aria-hidden />
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
    />
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
        icon: <MailboxMark provider={conn.provider} size={14} />,
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
  t,
}: {
  folders: ChannelFolder[]
  loading: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}) {
  const { hideItem } = useHideSidebarRow()
  return (
    <div className="space-y-px">
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
          defaultQueue="open"
          queues={[]}
          headerAction={
            <>
              <RailEyeButton
                label={t('support.customize.hide')}
                onClick={() =>
                  hideItem(
                    channelItemId(
                      folder.leaf.type === 'channel' ? folder.leaf.channelKey : '',
                      folder.leaf.type === 'channel' ? folder.leaf.connectionId : undefined,
                    ),
                    folder.label,
                  )
                }
              />
              {folder.leaf.type === 'channel' &&
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
              ) : null}
            </>
          }
        />
      ))}
    </div>
  )
}

function AgentFolderRow({
  agent,
  activeLeaf,
  t,
}: {
  agent: ChatTarget
  activeLeaf: HubLeaf | null
  t: TFn
}) {
  const { hideItem } = useHideSidebarRow()
  const live = useAgentLive(agent.id)
  const activity = live?.status ?? asAgentStatus(agent.status)
  const workHref =
    activity === 'working' ? openEntityPath({ type: 'agent', id: agent.id, live }) : null
  const baseLeaf: HubLeaf = { type: 'agent', agentId: agent.id }
  return (
    <SidebarFolder
      baseLeaf={baseLeaf}
      label={agent.name}
      icon={
        <AiAvatar
          {...toAiAvatarProps(agent)}
          size={14}
          decorative
          mode="static"
          activity={activity}
        />
      }
      activeLeaf={activeLeaf}
      defaultQueue="open"
      queues={[]}
      headerAction={
        <>
          <RailEyeButton
            label={t('support.customize.hide')}
            onClick={() => hideItem(agentItemId(agent.id), agent.name)}
          />
          <ComposePlusLink
            to={newConversationPath({ intent: 'agent', agentId: agent.id })}
            label={t('support.composeToAgent')}
          />
        </>
      }
      extra={
        <>
          {workHref ? (
            <Tip label={t('support.agents.currentWork')} side="right">
              <NavLink to={workHref} className="nav-row nav-sub-row h-[26px] text-xs">
                <Activity size={12} className="shrink-0 text-ai-ink" aria-hidden />
                <span className="min-w-0 flex-1 truncate-fade">{t('support.agents.workingNow')}</span>
              </NavLink>
            </Tip>
          ) : null}
        </>
      }
    />
  )
}

function AgentsSection({
  agents,
  loading,
  activeLeaf,
  t,
}: {
  agents: ChatTarget[]
  loading: boolean
  activeLeaf: HubLeaf | null
  t: TFn
}) {
  // The rail re-renders whenever live presence changes. Seeding from a fresh
  // array each time put a stale "working" row back on top of the standby the
  // open thread had just written, and the two updates looped until React
  // stopped the page (maximum update depth on an agent chat).
  const presenceSeed = agents
    .map((agent) =>
      [
        agent.id,
        agent.status ?? '',
        agent.current_activity_summary ?? '',
        agent.current_thread_id ?? '',
        String(agent.last_active_at ?? ''),
      ].join('\u001f'),
    )
    .join('\u001e')
  useEffect(() => {
    if (!presenceSeed) return
    seedAgentPresence(
      agents.map((agent) => ({
        id: agent.id,
        status: agent.status,
        current_activity_summary: agent.current_activity_summary,
        current_thread_id: agent.current_thread_id,
        last_active_at: agent.last_active_at,
      })),
    )
    // presenceSeed is the content of `agents`; the array itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceSeed])

  return (
    <div className="space-y-px">
      {loading ? <NavSectionSkeleton rows={2} /> : null}
      {!loading && agents.length === 0 ? (
        <EmptyState
          tone="plain"
          size="sm"
          className="px-2 py-1"
          title={t('support.agents.empty')}
          footer={
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
          }
        />
      ) : null}
      {agents.map((agent) => (
        <AgentFolderRow
          key={agent.id}
          agent={agent}
          activeLeaf={activeLeaf}
          t={t}
        />
      ))}
    </div>
  )
}

const INBOX_QUEUE_LABEL: Record<InboxSidebarQueue, string> = {
  for_you: 'support.inbox.forYou',
  open: 'support.inbox.open',
  unassigned: 'support.inbox.unassigned',
  scheduled: 'support.inbox.scheduled',
  spam: 'support.inbox.spam',
}

function InboxQueueRows({
  queues,
  activeLeaf,
  counts,
}: {
  queues: readonly InboxSidebarQueue[]
  activeLeaf: HubLeaf | null
  counts: ReturnType<typeof useNavBadges>['counts']
}) {
  const { t } = useTranslation('nav')
  const { hideItem } = useHideSidebarRow()
  return (
    <>
      {queues.map((queue) => {
        const leaf: HubLeaf = { type: 'inbox', queue }
        const label = t(INBOX_QUEUE_LABEL[queue])
        const pair = pairForInboxQueue(counts, queue)
        return (
          <NavLink
            key={queue}
            to={inboxPath(queue)}
            data-active={isLeafActive(activeLeaf, leaf) ? 'true' : undefined}
            className="nav-row nav-sub-row group/row h-[26px] text-xs"
          >
            {queue === 'scheduled' ? <Clock size={12} className="shrink-0 text-text-muted" aria-hidden /> : null}
            <span className="min-w-0 flex-1 truncate-fade">{label}</span>
            <span className="hidden group-hover/row:inline-flex">
              <RailEyeButton label={t('support.customize.hide')} onClick={() => hideItem(queueItemId(queue), label)} />
            </span>
            <NavQueueCounts
              unread={pair.unread}
              total={pair.total}
              unreadLabel={t('badges.queue.unread')}
              totalLabel={t('badges.queue.total')}
            />
          </NavLink>
        )
      })}
    </>
  )
}

function NavRowFolders({
  rows,
  leafFor,
  icon,
  activeLeaf,
  defaultQueueFor,
}: {
  rows: NavRow[]
  leafFor: (row: NavRow) => HubLeaf
  icon: (row: NavRow) => ReactNode
  activeLeaf: HubLeaf | null
  defaultQueueFor: (leaf: HubLeaf) => SubQueue
}) {
  return (
    <>
      {rows.map((row) => {
        const leaf = leafFor(row)
        return (
          <SidebarFolder
            key={leafKey(leaf)}
            baseLeaf={leaf}
            label={row.name}
            icon={icon(row)}
            activeLeaf={activeLeaf}
            defaultQueue={defaultQueueFor(leaf)}
            badgeCount={row.count}
          />
        )
      })}
    </>
  )
}


function useSidebarTeams(): { teams: Team[]; loading: boolean } {
  const { teams, loading } = useTeams()
  return { teams: teams.filter((team) => !team.system), loading }
}

/**
 * Communication hub inner rail.
 *
 * Fixed top: New chat + All communication.
 * Middle: Folders and tags, Channels, Agents, Teams (user order) —
 * each row has For you / Open / Unassigned / Closed.
 * Bottom: Contacts + Settings.
 */
export default function MessagesHubNav() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const { counts } = useNavBadges()
  const { prefs, visibleSections, settingsVisible, setOrder } = useSidebarPrefs()
  const { setCatalog, openEditor } = useSidebarEditor()
  const { hideItem, hideSection } = useHideSidebarRow()
  const layout = useMemo(
    () => ({ itemOrder: prefs.itemOrder, hiddenItems: prefs.hiddenItems }),
    [prefs.itemOrder, prefs.hiddenItems],
  )
  const { defaultQueueFor } = useInboxFolderPrefs()
  const location = useLocation()
  const activeLeaf = leafFromPath(location.pathname)
  const { teams, loading: teamsLoading } = useSidebarTeams()
  const { folders: channelFolders, loading: channelsLoading } = useConnectedChannelFolders(t)
  const { nav, loaded: navLoaded } = useCommunicationNav()
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const onSectionDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id) as SidebarSection
      const overId = event.over ? (String(event.over.id) as SidebarSection) : null
      if (!overId || activeId === overId) return
      const middle: SidebarSection[] = prefs.order.filter((section) => section !== 'settings')
      const oldIndex = middle.indexOf(activeId)
      const newIndex = middle.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      setOrder([...arrayMove(middle, oldIndex, newIndex), 'settings'])
    },
    [prefs.order, setOrder],
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

  const companyAgents = useMemo(
    () => targets.filter((target) => target.kind === 'company'),
    [targets],
  )
  const inboxBaseLeaf: HubLeaf = { type: 'inbox' }
  const orderedQueues = useMemo(
    () => applyOrder([...INBOX_SIDEBAR_QUEUES], 'inbox', queueItemId, layout),
    [layout],
  )
  const orderedFolders = useMemo(
    () => applyTreeOrder(nav.projects, 'folders', (row) => folderItemId(row.id), layout),
    [layout, nav.projects],
  )
  const orderedFlows = useMemo(
    () => applyOrder(nav.ticketTags, 'flows', (row) => flowItemId(row.id), layout),
    [layout, nav.ticketTags],
  )
  const orderedChannels = useMemo(
    () =>
      applyOrder(channelFolders, 'channels', (folder) =>
        channelItemId(
          folder.leaf.type === 'channel' ? folder.leaf.channelKey : '',
          folder.leaf.type === 'channel' ? folder.leaf.connectionId : undefined,
        ),
        layout,
      ),
    [channelFolders, layout],
  )
  const orderedAgents = useMemo(
    () => applyOrder(companyAgents, 'agents', (agent) => agentItemId(agent.id), layout),
    [companyAgents, layout],
  )
  const orderedTeams = useMemo(
    () => applyOrder(teams, 'teams', (team) => teamItemId(team.id), layout),
    [layout, teams],
  )

  const catalog = useMemo(() => {
    const built = buildCommunicationCatalog({
        labels: {
          inbox: t('support.inbox.allCommunication'),
          folders: t(SECTION_LABELS.folders.labelKey),
          flows: t(SECTION_LABELS.flows.labelKey),
          channels: t(SECTION_LABELS.channels.labelKey),
          agents: t(SECTION_LABELS.agents.labelKey),
          teams: t(SECTION_LABELS.teams.labelKey),
          contacts: t('support.contacts.label'),
          settings: t(SECTION_LABELS.settings.labelKey),
          queues: {
            for_you: t('support.inbox.forYou'),
            open: t('support.inbox.open'),
            unassigned: t('support.inbox.unassigned'),
            scheduled: t('support.inbox.scheduled'),
            spam: t('support.inbox.spam'),
          },
        },
        sectionOrder: prefs.order.filter((section) => section !== 'settings'),
        hiddenSections: prefs.hidden,
        folders: nav.projects,
        tags: nav.tags
          .filter((row) => prefs.railPins.some((pin) => pin.ref === tagPinRef(row.name)))
          .map((row) => ({ id: `tag:${row.id}`, label: row.name.replace(/^#/, '') })),
        flows: nav.ticketTags.map((row) => ({ id: flowItemId(row.id), label: row.name.replace(/^#/, '') })),
        channels: channelFolders.map((folder) => ({
          id: channelItemId(
            folder.leaf.type === 'channel' ? folder.leaf.channelKey : '',
            folder.leaf.type === 'channel' ? folder.leaf.connectionId : undefined,
          ),
          label: folder.label,
        })),
        agents: companyAgents.map((agent) => ({ id: agentItemId(agent.id), label: agent.name })),
        teams: teams.map((team) => ({ id: teamItemId(team.id), label: team.name })),
        prefs: layout,
      })
    const icons = new Map<string, ReactNode>()
    const marks = new Map<string, ReactNode>()
    icons.set('inbox', <Inbox size={14} className="shrink-0 text-text-muted" />)
    icons.set('contacts', <Users size={14} className="shrink-0 text-text-muted" />)
    icons.set('settings', <Settings size={14} className="shrink-0 text-text-muted" />)
    icons.set(queueItemId('scheduled'), <Clock size={12} className="shrink-0 text-text-muted" />)
    const walkFolders = (rows: typeof nav.projects) => {
      for (const row of rows) {
        icons.set(folderItemId(row.id), <FolderIcon size={12} className="shrink-0 text-text-muted" />)
        if (row.children?.length) walkFolders(row.children)
      }
    }
    walkFolders(nav.projects)
    for (const row of nav.tags) {
      if (!prefs.railPins.some((pin) => pin.ref === tagPinRef(row.name))) continue
      icons.set(`tag:${row.id}`, <HashtagMark />)
    }
    for (const row of nav.ticketTags) {
      marks.set(flowItemId(row.id), <TagPill names={row.name.replace(/^#/, '')} tone="action" size="sm" />)
    }
    for (const folder of channelFolders) {
      icons.set(
        channelItemId(
          folder.leaf.type === 'channel' ? folder.leaf.channelKey : '',
          folder.leaf.type === 'channel' ? folder.leaf.connectionId : undefined,
        ),
        folder.icon,
      )
    }
    for (const agent of companyAgents) {
      icons.set(
        agentItemId(agent.id),
        <AiAvatar {...toAiAvatarProps(agent)} size={14} decorative mode="static" />,
      )
    }
    for (const team of teams) {
      icons.set(
        teamItemId(team.id),
        <TeamFacepile team={team} size={14} linkAgents={false} presence={team.presence?.status} />,
      )
    }
    return paintCatalog(built, icons, marks)
  }, [channelFolders, companyAgents, layout, nav.projects, nav.tags, nav.ticketTags, prefs.hidden, prefs.order, prefs.railPins, t, teams])

  const publishedCatalog = useRef('')
  useEffect(() => {
    const next = catalogStructureKey(catalog)
    if (publishedCatalog.current === next) return
    publishedCatalog.current = next
    setCatalog(catalog)
  }, [catalog, setCatalog])

  const sectionCounts: Partial<Record<SidebarSection, number | null>> = {
    folders: nav.projects.length > 0 ? nav.projects.length : null,
    flows: nav.ticketTags.length > 0 ? nav.ticketTags.length : null,
    channels: channelsLoading ? null : channelFolders.length > 0 ? channelFolders.length : null,
    agents: targetsLoading ? null : companyAgents.length > 0 ? companyAgents.length : null,
    teams: teamsLoading ? null : teams.length > 0 ? teams.length : null,
  }

  const sectionContent: Record<Exclude<SidebarSection, 'settings'>, ReactNode> = {
    folders: (
      <FolderTagTree
        folders={orderedFolders}
        tags={nav.tags}
        ticketTags={[]}
        loading={!navLoaded}
        activeLeaf={activeLeaf}
        defaultQueueFor={defaultQueueFor}
        t={t}
      />
    ),
    flows: (
      <CommunicationFlowsTree
        ticketTags={orderedFlows}
        loading={!navLoaded}
        activeLeaf={activeLeaf}
        t={t}
      />
    ),
    channels: (
      <ChannelsSection
        folders={orderedChannels}
        loading={channelsLoading}
        activeLeaf={activeLeaf}
        t={t}
      />
    ),
    agents: (
      <AgentsSection
        agents={orderedAgents}
        loading={targetsLoading}
        activeLeaf={activeLeaf}
        t={t}
      />
    ),
    teams: (
      <>
        {teamsLoading ? <NavSectionSkeleton rows={2} /> : null}
        {!teamsLoading && teams.length === 0 ? (
          <Link to="/team" className="nav-row border border-dashed border-border/80 text-xs">
            <Plus aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.teams.createHint')}</span>
          </Link>
        ) : null}
        {orderedTeams.map((team) => {
          const leaf: HubLeaf = { type: 'team', teamId: team.id }
          return (
            <SidebarFolder
              key={team.id}
              baseLeaf={leaf}
              label={team.name}
              title={team.description || team.name}
              icon={
                <TeamFacepile team={team} size={14} linkAgents={false} presence={team.presence?.status} />
              }
              activeLeaf={activeLeaf}
              defaultQueue="open"
              headerQueue={null}
              queues={TEAM_SUB_QUEUES}
              badgeCount={countForTeam(counts, team.id)}
              headerAction={
                <RailEyeButton
                  label={t('support.customize.hide')}
                  onClick={() => hideItem(teamItemId(team.id), team.name)}
                />
              }
            />
          )
        })}
      </>
    ),
  }

  return (
    <NavFlashProvider activeLeaf={activeLeaf}>
    <div className="flex h-full min-h-0 flex-col">
      <ScrollFade className="space-y-3 pb-1">
        <section className="space-y-px">
          <SidebarFolder
            baseLeaf={inboxBaseLeaf}
            label={t('support.inbox.allCommunication')}
            title={t('support.inbox.allCommunicationHint')}
            icon={<Inbox size={14} className="shrink-0 text-text-muted" />}
            activeLeaf={activeLeaf}
            defaultQueue={defaultQueueFor(inboxBaseLeaf)}
            queues={[]}
            badgePair={pairForInboxQueue(counts, 'open')}
            headerAction={
              <RailPenButton
                label={t('support.customize.editSection')}
                onClick={() => openEditor('inbox')}
              />
            }
            leading={
              orderedQueues.length > 0 ? (
                <InboxQueueRows queues={orderedQueues} activeLeaf={activeLeaf} counts={counts} />
              ) : null
            }
          />
        </section>

        <DndContext
          sensors={sectionSensors}
          collisionDetection={closestCenter}
          onDragEnd={onSectionDragEnd}
        >
          <SortableContext items={visibleSections} strategy={verticalListSortingStrategy}>
            {visibleSections.map((section) => {
              const gear = SECTION_GEAR[section]
              return (
                <CollapsibleSection
                  key={section}
                  section={section}
                  title={t(SECTION_LABELS[section].labelKey)}
                  count={sectionCounts[section]}
                  headerAction={
                    <span className="inline-flex items-center">
                      <RailPenButton
                        label={t('support.customize.editSection')}
                        onClick={() => openEditor(section)}
                      />
                      <RailEyeButton
                        label={t('support.customize.hide')}
                        onClick={() => hideSection(section, t(SECTION_LABELS[section].labelKey))}
                      />
                      {section === 'teams' ? (
                        <Tip label={t('orgCanvas.link')}>
                          <Link
                            to="/grid"
                            aria-label={t('orgCanvas.link')}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <GRID_ICON size={12} strokeWidth={2} aria-hidden />
                          </Link>
                        </Tip>
                      ) : null}
                      {gear ? (
                        <SectionGearLink
                          to={gear.to}
                          label={t(gear.labelKey, { defaultValue: gear.defaultLabel })}
                        />
                      ) : null}
                    </span>
                  }
                >
                  {sectionContent[section as Exclude<SidebarSection, 'settings'>]}
                </CollapsibleSection>
              )
            })}
          </SortableContext>
        </DndContext>
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
            <NavLink to="/settings/channels" className="nav-row group/row">
              <Settings aria-hidden />
              <span className="min-w-0 flex-1 truncate-fade">{t('support.settings.channels')}</span>
              <span className="hidden group-hover/row:inline-flex">
                <RailPenButton
                  label={t('support.customize.editSection')}
                  onClick={() => openEditor('settings')}
                />
                <RailEyeButton
                  label={t('support.customize.hide')}
                  onClick={() => hideSection('settings', t(SECTION_LABELS.settings.labelKey))}
                />
              </span>
            </NavLink>
          </Tip>
        ) : null}
      </div>
    </div>
    </NavFlashProvider>
  )
}
