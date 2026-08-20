import { Mail, Pin, SquarePen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InboxListQuickFilter } from '../../context/InboxCommunicationContext'
import { cn } from '../../lib/utils'

type Props = {
  value: InboxListQuickFilter
  onChange: (value: InboxListQuickFilter) => void
  counts: {
    all: number
    unread: number
    pinned: number
  }
  /** When set, shows a compose button (new outbound email). */
  onCompose?: () => void
}

const FILTERS: Array<{
  id: InboxListQuickFilter
  labelKey: string
  defaultLabel: string
  icon?: typeof Mail
}> = [
  { id: 'all', labelKey: 'listFilters.all', defaultLabel: 'All' },
  { id: 'unread', labelKey: 'listFilters.unread', defaultLabel: 'Unread', icon: Mail },
  { id: 'pinned', labelKey: 'listFilters.pinned', defaultLabel: 'Pinned', icon: Pin },
]

export default function ThreadListQuickFilters({ value, onChange, counts, onCompose }: Props) {
  const { t } = useTranslation('communication')

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pt-2.5 pb-2 border-b border-border/60">
      {FILTERS.map((filter) => {
        const Icon = filter.icon
        const count = counts[filter.id]
        const active = value === filter.id
        const disabled = filter.id !== 'all' && count === 0

        return (
          <button
            key={filter.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(filter.id)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
              active
                ? 'border-accent/35 bg-accent/12 text-accent'
                : 'border-border/60 bg-bg-surface-hover/40 text-text-secondary hover:border-border hover:bg-bg-hover/60 hover:text-text-primary',
              disabled && 'opacity-40 pointer-events-none',
            )}
          >
            {Icon ? <Icon size={11} className={active ? 'text-accent' : 'text-text-muted'} /> : null}
            <span>{t(filter.labelKey, { defaultValue: filter.defaultLabel })}</span>
            {count > 0 && filter.id !== 'all' ? (
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-accent/90' : 'text-text-muted',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
      {onCompose ? (
        <button
          type="button"
          onClick={onCompose}
          aria-label={t('compose.title', { defaultValue: 'New email' })}
          title={t('compose.title', { defaultValue: 'New email' })}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <SquarePen size={13} />
        </button>
      ) : null}
    </div>
  )
}
