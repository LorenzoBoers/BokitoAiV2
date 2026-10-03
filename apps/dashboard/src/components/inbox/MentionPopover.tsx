import { Bot, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { UserAvatar } from '../ui/UserAvatar'
import { cn } from '../../lib/utils'
import type { MentionItem } from '../../lib/mentions'

type Props = {
  items: MentionItem[]
  activeIndex: number
  onSelect: (item: MentionItem) => void
  onHover: (index: number) => void
}

/**
 * Mention suggestion list shown above a composer while typing `@...`.
 * Renders teammates, agents and teams; items without access are greyed out with the reason.
 */
export default function MentionPopover({ items, activeIndex, onSelect, onHover }: Props) {
  const { t } = useTranslation('communication')
  if (items.length === 0) return null
  return (
    <div className="absolute bottom-full left-0 z-30 mb-1.5 w-72 overflow-hidden rounded-lg border border-border/60 bg-bg-surface shadow-overlay">
      <div className="px-3 pb-1 pt-2 text-2xs font-semibold text-text-muted">{t('mentions.title')}</div>
      <ul className="max-h-56 overflow-y-auto pb-1.5">
        {items.map((item, index) => (
          <li key={`${item.type}-${item.id}`}>
            <button
              type="button"
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              // Mousedown so the textarea keeps focus (blur would close the menu).
              onMouseDown={(e) => {
                e.preventDefault()
                if (!item.disabled) onSelect(item)
              }}
              onMouseEnter={() => onHover(index)}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
                index === activeIndex && !item.disabled && 'bg-bg-hover',
                item.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {item.type === 'agent' ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Bot size={13} />
                </span>
              ) : item.type === 'team' ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-hover text-text-secondary">
                  <Users size={13} />
                </span>
              ) : (
                <UserAvatar
                  name={item.name}
                  email={item.email ?? ''}
                  avatarUrl={item.avatarUrl ?? null}
                  size={24}
                  presence={item.presence}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate-fade text-sm font-medium text-text-primary">{item.name}</span>
                {item.disabled && item.disabledReason ? (
                  <span className="block truncate-fade text-xs text-text-muted">{item.disabledReason}</span>
                ) : item.email ? (
                  <span className="block truncate-fade text-xs text-text-muted">{item.email}</span>
                ) : null}
              </span>
              {item.type !== 'user' ? (
                <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent">
                  {item.type === 'agent' ? t('mentions.agent') : t('mentions.team')}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
