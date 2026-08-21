import type { Provider } from '../../lib/email-oauth'
import { BRAND_ASSETS } from '../../lib/brand-assets'
import { hostSlugForProvider } from '../../lib/integration-brand'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'

const EMAIL_PROVIDER_SLUG: Record<Provider, string> = {
  outlook: 'outlook',
  gmail: 'gmail',
  smtp_imap: 'smtp_imap',
  bokito: 'bokito',
}

type ProviderLogoProps = {
  provider: Provider
  className?: string
}

export function providerLogoSrc(provider: Provider): string {
  const hostSlug = hostSlugForProvider(EMAIL_PROVIDER_SLUG[provider])
  return BRAND_ASSETS[hostSlug]?.logoUrl ?? ''
}

export default function ProviderLogo({ provider, className }: ProviderLogoProps) {
  const brand = useIntegrationBrand(EMAIL_PROVIDER_SLUG[provider])
  return (
    <IntegrationHostLogo
      logoUrl={brand.logoUrl}
      logoDarkUrl={brand.logoDarkUrl}
      initials={brand.initials}
      color={brand.color}
      name={brand.name}
      size="sm"
      className={className}
    />
  )
}
