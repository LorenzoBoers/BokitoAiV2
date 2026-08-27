import { List, Mail, MessageSquareReply, Pin, Rows3, Settings, SquarePen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import type { InboxDensity } from '../../lib/inbox-prefs'
import { cn } from '../../lib/utils'

type Props = {
  value: InboxListQuickFilter
  onChange: (value: InboxListQuickFilter) => void
  counts: {
    all: number
    unread: number
    needsReply: number
    pinned: number
  }
  /** When set, shows a compose button (new outbound email). */
  onCompose?: () => void
  countsArePartial?: boolean
  density?: InboxDensity
  onToggleDensity?: () => void
  onSelectAll?: () => void
  onMarkAllRead?: () => void
  unreadCount?: number
}

const FILTERS: Array<{
  id: InboxListQuickFilter
  labelKey: string
  defaultLabel: string
  icon?: typeof Mail
  emptyKey?: string
}> = [
  { id: 'all', labelKey: 'listFilters.all', defaultLabel: 'All' },
  { id: 'needsReply', labelKey: 'listFilters.needsReply', defaultLabel: 'Needs reply', icon: MessageSquareReply, emptyKey: 'threadList.emptyNeedsReply' },
  { id: 'unread', labelKey: 'listFilters.unread', defaultLabel: 'Unread', icon: Mail, emptyKey: 'threadList.emptyUnread' },
  { id: 'pinned', labelKey: 'listFilters.pinned', defaultLabel: 'Pinned', icon: Pin, emptyKey: 'threadList.emptyPinned' },
]

export default function ThreadListQuickFilters({
  value,
  onChange,
  counts,
  onCompose,
  countsArePartial = false,
  density = 'comfortable',
  onToggleDensity,
  onSelectAll,
  onMarkAllRead,
  unreadCount = 0,
}: Props) {
  const { t } = useTranslation('communication')

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pt-2.5 pb-2 border-b border-border/60">
      {FILTERS.map((filter) => {
        const Icon = filter.icon
        const count = counts[filter.id]
        const active = value === filter.id

        return (
          <button
            key={filter.id}
            type="button"
            onClick={() => onChange(filter.id)}
            title={
              countsArePartial && filter.id !== 'all' && count > 0
                ? t('threadList.countsPartial')
                : filter.id !== 'all' && count === 0 && filter.emptyKey
                  ? t(filter.emptyKey)
                  : undefined
            }
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
              active
                ? 'border-accent/35 bg-accent/12 text-accent'
                : 'border-border/60 bg-bg-surface-hover/40 text-text-secondary hover:border-border hover:bg-bg-hover/60 hover:text-text-primary',
            )}
          >
            {Icon ? <Icon size={11} className={active ? 'text-accent' : 'text-text-muted'} /> : null}
            <span>{t(filter.labelKey)}</span>
            {count > 0 && filter.id !== 'all' ? (
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-accent/90' : 'text-text-muted',
                )}
              >
                {countsArePartial ? `${count}+` : count}
              </span>
            ) : null}
          </button>
        )
      })}
      <div className="ml-auto flex items-center gap-1">
        {onSelectAll ? (
          <button
            type="button"
            onClick={onSelectAll}
            title={t('bulkActions.selectAll')}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            {t('bulkActions.selectAll')}
          </button>
        ) : null}
        {onMarkAllRead && unreadCount > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            title={t('threadList.markAllRead')}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            {t('threadList.markAllRead')}
          </button>
        ) : null}
        {onToggleDensity ? (
          <button
            type="button"
            onClick={onToggleDensity}
            aria-label={density === 'compact' ? t('threadList.densityComfortable') : t('threadList.densityCompact')}
            title={density === 'compact' ? t('threadList.densityComfortable') : t('threadList.densityCompact')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            {density === 'compact' ? <Rows3 size={13} /> : <List size={13} />}
          </button>
        ) : null}
        {onCompose ? (
          <button
            type="button"
            onClick={onCompose}
            aria-label={t('compose.title')}
            title={t('compose.title')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <SquarePen size={13} />
          </button>
        ) : null}
        <Link
          to="/settings/channels"
          aria-label={t('threadList.channelSettings')}
          title={t('threadList.channelSettings')}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <Settings size={13} />
        </Link>
      </div>
    </div>
  )
}
