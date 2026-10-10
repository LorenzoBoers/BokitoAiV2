import type { ReactNode } from 'react'
import { FolderKanban, Workflow, type LucideIcon } from 'lucide-react'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import { BrandMark } from '../integrations/BrandMark'
import { AiAvatar } from './AiAvatar'
import { HashtagMark } from './HashtagMark'
import { TeamAvatar } from './TeamAvatar'
import { UserAvatar } from './UserAvatar'
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
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
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
    return <AiAvatar {...toAiAvatarProps(agent, item.label)} size={size} decorative />
  }
  if (item.kind === 'person') {
    const person = item.person ?? { name: item.label }
    return (
      <UserAvatar
        name={person.name || item.label}
        email={person.email || person.name || item.label}
        avatarUrl={person.avatarUrl}
        size={size}
        decorative
      />
    )
  }
  if (item.kind === 'team') {
    const team = item.team ?? { name: item.label }
    return <TeamAvatar {...toTeamAvatarProps(team)} size={size} decorative />
  }
  if (item.kind === 'tag') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <HashtagMark category={item.category} />
      </span>
    )
  }
  if (item.brandSlug || item.kind === 'calendar') {
    return <BrandMark slug={item.brandSlug || 'calendar'} size={size} />
  }
  const icon = item.icon ?? (item.kind === 'flow' ? Workflow : item.kind === 'project' ? FolderKanban : null)
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
}: {
  item: ChoiceItem
  size?: number
  className?: string
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <ChoiceMark item={item} size={size} />
      <span className="min-w-0 flex-1 truncate-fade text-sm text-text-primary">{item.label}</span>
      {item.trailing}
    </span>
  )
}
