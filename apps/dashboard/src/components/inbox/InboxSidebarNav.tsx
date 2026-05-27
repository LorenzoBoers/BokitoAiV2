import { useState, useEffect } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Inbox, Mail, Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { countForInboxQueue } from '../../lib/nav-badge-counts'
import NavCountBadge from '../layout/NavCountBadge'
import { UserAvatar } from '../ui/UserAvatar'

function navLinkClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary'
  }`
}

const GLOBAL_VIEWS = [
  { labelKey: 'support.links.allMessages', queue: 'all', defaultLabel: 'Open' },
  { labelKey: 'support.links.myInbox', queue: 'my', defaultLabel: 'Toegewezen aan mij' },
  { labelKey: 'support.links.pinned', queue: 'pinned', defaultLabel: 'Gepind' },
  { labelKey: 'support.links.unassigned', queue: 'unassigned', defaultLabel: 'Niet toegewezen' },
  { labelKey: 'support.links.pending', queue: 'pending', defaultLabel: 'In behandeling' },
  { labelKey: 'support.links.closed', queue: 'closed', defaultLabel: 'Gesloten' },
] as const

const CHANNEL_VIEWS = [
  { label: 'Open', queue: 'all' },
  { label: 'Mijn', queue: 'my' },
  { label: 'Niet toegewezen', queue: 'unassigned' },
  { label: 'Uitgaand', queue: 'out' },
  { label: 'Gesloten', queue: 'closed' },
]

const STORAGE_KEY = 'inbox_channel_expanded'

function loadExpandedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function saveExpandedState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

type ChannelSectionProps = {
  connectionId: number
  label: string
  email: string
  currentChannelId?: string
}

function ChannelSection({ connectionId, label, email, currentChannelId }: ChannelSectionProps) {
  const idStr = String(connectionId)
  const isCurrentChannel = currentChannelId === idStr

  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = loadExpandedState()
    return stored[idStr] ?? isCurrentChannel
  })

  useEffect(() => {
    if (isCurrentChannel && !expanded) {
      setExpanded(true)
    }
  }, [isCurrentChannel])

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    const stored = loadExpandedState()
    stored[idStr] = next
    saveExpandedState(stored)
  }

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
      {expanded && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border/40 pl-2.5">
          {CHANNEL_VIEWS.map((v) => (
            <NavLink
              key={v.queue}
              to={`/support/inbox/ch/${connectionId}/${v.queue}`}
              className={({ isActive }) => navLinkClass(isActive)}
            >
              <span>{v.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function InboxSidebarNav() {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const { counts } = useNavBadges()
  const { channelId } = useParams<{ channelId?: string }>()
  const { connections, loading } = useMailboxConnections()

  const enabledConnections = connections.filter(
    (c) => c.status !== 'revoked' && c.isEnabled !== false,
  )

  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Alle kanalen
        </p>
        <div className="space-y-0.5">
          {GLOBAL_VIEWS.map((v) => {
            const badgeCount = countForInboxQueue(counts, v.queue)
            const label = t(v.labelKey, { defaultValue: v.defaultLabel })
            return (
              <NavLink
                key={v.queue}
                to={`/support/inbox/${v.queue}`}
                className={({ isActive }) => navLinkClass(isActive)}
              >
                {v.queue === 'my' ? (
                  <UserAvatar
                    name={user?.name ?? '?'}
                    email={user?.email ?? ''}
                    avatarUrl={user?.avatarUrl}
                    size={14}
                  />
                ) : v.queue === 'pinned' ? (
                  <Pin size={14} className="text-text-muted" />
                ) : (
                  <Inbox size={14} className="text-text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <NavCountBadge count={badgeCount} placement="inline" />
              </NavLink>
            )
          })}
        </div>
      </section>

      {!loading && enabledConnections.length > 0 && (
        <section className="space-y-1">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Mailboxen
          </p>
          <div className="space-y-0.5">
            {enabledConnections.map((conn) => (
              <ChannelSection
                key={conn.id}
                connectionId={conn.id}
                label={conn.displayName}
                email={conn.mailboxEmail}
                currentChannelId={channelId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
