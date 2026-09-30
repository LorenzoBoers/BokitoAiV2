import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import type { Channel, Conversation, ConversationStatus, Queue } from '@/api/types'
import { ChannelIcon } from '@/components/ChannelIcon'
import { Badge, Empty, Loading } from '@/components/ui'
import { cn } from '@/lib/cn'
import { relativeTime, truncate } from '@/lib/format'

export const QUEUES: Queue[] = ['attention', 'mine', 'agents', 'waiting', 'all']
const CHANNELS: Array<Channel | ''> = ['', 'email', 'whatsapp', 'widget', 'phone', 'internal']
const STATUSES: Array<ConversationStatus | ''> = ['', 'open', 'waiting', 'snoozed', 'closed']

export type ListFilters = { queue: Queue; channel: Channel | ''; status: ConversationStatus | ''; q: string }

export function ConversationList({
  items,
  counts,
  loading,
  filters,
  onFilters,
  selectedId,
}: {
  items: Conversation[]
  counts: Record<string, number>
  loading: boolean
  filters: ListFilters
  onFilters: (f: ListFilters) => void
  selectedId?: string
}) {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5">
        {QUEUES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onFilters({ ...filters, queue: q })}
            className={cn(
              'flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover',
              filters.queue === q && 'bg-bg-hover text-text-heading',
            )}
          >
            {t(`communication.queue.${q}`)}
            {counts[q] ? <span className="chip">{counts[q]}</span> : null}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            className="field h-8 pl-7 text-xs"
            placeholder={t('communication.search')}
            value={filters.q}
            onChange={(e) => onFilters({ ...filters, q: e.target.value })}
          />
        </div>
        <select
          className="field h-8 w-auto text-xs"
          value={filters.channel}
          onChange={(e) => onFilters({ ...filters, channel: e.target.value as Channel | '' })}
          aria-label={t('communication.channel')}
        >
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c ? t(`channels.${c}`) : t('communication.allChannels')}
            </option>
          ))}
        </select>
        <select
          className="field h-8 w-auto text-xs"
          value={filters.status}
          onChange={(e) => onFilters({ ...filters, status: e.target.value as ConversationStatus | '' })}
          aria-label={t('communication.status')}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? t(`status.${s}`) : t('communication.anyStatus')}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !items.length ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty title={t('communication.emptyQueue')} hint={t('communication.emptyQueueHint')} />
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.id}>
                <NavLink
                  to={`/communication/${c.id}`}
                  className={cn(
                    'flex gap-3 border-b border-border/40 px-3 py-2.5 hover:bg-bg-hover',
                    selectedId === c.id && 'bg-bg-hover',
                  )}
                >
                  <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg-elevated text-text-secondary">
                    <ChannelIcon channel={c.channel} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('truncate text-sm', c.unread ? 'font-semibold text-text-heading' : 'text-text-primary')}>
                        {c.subject || t('communication.noSubject')}
                      </span>
                      <span className="ml-auto shrink-0 text-2xs text-text-muted">{relativeTime(c.last_activity_at, i18n.language)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                      <span className="truncate">
                        {c.participants[0]?.name || t(`channels.${c.channel}`)}
                        {c.compact_summary ? ` · ${truncate(c.compact_summary, 70)}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {c.unread && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="unread" />}
                      {c.status !== 'open' && <Badge>{t(`status.${c.status}`)}</Badge>}
                      {c.handoff && <Badge tone="warning">{t('communication.handoff')}</Badge>}
                      {c.agent_id && !c.assignee_user_id && <Badge tone="ai">{t('communication.agent')}</Badge>}
                      {c.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
