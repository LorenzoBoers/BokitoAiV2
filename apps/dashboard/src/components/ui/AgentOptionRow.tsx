import { AiAvatar } from './AiAvatar'
import { cn } from '../../lib/utils'

export type AgentVisualFields = {
  id: string
  name: string
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_image_url?: string | null
}

type Props = {
  agent: AgentVisualFields
  size?: number
  className?: string
  /** Extra content after the name (badges, role). */
  trailing?: React.ReactNode
}

/** Shared agent row: AiAvatar + name for selects and roster lists. */
export function AgentOptionRow({ agent, size = 20, className, trailing }: Props) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <AiAvatar
        name={agent.name}
        seed={agent.id}
        size={size}
        kind={agent.avatar_kind}
        icon={agent.avatar_icon}
        color={agent.avatar_color}
        imageUrl={agent.avatar_image_url}
      />
      <span className="min-w-0 truncate text-sm text-text-primary">{agent.name}</span>
      {trailing}
    </span>
  )
}
