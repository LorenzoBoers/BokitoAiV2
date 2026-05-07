import type { Provider } from '../../lib/email-oauth'

const providerLogoMap: Record<Provider, string> = {
  outlook: '/brands/logo-outlook.svg',
  gmail: '/brands/logo-gmail.svg',
  smtp_imap: '/brands/logo-smtp-imap.svg',
}

const providerAltMap: Record<Provider, string> = {
  outlook: 'Outlook logo',
  gmail: 'Gmail logo',
  smtp_imap: 'SMTP/IMAP logo',
}

export function providerLogoSrc(provider: Provider): string {
  return providerLogoMap[provider]
}

type ProviderLogoProps = {
  provider: Provider
  className?: string
}

export default function ProviderLogo({ provider, className }: ProviderLogoProps) {
  const invertClass = provider === 'smtp_imap' ? 'dark:invert' : ''
  return (
    <img
      src={providerLogoSrc(provider)}
      alt={providerAltMap[provider]}
      className={[className, invertClass].filter(Boolean).join(' ')}
      loading="lazy"
    />
  )
}
