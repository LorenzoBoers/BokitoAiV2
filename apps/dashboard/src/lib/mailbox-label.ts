/** Human mailbox titles for the Communication sidebar and channel lists. */

export function mailboxDisplayLabel(
  displayName?: string | null,
  mailboxEmail?: string | null,
): string {
  const name = displayName?.trim() ?? ''
  const email = mailboxEmail?.trim() ?? ''
  if (!name) return email

  const wrapped = name.match(/^(.*)\s+\(([^)]+)\)\s*$/)
  if (wrapped) {
    const left = wrapped[1].trim()
    const inner = wrapped[2].trim()
    if (left && left.toLowerCase() === inner.toLowerCase()) return left
    if (email && inner.toLowerCase() === email.toLowerCase()) return left || email
  }

  if (email && name.toLowerCase() === email.toLowerCase()) return email
  return name
}
