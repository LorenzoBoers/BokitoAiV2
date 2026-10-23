import { Avatar } from './avatar'

type Props = {
  name?: string | null
  email?: string | null
  size?: number
  className?: string
}

/** @deprecated Use `<Avatar kind="person">`. */
export function PersonAvatar({ name, email, size = 28, className }: Props) {
  return <Avatar kind="person" name={name} email={email} size={size} className={className} />
}
