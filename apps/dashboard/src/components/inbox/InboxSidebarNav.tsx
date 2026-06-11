import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Bot, ChevronDown, ChevronRight, Inbox, Mail, Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { countForInboxQueue } from '../../lib/nav-badge-counts'
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

const PRIMARY_QUEUES = [
  {
    labelKey: 'support.links.awaitingDecision',
    queue: 'awaiting-decision',
    defaultLabel: 'Awaiting decision',
    icon: 'inbox' as const,
    emphasis: true,
  },
  { labelKey: 'support.links.allMessages', queue: 'all', defaultLabel: 'Open', icon: 'inbox' as const },
  { labelKey: 'support.links.myInbox', queue: 'my', defaultLabel: 'Assigned to me', icon: 'user' as const },
  { labelKey: 'support.links.unassigned', queue: 'unassigned', defaultLabel: 'Unassigned', icon: 'inbox' as const },
  { labelKey: 'support.links.updates', queue: 'updates', defaultLabel: 'Updates', icon: 'bot' as const },
  { labelKey: 'support.links.results', queue: 'results', defaultLabel: 'Results', icon: 'bot' as const },
  { labelKey: 'support.links.pinned', queue: 'pinned', defaultLabel: 'Pinned', icon: 'pin' as const },
] as const

const MORE_QUEUES = [
  { labelKey: 'support.links.pending', queue: 'pending', defaultLabel: 'Pending', icon: 'inbox' as const },
  { labelKey: 'support.links.closed', queue: 'closed', defaultLabel: 'Closed', icon: 'inbox' as const },
] as const

const CHANNEL_VIEWS = [
  { labelKey: 'support.channelViews.open', queue: 'all', defaultLabel: 'Open' },
  { labelKey: 'support.channelViews.mine', queue: 'my', defaultLabel: 'Mine' },
  { labelKey: 'support.channelViews.unassigned', queue: 'unassigned', defaultLabel: 'Unassigned' },
  { labelKey: 'support.channelViews.outbound', queue: 'out', defaultLabel: 'Outbound' },
  { labelKey: 'support.channelViews.closed', queue: 'closed', defaultLabel: 'Closed' },
] as const

const STORAGE_KEY = 'inbox_channel_expanded'
const MORE_STORAGE_KEY = 'inbox_customer_more_expanded'

function loadExpandedState(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function saveExpandedState(key: string, state: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // ignore
  }
}

/** Preserve non-folder query params (e.g. project_id) when navigating queues. */
function buildInboxQuery(searchParams?: URLSearchParams): string {
  const params = new URLSearchParams()
  const projectId = searchParams?.get('project_id')
  if (projectId) params.set('project_id', projectId)
  const query = params.toString()
  return query ? `?${query}` : ''
}

type QueueLinkProps = {
  queue: string
  label: string
  badgeCount?: number
  icon?: 'inbox' | 'pin' | 'user' | 'bot'
  emphasis?: boolean
}

function QueueLink({ queue, label, badgeCount = 0, icon = 'inbox', emphasis = false }: QueueLinkProps) {
  const { user } = useAuth()
  const location = useLocation()
  const { queue: paramQueue, channelId } = useParams<{ queue?: string; channelId?: string }>()
  const [searchParams] = useSearchParams()
  const to = `/messages/${queue}${buildInboxQuery(searchParams)}`
  const activeQueue = paramQueue ?? 'all'
  const isActive =
    !channelId &&
    activeQueue === queue &&
    (location.pathname.startsWith('/messages/') || location.pathname.startsWith('/support/inbox/')) &&
    !location.pathname.includes('/ch/')

  return (
    <NavLink to={to} className={() => navLinkClass(isActive)}>
      {icon === 'user' ? (
        <UserAvatar
          name={user?.name ?? '?'}
          email={user?.email ?? ''}
          avatarUrl={user?.avatarUrl}
          size={14}
        />
      ) : icon === 'pin' ? (
        <Pin size={14} className="text-text-muted" />
      ) : icon === 'bot' ? (
        <Bot size={14} className="text-text-muted" />
      ) : (
        <Inbox size={14} className={cn('text-text-muted', emphasis && isActive && 'text-accent')} />
      )}
      <span className={cn('min-w-0 flex-1 truncate', emphasis && 'font-semibold')}>{label}</span>
      <NavCountBadge count={badgeCount} placement="inline" />
    </NavLink>
  )
}

