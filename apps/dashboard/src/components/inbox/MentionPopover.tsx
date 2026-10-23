import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { TeamFacepile } from '../ui/TeamFacepile'
import { preferLiveAgentAvatar } from '../../lib/agent-avatar'
import { useAgents } from '../../hooks/useAgents'
import { useTeams } from '../../hooks/useTeams'
import { cn } from '../../lib/utils'
import type { MentionItem } from '../../lib/mentions'

export type MentionPickerSection = {
  title: string
  items: MentionItem[]
}

type RowProps = {
  item: MentionItem
  active?: boolean
  selected?: boolean
  onSelect: (item: MentionItem) => void
  onHover?: () => void
}

/** One row in the @-mention / focus picker list (avatar, name, email, type badge). */
export function MentionCandidateRow({ item, active, selected, onSelect, onHover }: RowProps) {
  const { t } = useTranslation('communication')
  const { teams } = useTeams()
  const { agents } = useAgents()
  return (
    <button
      type="button"
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      // Mousedown so the textarea / trigger keeps focus (blur would close menus).
      onMouseDown={(e) => {
        e.preventDefault()
        if (!item.disabled) onSelect(item)
      }}
      onMouseEnter={onHover}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors',
        active && !item.disabled && 'bg-bg-hover',
        item.disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {selected != null ? (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
          {selected ? <Check size={14} className="text-text-primary" /> : null}
        </span>
      ) : null}
      {item.type === 'agent' ? (
        <Avatar
          kind="agent"
          agent={preferLiveAgentAvatar(
            agents.find((row) => row.id === item.id),
            item,
          )}
          fallbackName={item.name}
          size={24}
          decorative
          mode="static"
          activity={item.activity ?? 'standby'}
        />
      ) : item.type === 'team' ? (
        <TeamFacepile
          team={
            teams.find((row) => row.id === item.id) ?? {
              id: item.id,
              name: item.name,
              avatar_kind: item.avatarKind,
              avatar_icon: item.avatarIcon,
              avatar_color: item.avatarColor,
              avatar_image_url: item.avatarImageUrl,
            }
          }
          size={24}
          linkAgents={false}
          presence={item.presence}
        />
      ) : (
        <Avatar
          kind="person"
          decorative={false}
          name={item.name}
          email={item.email ?? ''}
          imageUrl={item.avatarUrl ?? null}
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
  )
}

type PanelProps = {
  sections: MentionPickerSection[]
  /** Flat index across all section items (composer @ keyboard nav). */
  activeIndex?: number
  /** Keys `type:id` for multi-select focus picker. */
  selectedKeys?: Set<string>
  onSelect: (item: MentionItem) => void
  onHover?: (flatIndex: number) => void
  title?: string
  className?: string
  listClassName?: string
}

/** Shared list chrome for @-mentions and the Ask focus chevron picker. */
export function MentionsPickerPanel({
  sections,
  activeIndex,
  selectedKeys,
  onSelect,
  onHover,
  title,
  className,
  listClassName,
}: PanelProps) {
  const nonempty = sections.filter((section) => section.items.length > 0)
  if (nonempty.length === 0) return null
  let flat = 0
  return (
    <div
      className={cn(
        'w-72 overflow-hidden rounded-lg border border-border bg-bg-surface shadow-overlay',
        className,
      )}
    >
      {title ? (
        <div className="px-3 pb-1 pt-2 text-2xs font-semibold text-text-muted">{title}</div>
      ) : null}
      <div className={cn('max-h-56 overflow-y-auto pb-1.5', listClassName)}>
        {nonempty.map((section, sectionIndex) => (
          <div key={section.title || `section-${sectionIndex}`}>
            {sectionIndex > 0 ? <div className="mx-2 my-1 border-t border-border" /> : null}
            {section.title ? (
              <div className="px-3 pb-0.5 pt-1.5 text-2xs font-semibold text-text-muted">
                {section.title}
              </div>
            ) : null}
            <ul>
              {section.items.map((item) => {
                const index = flat
                flat += 1
                const key = `${item.type}:${item.id}`
                return (
                  <li key={key}>
                    <MentionCandidateRow
                      item={item}
                      active={activeIndex === index}
                      selected={selectedKeys ? selectedKeys.has(key) : undefined}
                      onSelect={onSelect}
                      onHover={onHover ? () => onHover(index) : undefined}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

type Props = {
  items: MentionItem[]
  activeIndex: number
  onSelect: (item: MentionItem) => void
  onHover: (index: number) => void
}

/**
 * Mention suggestion list shown above a composer while typing `@...`.
 * Renders teammates, agents and teams; items without access are greyed out with the reason.
 * Agent faces always go through AgentMark + the live agents catalog so orb shape/color stay correct.
 */
export default function MentionPopover({ items, activeIndex, onSelect, onHover }: Props) {
  const { t } = useTranslation('communication')
  if (items.length === 0) return null
  // Preserve the filtered order from the composer (mixed types in one flat list).
  return (
    <div className="absolute bottom-full left-0 z-30 mb-1.5">
      <MentionsPickerPanel
        title={t('mentions.title')}
        sections={[{ title: '', items }]}
        activeIndex={activeIndex}
        onSelect={onSelect}
        onHover={onHover}
        listClassName="pt-0"
      />
    </div>
  )
}
