import type { BadgeTone } from '../ui/badge'
import type { ContactRow, ContactStatus } from '../../lib/contacts-api'
import { isAnonymousContact } from '../../lib/contact-label'

export const STATUS_TONE: Record<ContactStatus, BadgeTone> = {
  approved: 'success',
  pending: 'warning',
  blocked: 'error',
}

export function displayContactStatus(
  contact: Pick<ContactRow, 'status' | 'displayName' | 'address'>,
): ContactStatus {
  if (contact.status === 'blocked') return 'blocked'
  if (isAnonymousContact(contact.displayName, contact.address)) return 'pending'
  return contact.status
}
