import { useTranslation } from 'react-i18next'
import { AiAvatar } from '../ui/AiAvatar'
import { Badge } from '../ui/badge'
import { TeamAvatar } from '../ui/TeamAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
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
                <AiAvatar
                  {...toAiAvatarProps({
                    id: item.id,
                    name: item.name,
                    avatar_kind: item.avatarKind,
                    avatar_icon: item.avatarIcon,
                    avatar_image_url: item.avatarImageUrl,
                  })}
                  size={24}
                  decorative
                  activity={item.activity ?? 'standby'}
                />
              ) : item.type === 'team' ? (
                <TeamAvatar
                  {...toTeamAvatarProps({
                    id: item.id,
                    name: item.name,
                    avatar_kind: item.avatarKind,
                    avatar_icon: item.avatarIcon,
                    avatar_color: item.avatarColor,
                    avatar_image_url: item.avatarImageUrl,
                  })}
                  size={24}
                  decorative
                  presence={item.presence}
                />
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
                <Badge variant="accent" size="sm" className="font-semibold">
                  {item.type === 'agent' ? t('mentions.agent') : t('mentions.team')}
                </Badge>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
