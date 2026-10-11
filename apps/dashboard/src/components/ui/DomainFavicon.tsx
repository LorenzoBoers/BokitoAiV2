import { Globe } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getInitials, getAvatarColor } from '../../lib/avatar'
import { getDomainFaviconUrl, getHostFaviconUrl, normalizeFaviconHost } from '../../lib/domain-favicon'
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
        onLoad={(event) => {
          // Google S2 serves a generic 16px globe (HTTP 200) for unknown
          // domains; treat that as a miss so initials render instead.
          if (event.currentTarget.naturalWidth <= 16) setErrored(true)
        }}
        width={Math.round(size * 0.7)}
        height={Math.round(size * 0.7)}
        className="object-contain"
      />
    </span>
  )
}

function hostFromHref(href: string): string | null {
  try {
    return normalizeFaviconHost(new URL(href).hostname)
  } catch {
    return normalizeFaviconHost(href)
  }
}

/**
 * Inline mark for http(s) links in chat: site favicon when Google S2 has one,
 * otherwise a globe. Mailto and non-http schemes get no icon.
 */
export function WebPageLinkIcon({
  href,
  className,
}: {
  href: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const host = useMemo(() => hostFromHref(href), [href])
  const faviconUrl = useMemo(() => getHostFaviconUrl(host, 32), [host])
  const iconClass = cn(
    'inline-block shrink-0 align-[-0.12em]',
    className,
  )
  const sizeStyle = { width: '0.875em', height: '0.875em' } as const

  if (!host || !/^https?:\/\//i.test(href.trim())) return null

  if (!faviconUrl || failed) {
    return (
      <Globe
        size={12}
        aria-hidden
        className={cn(iconClass, 'text-current opacity-80')}
        style={sizeStyle}
      />
    )
  }

  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn(iconClass, 'rounded-[2px] object-contain')}
      style={sizeStyle}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        // Same miss signal as DomainFavicon: S2's default globe is tiny.
        if (event.currentTarget.naturalWidth <= 16) setFailed(true)
      }}
    />
  )
}
