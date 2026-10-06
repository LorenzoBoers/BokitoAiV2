import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Filter, List, Mail, Pin, Rows3, Search, Settings, X } from 'lucide-react'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import { useOptionalInboxCommunication } from '../../context/InboxCommunicationContext'
import type { InboxDensity } from '../../lib/inbox-prefs'
import { cn } from '../../lib/utils'
import { channelKind } from '../ui/ChannelGlyph'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

function mailboxSyncLabel(
  lastSyncAt: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const minutes = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60_000)
  if (minutes < 1) return t('threadList.lastSyncNow')
  if (minutes < 60) return t('threadList.lastSyncMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('threadList.lastSyncHours', { count: hours })
  return t('threadList.lastSyncDays', { count: Math.floor(hours / 24) })
}

type MemberOption = { id: number; name: string; email: string }

type Props = {
  value: InboxListQuickFilter
  onChange: (value: InboxListQuickFilter) => void
  counts: {
    all: number
    unread: number
    pinned: number
  }
  countsArePartial?: boolean
  density?: InboxDensity
  onToggleDensity?: () => void
  onSelectAll?: () => void
  onMarkAllRead?: () => void
  unreadCount?: number
  lastMailboxSyncAt?: string | null
  assigneeFilter?: number | null
  onAssigneeFilter?: (id: number | null) => void
  members?: MemberOption[]
  priorityFilter?: string | null
  onPriorityFilter?: (value: string | null) => void
}

const FILTERS: Array<{
  id: InboxListQuickFilter
  labelKey: string
  icon?: typeof Mail
}> = [
  { id: 'all', labelKey: 'listFilters.all' },
  { id: 'unread', labelKey: 'listFilters.unread', icon: Mail },
  { id: 'pinned', labelKey: 'listFilters.pinned', icon: Pin },
]

/**
 * Compact list toolbar: search + one Filters menu (quick filters and dropdowns),
 * with density as an icon action. New conversations start from the inner rail.
 */
