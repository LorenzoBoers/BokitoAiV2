import { useMemo, useState } from 'react'
import { getInitials, getAvatarColor } from '../../lib/avatar'
import { getDomainFaviconUrl, getHostFaviconUrl } from '../../lib/domain-favicon'
import { cn } from '../../lib/utils'

type Props = {
  email?: string | null
  host?: string | null
  name?: string | null
  size?: number
  className?: string
}

/** Domain favicon avatar with initials fallback when the icon cannot load. */
export function DomainFavicon({ email, host, name, size = 28, className }: Props) {
  const [errored, setErrored] = useState(false)
  const faviconUrl = useMemo(
    () => getDomainFaviconUrl(email, 64) ?? getHostFaviconUrl(host, 64),
    [email, host],
  )
  const seed = email || host || name || '?'
  const initials = getInitials(name || email || host || '?')
  const { bg, text } = getAvatarColor(seed)
  const borderRadius = Math.round(size * 0.3)

  if (!faviconUrl || errored) {
    return (
      <span
        style={{ width: size, height: size, borderRadius, background: bg, color: text, fontSize: Math.round(size * 0.36) }}
        className={cn('inline-flex shrink-0 select-none items-center justify-center font-semibold', className)}
      >
        {initials}
      </span>
    )
  }

  return (
    <span
      style={{ width: size, height: size, borderRadius }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-border/40 bg-bg',
        className,
      )}
    >
      <img
        src={faviconUrl}
        alt=""
        onError={() => setErrored(true)}
        width={Math.round(size * 0.7)}
        height={Math.round(size * 0.7)}
        className="object-contain"
      />
    </span>
  )
}
