/**
 * Dynamic default email signature from identity + UI language.
 * Mirrors apps/api/app/services/signatures.py compose_default_signature_html.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CLOSINGS: Record<string, string> = {
  nl: 'Met vriendelijke groet',
  en: 'Kind regards',
  de: 'Mit freundlichen Grüßen',
  fr: 'Cordialement',
  es: 'Un saludo',
}

export function composeDefaultSignatureHtml(opts: {
  name: string
  email?: string | null
  jobTitle?: string | null
  company?: string | null
  language?: string | null
}): string {
  const display = (opts.name || '').trim() || (opts.email || '').trim() || 'Team'
  const langRaw = (opts.language || 'nl').trim().toLowerCase().slice(0, 2)
  const closing = CLOSINGS[langRaw] || CLOSINGS.en
  const parts = [
    `<p>${escapeHtml(closing)},<br><br>`,
    `<strong>${escapeHtml(display)}</strong>`,
  ]
  const title = (opts.jobTitle || '').trim()
  if (title) parts.push(`<br>${escapeHtml(title)}`)
  const org = (opts.company || '').trim()
  if (org) parts.push(`<br>${escapeHtml(org)}`)
  const addr = (opts.email || '').trim()
  if (addr && addr.toLowerCase() !== display.toLowerCase()) {
    parts.push(`<br>${escapeHtml(addr)}`)
  }
  parts.push('</p>')
  return parts.join('')
}