type ChannelSectionProps = {
  connectionId: number
  label: string
  email: string
  currentChannelId?: string
  searchParams: URLSearchParams
  t: (key: string, opts?: { defaultValue?: string }) => string
}

function ChannelSection({
  connectionId,
  label,
  email,
  currentChannelId,
  searchParams,
  t,
}: ChannelSectionProps) {
  const idStr = String(connectionId)
  const isCurrentChannel = currentChannelId === idStr

  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = loadExpandedState(STORAGE_KEY)
    return stored[idStr] ?? isCurrentChannel
  })

  useEffect(() => {
    if (isCurrentChannel && !expanded) {
      setExpanded(true)
    }
  }, [isCurrentChannel, expanded])

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    const stored = loadExpandedState(STORAGE_KEY)
    stored[idStr] = next
    saveExpandedState(STORAGE_KEY, stored)
  }

  const channelQuery = buildInboxQuery(searchParams)

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary transition-all"
      >
        <Mail size={14} className="text-text-muted shrink-0" />
        <span className="flex-1 truncate text-left">{label || email}</span>
        {expanded ? (
          <ChevronDown size={13} className="text-text-muted shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-text-muted shrink-0" />
        )}
      </button>
      {expanded ? (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border/40 pl-2.5">
          {CHANNEL_VIEWS.map((v) => (
            <NavLink
              key={v.queue}
              to={`/messages/ch/${connectionId}/${v.queue}${channelQuery}`}
              className={({ isActive }) => navLinkClass(isActive)}
            >
              <span>{t(v.labelKey, { defaultValue: v.defaultLabel })}</span>
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function InboxSidebarNav() {
  const { t } = useTranslation('nav')
  const { counts } = useNavBadges()
  const { channelId } = useParams<{ channelId?: string }>()
  const [searchParams] = useSearchParams()
  const { connections, loading } = useMailboxConnections()

  const [moreExpanded, setMoreExpanded] = useState<boolean>(() => {
    const stored = loadExpandedState(MORE_STORAGE_KEY)
    return stored.more ?? false
  })

  const enabledConnections = useMemo(
    () => connections.filter((c) => c.status !== 'revoked' && c.isEnabled !== false),
    [connections],
  )

  const toggleMore = () => {
    const next = !moreExpanded
    setMoreExpanded(next)
    saveExpandedState(MORE_STORAGE_KEY, { more: next })
  }

  return (
    <div className="space-y-4">
      <section className="space-y-0.5">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {t('support.group.inbox', { defaultValue: 'Queues' })}
        </p>
        {PRIMARY_QUEUES.map((v) => (
          <QueueLink
            key={`queue-${v.queue}`}
            queue={v.queue}
            label={t(v.labelKey, { defaultValue: v.defaultLabel })}
            badgeCount={countForInboxQueue(counts, v.queue)}
            icon={v.icon}
            emphasis={'emphasis' in v && v.emphasis}
          />
        ))}
        <button
          type="button"
          onClick={toggleMore}
          className="flex w-full items-center gap-2 px-3 py-1 text-[11px] font-medium text-text-muted hover:text-text-secondary"
        >
          {moreExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('support.moreQueues', { defaultValue: 'More' })}
        </button>
        {moreExpanded
          ? MORE_QUEUES.map((v) => (
              <QueueLink
                key={`queue-more-${v.queue}`}
                queue={v.queue}
                label={t(v.labelKey, { defaultValue: v.defaultLabel })}
                badgeCount={countForInboxQueue(counts, v.queue)}
                icon={v.icon}
              />
            ))
          : null}
      </section>

      {!loading && enabledConnections.length > 0 ? (
        <section className="space-y-1">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('support.mailboxes', { defaultValue: 'Channels' })}
          </p>
          <div className="space-y-0.5">
            {enabledConnections.map((conn) => (
              <ChannelSection
                key={conn.id}
                connectionId={conn.id}
                label={conn.displayName}
                email={conn.mailboxEmail}
                currentChannelId={channelId}
                searchParams={searchParams}
                t={t}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
