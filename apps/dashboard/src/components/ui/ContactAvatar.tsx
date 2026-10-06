import { preferCompanyFavicon } from '../../lib/company-avatar'
import { DomainFavicon } from './DomainFavicon'
import { PersonAvatar } from './PersonAvatar'

type Props = {
  name?: string | null
  email?: string | null
  /** Explicit company host when the thread/contact has a CRM company domain. */
  host?: string | null
  size?: number
  className?: string
}

/**
 * External counterparty avatar: company favicon for org senders, person
 * initials otherwise. Never shows a misleading globe for unknown people.
 */
export function ContactAvatar({ name, email, host, size = 28, className }: Props) {
  if (preferCompanyFavicon(name, email, host)) {
    return <DomainFavicon email={email} host={host} name={name} size={size} className={className} />
  }
  return <PersonAvatar name={name} email={email} size={size} className={className} />
}
