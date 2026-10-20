import { getAvatarColor, getEmailInitials, getInitials } from '../../lib/avatar'
import {
  isGenericVisitorName,
  isOpaqueWidgetAddress,
  isPlaceholderContactAddress,
} from '../../lib/contact-label'
import { AvatarDisc } from './AvatarDisc'

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

  if (!initials) {
    // Unknown person: quiet question-mark badge instead of a misleading icon.
    return (
      <AvatarDisc size={size} className={className}>
        ?
      </AvatarDisc>
    )
  }

  return (
    <AvatarDisc size={size} colors={getAvatarColor(usableEmail || rawName)} className={className}>
      {initials}
    </AvatarDisc>
  )
}
