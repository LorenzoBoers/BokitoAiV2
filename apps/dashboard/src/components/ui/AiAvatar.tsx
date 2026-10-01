import { getInitials } from '../../lib/avatar'
import { resolveAgentAvatarIcon, type AgentAvatarKind } from '../../lib/agent-avatar'
import { cn } from '../../lib/utils'

interface AiAvatarProps {
  name?: string | null
  seed?: string
  size?: number
  className?: string
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  /** Ignored — agents always use the platform AI violet. Kept for call-site compat. */
  color?: string | null
  imageUrl?: string | null
  /** Hide the name from assistive tech when a parent already labels the control. */
  decorative?: boolean
}

function resolveKind(
  kind: string | null | undefined,
  icon: string | null | undefined,
  imageUrl: string | null | undefined,
): AgentAvatarKind {
  const normalized = (kind ?? '').trim().toLowerCase()
  if (normalized === 'image' && imageUrl) return 'image'
  if (normalized === 'icon' && icon && resolveAgentAvatarIcon(icon)) return 'icon'
  if (normalized === 'initials') return 'initials'
  if (imageUrl) return 'image'
  if (icon && resolveAgentAvatarIcon(icon)) return 'icon'
  return 'initials'
}

/**
 * Agent mark: image, Lucide icon, or initials — always platform AI violet.
 * Personality is the icon + name; color is never per-agent.
 */
export function AiAvatar({
  name,
  seed: _seed,
  size = 32,
  className = '',
  kind,
  icon,
  color: _color,
  imageUrl,
  decorative = false,
}: AiAvatarProps) {
  const displayName = name?.trim() || 'Agent'
  const initials = getInitials(displayName)
  const resolved = resolveKind(kind, icon, imageUrl)
  const Icon = resolved === 'icon' ? resolveAgentAvatarIcon(icon) : null
  const fontSize = Math.round(size * 0.36)
  const iconSize = Math.round(size * 0.48)
  const borderRadius = Math.round(size * 0.5)
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { 'aria-label': displayName, title: displayName }

  if (resolved === 'image' && imageUrl) {
    return (
      <span
        style={{ width: size, height: size, borderRadius }}
        className={cn('inline-flex shrink-0 overflow-hidden border border-ai/35', className)}
        {...a11yProps}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    )
  }

  return (
    <span
      style={{ width: size, height: size, borderRadius, fontSize }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center border border-ai/35 bg-ai/10 font-semibold text-ai-ink',
        className,
      )}
      {...a11yProps}
    >
      {Icon ? <Icon size={iconSize} strokeWidth={1.75} aria-hidden /> : initials}
    </span>
  )
}
