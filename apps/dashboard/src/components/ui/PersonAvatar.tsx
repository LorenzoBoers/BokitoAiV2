import { getAvatarColor, getEmailInitials, getInitials } from '../../lib/avatar'
import {
  isGenericVisitorName,
  isOpaqueWidgetAddress,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
import { cn } from '../../lib/utils'

type Props = {
  /** Contact display name; generic visitor labels are treated as unknown. */
  name?: string | null
  /** Contact address; widget placeholders (visitor@web, cust_…) are ignored. */
  email?: string | null
  size?: number
  className?: string
}

/**
 * The one avatar for external people across the platform.
 *
 * - Known name → colored initials (first + last word).
 * - Only an email address → initials from its local part.
 * - Unknown person (website visitor, placeholder address) → muted circle
 *   with a question mark, never a favicon/globe.
 */
export function PersonAvatar({ name, email, size = 28, className }: Props) {
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
  const fontSize = Math.round(size * 0.36)

  if (!initials) {
    // Unknown person: quiet question-mark badge instead of a misleading icon.
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize }}
        className={cn(
          'inline-flex shrink-0 select-none items-center justify-center rounded-full',
          'border border-border/60 bg-bg-hover font-semibold leading-none text-text-muted',
          className,
        )}
      >
        ?
      </span>
    )
  }

  const { bg, text } = getAvatarColor(usableEmail || rawName)
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: bg, color: text, fontSize }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
        className,
      )}
    >
      {initials}
    </span>
  )
}