export default function ThreadListQuickFilters({
  value,
  onChange,
  counts,
  countsArePartial = false,
  density = 'compact',
  onToggleDensity,
  onSelectAll,
  onMarkAllRead,
  unreadCount = 0,
  lastMailboxSyncAt,
  assigneeFilter = null,
  onAssigneeFilter,
  members = [],
  priorityFilter = null,
  onPriorityFilter,
}: Props) {
  const { t } = useTranslation('communication')
  const inbox = useOptionalInboxCommunication()
  const search = inbox?.search ?? ''
  const setSearch = inbox?.setSearch

  const syncHint =
    lastMailboxSyncAt === undefined
      ? null
      : lastMailboxSyncAt
        ? mailboxSyncLabel(lastMailboxSyncAt, t)
        : t('threadList.lastSyncNever')

  const hasAdvancedFilters = Boolean(onAssigneeFilter || onPriorityFilter)
  const advancedActive = assigneeFilter != null || Boolean(priorityFilter)
  const quickActive = value !== 'all'
  const filtersActive = quickActive || advancedActive
  const activeFilterCount =
    (quickActive ? 1 : 0) + (assigneeFilter != null ? 1 : 0) + (priorityFilter ? 1 : 0)

  const activeSummary = useMemo(() => {
    const parts: string[] = []
    if (quickActive) {
      const row = FILTERS.find((f) => f.id === value)
      if (row) parts.push(t(row.labelKey))
    }
    if (assigneeFilter != null) {
      const member = members.find((m) => m.id === assigneeFilter)
      parts.push(member?.name || member?.email || t('threadList.filterAssignee'))
    }
    if (priorityFilter) {
      parts.push(t(`priority.${priorityFilter}`, { defaultValue: priorityFilter }))
    }
    return parts
  }, [quickActive, value, assigneeFilter, members, priorityFilter, t])

  const clearAllFilters = () => {
    onChange('all')
    onAssigneeFilter?.(null)
    onPriorityFilter?.(null)
  }

  return (
    <div className="border-b border-border/60">
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <input
            type="search"
            id="inbox-search"
            value={search}
            onChange={(e) => setSearch?.(e.target.value)}
            disabled={!setSearch}
            placeholder={t('threadList.searchPlaceholder')}
            aria-label={t('threadList.searchPlaceholder')}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (search) setSearch?.('')
              event.currentTarget.blur()
            }}
            className={cn(
              'h-8 w-full rounded-md border border-border/70 bg-bg-surface pl-8 pr-8 text-sm text-text-primary',
              'placeholder:text-text-muted/80',
              'outline-none transition-colors focus:border-accent/45 focus:bg-bg-surface focus:ring-2 focus:ring-accent/15',
              !setSearch && 'opacity-60',
            )}
          />
          {search && setSearch ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={t('inboxSearchClear')}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('threadList.filters')}
              title={t('threadList.filters')}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors',
                filtersActive
                  ? 'border-border-light bg-bg-hover text-text-heading'
                  : 'border-border/70 text-text-secondary hover:bg-bg-hover/70 hover:text-text-heading',
              )}
            >
              <Filter size={13} />
              <span className="hidden min-[280px]:inline">{t('threadList.filters')}</span>
              {filtersActive ? (
                <span className="tabular-nums text-2xs opacity-90">{activeFilterCount}</span>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-2rem))] p-1.5">
            <DropdownMenuLabel>{t('threadList.quickFilters')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(next) => onChange(next as InboxListQuickFilter)}
            >
              {FILTERS.map((filter) => {
                const Icon = filter.icon
                const count = counts[filter.id]
                return (
                  <DropdownMenuRadioItem
                    key={filter.id}
                    value={filter.id}
                    className="gap-2"
                    aria-label={t(filter.labelKey)}
                  >
                    {Icon ? <Icon size={13} className="text-text-muted" /> : null}
                    <span className="flex-1">{t(filter.labelKey)}</span>
                    {count > 0 && filter.id !== 'all' ? (
                      <span className="tabular-nums text-xs text-text-muted">
                        {countsArePartial ? `${count}+` : count}
                      </span>
                    ) : null}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>

            {hasAdvancedFilters ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('threadList.narrowBy')}</DropdownMenuLabel>
                <div
                  className="space-y-2 px-1.5 pb-1.5"
                  onPointerDown={(event) => event.preventDefault()}
                >
                  {onAssigneeFilter ? (
                    <label className="block text-xs text-text-muted">
                      {t('threadList.filterAssignee')}
                      <Select
                        value={assigneeFilter == null ? 'all' : String(assigneeFilter)}
                        onValueChange={(next) =>
                          onAssigneeFilter(next === 'all' ? null : Number(next))
                        }
                      >
                        <SelectTrigger className="mt-1 h-7 w-full text-xs" aria-label={t('threadList.filterAssignee')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('threadList.filterAssigneeAll')}</SelectItem>
                          {members.map((member) => (
                            <SelectItem key={member.id} value={String(member.id)}>
                              {member.name || member.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : null}
                  {onPriorityFilter ? (
                    <label className="block text-xs text-text-muted">
                      {t('threadList.filterPriority')}
                      <Select
                        value={priorityFilter ?? 'all'}
                        onValueChange={(next) => onPriorityFilter(next === 'all' ? null : next)}
                      >
                        <SelectTrigger className="mt-1 h-7 w-full text-xs" aria-label={t('threadList.filterPriority')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('threadList.filterPriorityAll')}</SelectItem>
                          <SelectItem value="urgent">{t('priority.urgent')}</SelectItem>
                          <SelectItem value="high">{t('priority.high')}</SelectItem>
                          <SelectItem value="normal">{t('priority.normal')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  ) : null}
                </div>
              </>
            ) : null}

            <DropdownMenuSeparator />
            <div className="flex flex-wrap gap-1 px-1 pb-1">
              {onSelectAll ? (
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                >
                  {t('bulkActions.selectAll')}
                </button>
              ) : null}
              {onMarkAllRead && unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                >
                  {t('threadList.markAllRead')}
                </button>
              ) : null}
              {filtersActive ? (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-heading"
                >
                  {t('threadList.clearFilters')}
                </button>
              ) : null}
            </div>
            {syncHint ? (
              <Link
                to="/settings/channels"
                className="mx-1 mb-1 flex items-center gap-1.5 truncate-fade rounded-md px-2 py-1.5 text-2xs text-text-muted hover:bg-bg-hover hover:text-text-primary"
              >
                <Settings size={11} className="shrink-0" />
                <span className="truncate-fade">{syncHint}</span>
              </Link>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        {onToggleDensity ? (
          <button
            type="button"
            onClick={onToggleDensity}
            aria-label={
              density === 'compact' ? t('threadList.densityComfortable') : t('threadList.densityCompact')
            }
            title={
              density === 'compact' ? t('threadList.densityComfortable') : t('threadList.densityCompact')
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            {density === 'compact' ? <Rows3 size={13} /> : <List size={13} />}
          </button>
        ) : null}
      </div>

      {filtersActive ? (
        <div className="flex items-center gap-1.5 border-t border-border/40 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate-fade text-xs text-text-secondary">
            {activeSummary.join(' · ')}
          </span>
          <button
            type="button"
            onClick={clearAllFilters}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-heading"
          >
            <X size={11} />
            {t('threadList.clearFilters')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
