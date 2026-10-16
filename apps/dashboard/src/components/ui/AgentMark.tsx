import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import { toAiAvatarProps, type AgentAvatarSource } from '../../lib/agent-avatar'
import type { AgentPresenceStatus } from '../../lib/teams-api'
import { AiAvatar, type AiAvatarMode } from './AiAvatar'

type Props = {
  /** Full agent / thread / picker row — do not pre-strip avatar fields. */
  agent: AgentAvatarSource | null | undefined
  size?: number
  className?: string
  decorative?: boolean
  activity?: AgentPresenceStatus | null
  motion?: BotOrbMotion | null
  pulseId?: string | null
  baseMotion?: BotOrbMotion | null
  /** Canonical presentation: live animates; static freezes. */
  mode?: AiAvatarMode
  /**
   * Alias for `mode="static"`. Prefer `mode`.
   * @deprecated Use `mode="static"`.
   */
  paused?: boolean
  spawnKey?: string | null
  /** Silhouette outline for overlapping facepiles. */
  stackOutline?: boolean
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
  pulseId,
  baseMotion,
  mode,
  paused,
  spawnKey,
  stackOutline,
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
      pulseId={pulseId}
      baseMotion={baseMotion}
      mode={mode}
      paused={paused}
      spawnKey={spawnKey}
      stackOutline={stackOutline}
    />
  )
}
