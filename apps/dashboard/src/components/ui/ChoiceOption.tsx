import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Avatar } from './avatar'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import type { TeamMemberRef } from '../../lib/teams-api'
import { BrandMark } from '../integrations/BrandMark'
import { HashtagMark } from './HashtagMark'
import { FLOW_LABEL_COLOR, FLOW_LABEL_ICON, labelMarkIcon, labelMarkInk } from './label-marks'
import { TeamFacepile } from './TeamFacepile'
import { cn } from '../../lib/utils'
import type { AgentVisualFields } from './AgentOptionRow'

export type ChoiceKind = 'agent' | 'person' | 'team' | 'flow' | 'project' | 'calendar' | 'tag' | 'icon'

export type ChoicePerson = {
  name: string
  email?: string | null
  avatarUrl?: string | null
}

export type ChoiceTeam = {
  id?: string
  name?: string | null
  members?: TeamMemberRef[]
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
}

/** One recognizable row in a select or menu: mark, then name. */
export type ChoiceItem = {
  value: string
  label: string
  kind: ChoiceKind
  agent?: AgentVisualFields
  person?: ChoicePerson
  team?: ChoiceTeam
  /** Integration slug for a calendar, channel, or connection mark. */
  brandSlug?: string
  /** Accent `#` for an action tag; muted `#` for a free tag. */
  category?: boolean
  icon?: LucideIcon
  trailing?: ReactNode
  disabled?: boolean
}

function IconMark({ icon: Icon, size }: { icon: LucideIcon; size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-bg-elevated text-text-muted"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon size={Math.max(10, Math.round(size * 0.62))} />
    </span>
  )
}

export function ChoiceMark({ item, size = 18 }: { item: ChoiceItem; size?: number }) {
  if (item.kind === 'agent') {
    const agent = item.agent ?? { id: item.value, name: item.label }
    return (
      <Avatar kind="agent" agent={agent} fallbackName={item.label} size={size} decorative mode="static" />
    )
  }
  if (item.kind === 'person') {
    const person = item.person ?? { name: item.label }
    return (
      <Avatar
        kind="person"
        name={person.name || item.label}
        email={person.email || person.name || item.label}
        imageUrl={person.avatarUrl}
        size={size}
        decorative
      />
    )
  }
  if (item.kind === 'team') {
    const team = item.team ?? { name: item.label }
    return <TeamFacepile team={{ ...team, name: team.name ?? item.label }} size={size} linkAgents={false} />
  }
  if (item.kind === 'tag') {
    if (item.category) {
      const Mark = labelMarkIcon(FLOW_LABEL_ICON)
      const ink = labelMarkInk(FLOW_LABEL_COLOR)
      return (
        <span
          className="inline-flex shrink-0 items-center justify-center"
          style={{ width: size, height: size, color: ink?.ink }}
          aria-hidden
        >
          {Mark ? <Mark size={Math.max(10, Math.round(size * 0.7))} /> : null}
        </span>
      )
    }
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <HashtagMark />
      </span>
    )
  }
  if (item.brandSlug || item.kind === 'calendar') {
    return <BrandMark slug={item.brandSlug || 'calendar'} size={size} />
  }
  const icon =
    item.icon ?? (item.kind === 'flow' ? ENTITY_ICONS.flow : item.kind === 'project' ? ENTITY_ICONS.project : null)
  if (icon) return <IconMark icon={icon} size={size} />
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-bg-elevated font-medium text-text-muted"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}
      aria-hidden
    >
      {(item.label || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function ChoiceOption({
  item,
  size = 18,
  className,
  hideTrailing = false,
}: {
  item: ChoiceItem
  size?: number
  className?: string
  /** Closed trigger: hide DefaultBadge so the name stays readable. */
  hideTrailing?: boolean
}) {
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2', className)}>
      <ChoiceMark item={item} size={size} />
      <span className="min-w-0 flex-1 truncate-fade text-text-primary">{item.label}</span>
      {!hideTrailing && item.trailing ? <span className="shrink-0">{item.trailing}</span> : null}
    </span>
  )
}
