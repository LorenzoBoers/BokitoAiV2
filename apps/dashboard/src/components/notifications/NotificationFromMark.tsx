import { AiAvatar } from '../ui/AiAvatar'
import { ContactAvatar } from '../ui/ContactAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import type { NotificationFrom } from '../../lib/notification-from'

type Props = {
  from: NotificationFrom
  size?: number
  className?: string
}

/** Avatar for a notification sender; omit the parent when `from` is null. */
export function NotificationFromMark({ from, size = 36, className }: Props) {
  if (from.kind === 'agent') {
    return (
      <AiAvatar
        name={from.name}
        seed={from.id || from.name}
        size={size}
        kind={from.avatar_kind}
        icon={from.avatar_icon}
        color={from.avatar_color}
        shape={from.avatar_shape}
        imageUrl={from.avatar_image_url}
        decorative
        mode="static"
        className={className}
      />
    )
  }
  if (from.kind === 'contact') {
    return (
      <ContactAvatar
        name={from.name}
        email={from.email}
        host={from.host}
        size={size}
        className={className}
      />
    )
  }
  return (
    <UserAvatar
      name={from.name}
      email={from.email || from.name}
      avatarUrl={from.avatar_url}
      size={size}
      decorative
      className={className}
    />
  )
}
