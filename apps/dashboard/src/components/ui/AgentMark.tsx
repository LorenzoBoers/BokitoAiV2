import type { BotOrbMotion } from '../../lib/agentActivity'
import { toAiAvatarProps, type AgentAvatarSource } from '../../lib/agent-avatar'
import type { AgentPresenceStatus } from '../../lib/teams-api'
import { AiAvatar } from './AiAvatar'

type Props = {
  /** Full agent / thread / picker row — do not pre-strip avatar fields. */
  agent: AgentAvatarSource | null | undefined
  size?: number
  className?: string
  decorative?: boolean
  activity?: AgentPresenceStatus | null
  motion?: BotOrbMotion | null
  /** Freeze orb idle motion (facepiles, static previews). */
  paused?: boolean
  fallbackName?: string
}

/**
 * Canonical agent face. All product surfaces should render agents through this
 * (or `toAiAvatarProps` + `AiAvatar`) so orb shape/color stay consistent.
 */
export function AgentMark({
  agent,
  size = 32,
  className,
  decorative = true,
  activity,
  motion,
  paused,
  fallbackName,
}: Props) {
  return (
    <AiAvatar
      {...toAiAvatarProps(agent, fallbackName)}
      size={size}
      className={className}
      decorative={decorative}
      activity={activity}
      motion={motion}
      paused={paused}
    />
  )
}
