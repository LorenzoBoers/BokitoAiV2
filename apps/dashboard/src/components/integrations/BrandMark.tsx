import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import { IntegrationHostLogo, type IntegrationHostLogoSize } from './IntegrationHostLogo'
import { cn } from '../../lib/utils'

/**
 * Inline brand logo for a connectable system (WhatsApp, Slack, Gmail, ...).
 * Resolves via the integration brand system (API host branding with static
 * fallbacks from `lib/brand-assets.ts`). Use `BrandMark` for small inline
 * spots (buttons, rows) and `BrandTile` for card headers.
 */

type MarkProps = {
  slug: string
  /** Pixel size of the logo image. Defaults to 14 (button/row scale). */
  size?: number
  className?: string
}

export function BrandMark({ slug, size = 14, className }: MarkProps) {
  const brand = useIntegrationBrand(slug)
  if (!brand.logoUrl) return null
  return (
    <img
      src={brand.logoUrl}
      alt=""
      title={brand.name}
      style={{ width: size, height: size }}
      className={cn('shrink-0 object-contain', className)}
      loading="lazy"
    />
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
