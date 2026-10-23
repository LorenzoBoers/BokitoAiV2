import type { CSSProperties, ReactNode } from 'react'
import { getAvatarColor, getEmailInitials, getInitials } from '../../lib/avatar'
import { toAiAvatarProps, type AgentAvatarSource } from '../../lib/agent-avatar'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import { preferCompanyFavicon } from '../../lib/company-avatar'
import {
  isGenericVisitorName,
  isOpaqueWidgetAddress,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
import { snapMarkSize } from '../../lib/mark-scale'
import { resolveTeamAvatarIcon, toTeamAvatarProps } from '../../lib/team-avatar'
import type { AgentPresenceStatus, PresenceStatus } from '../../lib/teams-api'
import { cn } from '../../lib/utils'
import { AiAvatar, type AiAvatarMode } from './AiAvatar'
import { DomainFavicon } from './DomainFavicon'
import { PresenceCorner } from './PresenceCorner'

export type TeamAvatarSource = Parameters<typeof toTeamAvatarProps>[0]

type PersonProps = {
  kind: 'person'
  name?: string | null
  email?: string | null
  imageUrl?: string | null
  /**
   * Company host for external contacts. Passing it (null derives it from the
   * email) lets an organisation sender show its favicon instead of initials.
   */
  domain?: string | null
  presence?: PresenceStatus
}

type AgentProps = {
  kind: 'agent'
  /** Full agent / thread / picker row; do not pre-strip avatar fields. */
  agent: AgentAvatarSource | null | undefined
  mode?: AiAvatarMode
  activity?: AgentPresenceStatus | null
  motion?: BotOrbMotion | null
  pulseId?: string | null
  baseMotion?: BotOrbMotion | null
  /** @deprecated Use `mode="static"`. */
  paused?: boolean
  spawnKey?: string | null
  /** Silhouette outline for overlapping facepiles. */
  stackOutline?: boolean
  fallbackName?: string
}

type TeamProps = {
  kind: 'team'
  team: TeamAvatarSource
  fallbackName?: string
  presence?: PresenceStatus
}

export type AvatarProps = (PersonProps | AgentProps | TeamProps) & {
  /** Snaps to the mark ladder in `lib/mark-scale.ts`. */
  size?: number
  /** Hide the face from assistive tech when a parent already names it. */
  decorative?: boolean
  className?: string
}

/** The one face for people, agents and teams. Groups use AvatarStack. */
export function Avatar(props: AvatarProps) {
  const { size = 32, decorative = true, className } = props
  if (props.kind === 'agent') {
    return (
      <AiAvatar
        {...toAiAvatarProps(props.agent, props.fallbackName)}
        size={size}
        className={className}
        decorative={decorative}
        activity={props.activity}
        motion={props.motion}
        pulseId={props.pulseId}
        baseMotion={props.baseMotion}
        mode={props.mode}
        paused={props.paused}
        spawnKey={props.spawnKey}
        stackOutline={props.stackOutline}
      />
    )
  }
  const face =
    props.kind === 'team' ? (
      <TeamFace
        team={props.team}
        fallbackName={props.fallbackName}
        size={size}
        decorative={decorative}
        className={props.presence ? undefined : className}
      />
    ) : (
      <PersonFace {...props} size={size} decorative={decorative} className={props.presence ? undefined : className} />
    )
  if (!props.presence) return face
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {face}
      <PresenceCorner status={props.presence} size={size} />
    </span>
  )
}

function PersonFace({
  name,
  email,
  imageUrl,
  domain,
  size,
  decorative,
  className,
}: Omit<PersonProps, 'kind' | 'presence'> & { size: number; decorative: boolean; className?: string }) {
  if (!imageUrl && domain !== undefined && preferCompanyFavicon(name, email, domain)) {
    return <DomainFavicon email={email} host={domain} name={name} size={size} className={className} />
  }

  const rawName = (name ?? '').trim()
  const rawEmail = (email ?? '').trim()
  const nameKnown =
    rawName !== '' &&
    !rawName.includes('@') &&
    !isGenericVisitorName(rawName) &&
    !isOpaqueWidgetAddress(rawName)
  // Call sites sometimes pass the address in the name slot; treat it as email.
  const usableEmail =
    rawEmail && !isPlaceholderContactAddress(rawEmail) && rawEmail.includes('@')
      ? rawEmail
      : rawName.includes('@') && !isPlaceholderContactAddress(rawName)
        ? rawName
        : ''
  const initials = nameKnown ? getInitials(rawName) : getEmailInitials(usableEmail)

  if (!initials && !imageUrl) {
    // Unknown person (visitor, placeholder address): quiet question mark.
    return (
      <AvatarDisc size={size} decorative={decorative} className={className}>
        ?
      </AvatarDisc>
    )
  }
  return (
    <AvatarDisc
      size={size}
      imageUrl={imageUrl}
      alt={rawName}
      colors={getAvatarColor(usableEmail || rawName)}
      decorative={decorative}
      className={className}
    >
      {initials}
    </AvatarDisc>
  )
}

function AvatarDisc({
  size,
  children,
  imageUrl,
  alt = '',
  colors,
  decorative,
  className,
}: {
  size: number
  children?: ReactNode
  imageUrl?: string | null
  alt?: string
  /** Fill and ink for initials; omit for the muted unknown-person disc. */
  colors?: { bg: string; text: string }
  decorative: boolean
  className?: string
}) {
  const boxSize = snapMarkSize(size)
  const box: CSSProperties = { width: boxSize, height: boxSize }
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={decorative ? '' : alt}
        style={box}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    )
  }
  return (
    <span
      aria-hidden={decorative || undefined}
      style={{ ...box, fontSize: Math.round(boxSize * 0.36), background: colors?.bg, color: colors?.text }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
        !colors && 'border border-border bg-bg-hover text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

function TeamFace({
  team,
  fallbackName,
  size,
  decorative,
  className,
}: {
  team: TeamAvatarSource
  fallbackName?: string
  size: number
  decorative: boolean
  className?: string
}) {
  const { name, seed, kind, icon, color, imageUrl } = toTeamAvatarProps(team, fallbackName)
  const displayName = name?.trim() || 'Team'
  const box = snapMarkSize(size)
  const normalized = (kind ?? '').trim().toLowerCase()
  const resolved =
    normalized === 'image' && imageUrl
      ? 'image'
      : normalized === 'icon' && icon && resolveTeamAvatarIcon(icon)
        ? 'icon'
        : normalized === 'initials'
          ? 'initials'
          : imageUrl
            ? 'image'
            : icon && resolveTeamAvatarIcon(icon)
              ? 'icon'
              : 'initials'
  const Icon = resolved === 'icon' ? resolveTeamAvatarIcon(icon) : null
  const bg = color?.trim() || getAvatarColor(seed || displayName).bg
  const borderRadius = Math.round(box * 0.5)
  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : { 'aria-label': displayName, title: displayName }

  if (resolved === 'image' && imageUrl) {
    return (
      <span
        style={{ width: box, height: box, borderRadius }}
        className={cn('inline-flex shrink-0 overflow-hidden border border-border', className)}
        {...a11yProps}
      >
        <img src={imageUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    )
  }
  return (
    <span
      style={{ width: box, height: box, borderRadius, fontSize: Math.round(box * 0.36), background: bg, color: '#ffffff' }}
      className={cn('inline-flex shrink-0 select-none items-center justify-center font-semibold leading-none', className)}
      {...a11yProps}
    >
      {Icon ? <Icon size={Math.round(box * 0.48)} strokeWidth={1.75} aria-hidden /> : getInitials(displayName)}
    </span>
  )
}
