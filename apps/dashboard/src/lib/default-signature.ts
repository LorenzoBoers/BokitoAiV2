/**
 * Dynamic default email signature from identity + UI language.
 * Mirrors apps/api/app/services/signatures.py.
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

const BOKITO_SITE = 'https://bokito.ai'

export function plainTextToSignatureHtml(text: string): string {
  const cleaned = text.trim()
  if (!cleaned) return ''
  const escaped = escapeHtml(cleaned)
  const body = escaped
    .split(/\r?\n/)
    .map((line) => (line.length ? line : '<br>'))
    .join('<br>')
  return `<p>${body}</p>`
}

/** Subtle AI disclaimer + Bokito branding under agent-identity signatures. */
export function bokitoAgentDisclaimerHtml(language?: string | null): string {
  const lang = (language || 'nl').trim().toLowerCase().slice(0, 2)
  const lead = lang === 'nl' ? 'Beantwoord door een AI-agent' : 'Replied by an AI agent'
  return (
    `<p style="margin:14px 0 0;padding-top:10px;border-top:1px solid #e8eaed;` +
    `font-size:11px;line-height:1.45;color:#9aa0a6">` +
    `${escapeHtml(lead)}` +
    ` · Powered by ` +
    `<a href="${BOKITO_SITE}" style="color:#6b7280;text-decoration:underline" ` +
    `target="_blank" rel="noopener noreferrer">Bokito AI</a></p>`
  )
}

export function withAgentDisclaimer(signatureHtml: string, language?: string | null): string {
  const body = signatureHtml.trim()
  const disclaimer = bokitoAgentDisclaimerHtml(language)
  return body ? `${body}${disclaimer}` : disclaimer
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
