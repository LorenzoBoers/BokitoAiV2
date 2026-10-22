import type { CSSProperties, ReactNode } from 'react'
import { snapMarkSize } from '../../lib/mark-scale'
import { cn } from '../../lib/utils'

type AvatarDiscProps = {
  size: number
  /** Initials or a glyph. Ignored when `imageUrl` is set. */
  children?: ReactNode
  imageUrl?: string | null
  alt?: string
  /** Fill and ink for initials; omit for the muted unknown-person disc. */
  colors?: { bg: string; text: string }
  decorative?: boolean
  className?: string
}

/**
 * Shared round face for people (UserAvatar, PersonAvatar). One shape, one
 * initials size ratio, one muted fallback. Agents use AgentMark instead.
 */
export function AvatarDisc({ size, children, imageUrl, alt = '', colors, decorative = true, className }: AvatarDiscProps) {
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
        !colors && 'border border-border/60 bg-bg-hover text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

export default AvatarDisc
