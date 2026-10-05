import { useEffect, useState } from 'react'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import { IntegrationHostLogo, type IntegrationHostLogoSize } from './IntegrationHostLogo'
import { cn } from '../../lib/utils'

/**
 * Inline brand logo for a connectable system (WhatsApp, Slack, Gmail, ...).
 * Resolves via the integration brand system (API host branding with static
 * fallbacks from `lib/brand-assets.ts`). Every slug renders a mark: the
 * vendor logo when we have one, otherwise host initials. Use `BrandTile`
 * for card headers.
 */

type MarkProps = {
  slug: string
  /** Pixel size of the logo image. Defaults to 14 (button/row scale). */
  size?: number
  className?: string
}

export function BrandMark({ slug, size = 14, className }: MarkProps) {
  const brand = useIntegrationBrand(slug)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [brand.logoUrl, slug])

  if (brand.logoUrl && !failed) {
    return (
      <img
        src={brand.logoUrl}
        alt=""
        title={brand.name}
        style={{ width: size, height: size }}
        className={cn('shrink-0 object-contain', className)}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span
      aria-hidden
      title={brand.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[3px] font-semibold leading-none text-white',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: brand.color,
        fontSize: Math.max(7, Math.round(size * 0.42)),
      }}
    >
      {(brand.initials || '?').slice(0, 2)}
    </span>
  )
}

type TileProps = {
  slug: string
  size?: IntegrationHostLogoSize
  className?: string
}

export function BrandTile({ slug, size = 'md', className }: TileProps) {
  const brand = useIntegrationBrand(slug)
  return (
    <IntegrationHostLogo
      logoUrl={brand.logoUrl}
      logoDarkUrl={brand.logoDarkUrl}
      initials={brand.initials}
      color={brand.color}
      name={brand.name}
      hostSlug={brand.hostSlug}
      size={size}
      className={className}
    />
  )
}
