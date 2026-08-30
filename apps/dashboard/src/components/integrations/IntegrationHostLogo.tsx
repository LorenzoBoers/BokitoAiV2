import { useEffect, useState } from 'react'
import { Cable, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/** Neutral UI placeholders per host slug (not third-party brand marks). */
const HOST_PLACEHOLDER_ICONS: Record<string, LucideIcon> = {
  custom: Cable,
}

export type IntegrationHostLogoSize = 'sm' | 'md' | 'lg'

const iconPixelSize: Record<IntegrationHostLogoSize, number> = {
  sm: 14,
  md: 18,
  lg: 22,
}

const sizeClasses: Record<IntegrationHostLogoSize, { box: string; text: string }> = {
  sm: { box: 'h-7 w-7 rounded-md', text: 'text-[10px]' },
  md: { box: 'h-10 w-10 rounded-lg', text: 'text-xs' },
  lg: { box: 'h-12 w-12 rounded-lg', text: 'text-sm' },
}

export type IntegrationHostLogoProps = {
  logoUrl?: string | null
  logoDarkUrl?: string | null
  initials: string
  color: string
  name: string
  hostSlug?: string | null
  size?: IntegrationHostLogoSize
  className?: string
  imageClassName?: string
}

function IconPlaceholderBadge({
  Icon,
  color,
  name,
  sizes,
  size,
  className,
}: {
  Icon: LucideIcon
  color: string
  name: string
  sizes: { box: string; text: string }
  size: IntegrationHostLogoSize
  className?: string
}) {
  const px = iconPixelSize[size]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center text-white shadow-sm ring-1 ring-black/10',
        sizes.box,
        className,
      )}
      style={{ backgroundColor: color }}
      title={name}
    >
      <Icon size={px} strokeWidth={2} aria-hidden />
      <span className="sr-only">{name}</span>
    </span>
  )
}

function InitialsBadge({
  initials,
  color,
  name,
  sizes,
  className,
}: {
  initials: string
  color: string
  name: string
  sizes: { box: string; text: string }
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-sm ring-1 ring-black/10',
        sizes.box,
        sizes.text,
        className,
      )}
      style={{ backgroundColor: color }}
      title={name}
    >
      {name ? <span className="sr-only">{name}</span> : null}
      <span aria-hidden>{initials}</span>
    </span>
  )
}

export function IntegrationHostLogo({
  logoUrl,
  logoDarkUrl,
  initials,
  color,
  name,
  hostSlug,
  size = 'md',
  className,
  imageClassName,
}: IntegrationHostLogoProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const sizes = sizeClasses[size]
  const trimmedUrl = logoUrl?.trim() ?? ''

  useEffect(() => {
    setImgFailed(false)
  }, [trimmedUrl, logoDarkUrl])
  const trimmedDarkUrl = logoDarkUrl?.trim() ?? ''
  const hasLightLogo = trimmedUrl.length > 0 && !imgFailed
  const hasDarkLogo = trimmedDarkUrl.length > 0 && !imgFailed
  const showImage = hasLightLogo || hasDarkLogo

  if (showImage) {
    const useDarkVariant = hasDarkLogo
    // Colorful marks (Gmail, Microsoft, Slack, …) sit on the surface plate.
    // Never force a white disc — that breaks dark UI vs BrandMark / WhatsApp.
    const invertOnDark =
      Boolean(hostSlug) &&
      ['github', 'notion', 'linear', 'custom', 'smtp'].includes(hostSlug!) &&
      !hasDarkLogo
    return (
      <span
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-bg-elevated ring-1 ring-border/50',
          sizes.box,
          className,
        )}
      >
        {hasLightLogo ? (
          <img
            src={trimmedUrl}
            alt=""
            className={cn(
              'h-full w-full object-contain p-1',
              useDarkVariant && 'dark:hidden',
              invertOnDark && 'dark:invert',
              imageClassName,
            )}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : null}
        {hasDarkLogo ? (
          <img
            src={trimmedDarkUrl}
            alt=""
            className={cn(
              'h-full w-full object-contain p-1',
              hasLightLogo ? 'hidden dark:block' : 'block',
              imageClassName,
            )}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : null}
        <span className="sr-only">{name}</span>
      </span>
    )
  }

  const PlaceholderIcon = hostSlug ? HOST_PLACEHOLDER_ICONS[hostSlug] : undefined
  if (PlaceholderIcon) {
    return (
      <IconPlaceholderBadge
        Icon={PlaceholderIcon}
        color={color}
        name={name}
        sizes={sizes}
        size={size}
        className={className}
      />
    )
  }

  return (
    <InitialsBadge
      initials={initials}
      color={color}
      name={name}
      sizes={sizes}
      className={className}
    />
  )
}
