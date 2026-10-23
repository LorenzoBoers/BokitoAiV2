import { Avatar } from './avatar'

type Props = {
  name?: string | null
  email?: string | null
  host?: string | null
  size?: number
  className?: string
}

/** @deprecated Use `<Avatar kind="person" domain={host ?? null}>`. */
export function ContactAvatar({ name, email, host, size = 28, className }: Props) {
  return <Avatar kind="person" name={name} email={email} domain={host ?? null} size={size} className={className} />
}
