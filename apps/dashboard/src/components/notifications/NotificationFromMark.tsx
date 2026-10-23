import { Avatar } from '../ui/avatar'
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
      <Avatar
        kind="agent"
        agent={{
          name: from.name,
          seed: from.id || from.name,
          avatar_kind: from.avatar_kind,
          avatar_icon: from.avatar_icon,
          avatar_color: from.avatar_color,
          avatar_shape: from.avatar_shape,
          avatar_image_url: from.avatar_image_url,
        }}
        size={size}
        decorative
        mode="static"
        className={className}
      />
    )
  }
  if (from.kind === 'contact') {
    return (
      <Avatar
        kind="person"
        name={from.name}
        email={from.email}
        domain={from.host ?? null}
        size={size}
        className={className}
      />
    )
  }
  return (
    <Avatar
      kind="person"
      name={from.name}
      email={from.email || from.name}
      imageUrl={from.avatar_url}
      size={size}
      decorative
      className={className}
    />
  )
}
