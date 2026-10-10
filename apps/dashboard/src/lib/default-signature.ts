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

const PLACEHOLDER_ALIASES: Record<string, string> = {
  function: 'job_title',
  title: 'job_title',
  role: 'job_title',
  job: 'job_title',
  org: 'company',
  organisation: 'company',
  organization: 'company',
  tel: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  web: 'website',
  url: 'website',
  addr: 'address',
  firstname: 'first_name',
  first: 'first_name',
  voornaam: 'first_name',
  lastname: 'last_name',
  last: 'last_name',
  surname: 'last_name',
  achternaam: 'last_name',
}

export type SignatureIdentityVars = {
  name: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  jobTitle?: string | null
  company?: string | null
  phone?: string | null
  website?: string | null
  address?: string | null
  avatarUrl?: string | null
  language?: string | null
}

export function signatureClosingText(language?: string | null): string {
  const langRaw = (language || 'nl').trim().toLowerCase().slice(0, 2)
  return CLOSINGS[langRaw] || CLOSINGS.en
}

/** Circle with initials. No image, so it still shows when there is no photo. */
export function initialsAvatarHtml(name: string, size = 48): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const initials = (
    parts.length === 0
      ? '?'
      : parts.length === 1
        ? parts[0].slice(0, 2)
        : `${parts[0][0]}${parts[parts.length - 1][0]}`
  ).toUpperCase()
  const font = Math.round(size * 0.36)
  return (
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse">` +
    `<tr><td width="${size}" height="${size}" align="center" valign="middle" ` +
    `style="width:${size}px;height:${size}px;background:#4652f2;border-radius:${Math.round(size / 2)}px;` +
    `color:#ffffff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:${font}px;` +
    `font-weight:600;line-height:${size}px;text-align:center">${escapeHtml(initials)}</td></tr></table>`
  )
}

/** Photo when the URL is http(s); otherwise the initials circle. */
export function avatarMarkHtml(url: string | null | undefined, name: string, size = 48): string {
  const photo = photoAvatarUrl(url)
  if (photo) return roundAvatarImgHtml(photo, name, size)
  return initialsAvatarHtml(name, size)
}

/** Photo the editor can show: https, a same-origin path, or a raster data URI. */
function photoAvatarUrl(url: string | null | undefined): string | null {
  const raw = (url || '').trim()
  if (!raw || /^data:image\/svg/i.test(raw)) return null
  if (/^data:image\/(?:png|jpe?g|gif|webp)/i.test(raw)) return raw
  if (raw.startsWith('https://') || raw.startsWith('http://') || raw.startsWith('/')) return raw
  return null
}

/** Avatar mark for the visual editor. An img stays intact inside contentEditable. */
function editorAvatarImgHtml(url: string | null | undefined, name: string, size = 48): string {
  const photo = photoAvatarUrl(url)
  const src = photo ? escapeHtml(photo) : initialsAvatarSvgSrc(name, size)
  return (
    `<img data-sig-avatar="1" contenteditable="false" src="${src}" alt="" ` +
    `width="${size}" height="${size}" ` +
    `style="border-radius:50%;display:inline-block;width:${size}px;height:${size}px;` +
    `object-fit:cover;vertical-align:top;border:0" />`
  )
}

function initialsAvatarSvgSrc(name: string, size = 48): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  const initials = (
    parts.length === 0
      ? '?'
      : parts.length === 1
        ? parts[0].slice(0, 2)
        : `${parts[0][0]}${parts[parts.length - 1][0]}`
  ).toUpperCase()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">` +
    `<circle cx="24" cy="24" r="24" fill="#4652f2"/>` +
    `<text x="24" y="26" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" ` +
    `font-family="system-ui,sans-serif" font-size="16" font-weight="600">${escapeHtml(initials)}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function roundAvatarImgHtml(url: string, name: string, size = 48): string {
  return (
    `<img src="${escapeHtml(url)}" alt="${escapeHtml(name || 'Avatar')}" ` +
    `width="${size}" height="${size}" ` +
    `style="border-radius:50%;display:block;width:${size}px;height:${size}px;` +
    `object-fit:cover;border:0" />`
  )
}

function avatarPlaceholderHtml(url: string | null | undefined, name: string, size = 48): string {
  return avatarMarkHtml(url, name, size)
}

export function signatureIdentityMap(opts: SignatureIdentityVars): Record<string, string> {
  let first = (opts.firstName || '').trim()
  let last = (opts.lastName || '').trim()
  const composed = [first, last].filter(Boolean).join(' ').trim()
  const display = (opts.name || '').trim() || composed || (opts.email || '').trim() || 'Team'
  if (!first && !last && display) {
    const parts = display.split(/\s+/)
    first = parts[0] ?? ''
    last = parts.slice(1).join(' ')
  }
  return {
    name: display,
    first_name: first,
    last_name: last,
    email: (opts.email || '').trim(),
    job_title: (opts.jobTitle || '').trim(),
    company: (opts.company || '').trim(),
    phone: (opts.phone || '').trim(),
    website: (opts.website || '').trim(),
    address: (opts.address || '').trim(),
    closing: signatureClosingText(opts.language),
  }
}

function cleanupAfterRender(html: string): string {
  let out = html.replace(
    /(?:^|<br\s*\/?>|<\/p>\s*<p[^>]*>)\s*(?:T|E|W|M|Tel\.?|Phone|Email|Web|Mobile|Fax)\s*[:：]\s*(?:&nbsp;|\s)*(?=(?:<br\s*\/?>|<\/p>|<\/div>|<\/td>|$))/gi,
    '',
  )
  out = out.replace(
    /(?:<br\s*\/?>\s*)+(?:T|E|W|M|Tel\.?|Phone|Email|Web|Mobile)\s*[:：]\s*(?=(?:<br\s*\/?>|<\/p>|<\/div>|<\/td>|$))/gi,
    '',
  )
  out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
  out = out.replace(/(<p[^>]*>)\s*(?:<br\s*\/?>\s*)+/gi, '$1')
  out = out.replace(/(?:<br\s*\/?>\s*)+(<\/p>)/gi, '$1')
  return out.trim()
}

/** Substitute ``{{placeholders}}`` the same way the API does at send time. */
export function renderSignatureTemplate(
  templateHtml: string,
  vars: SignatureIdentityVars | Record<string, string>,
): string {
  const raw = (templateHtml || '').trim()
  if (!raw) return ''
  const isIdentity = 'jobTitle' in vars || 'avatarUrl' in vars || 'language' in vars
  const identity = isIdentity ? (vars as SignatureIdentityVars) : null
  const map = identity ? signatureIdentityMap(identity) : (vars as Record<string, string>)
  const rendered = raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const canonical = PLACEHOLDER_ALIASES[key.toLowerCase()] ?? key.toLowerCase()
    if (canonical === 'avatar') {
      return avatarPlaceholderHtml(identity?.avatarUrl, map.name || '')
    }
    const value = map[canonical] ?? map[key] ?? ''
    return escapeHtml(String(value))
  })
  return cleanupAfterRender(rendered)
}

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

function signatureDetailBits(vars: Record<string, string>): string {
  const display = vars.name
  const detailBits: string[] = [
    `<div style="font-weight:600;color:#111827;font-size:14px;line-height:1.35">${escapeHtml(display)}</div>`,
  ]
  if (vars.job_title) {
    detailBits.push(
      `<div style="color:#6b7280;font-size:13px;line-height:1.35;margin-top:2px">${escapeHtml(vars.job_title)}</div>`,
    )
  }
  if (vars.company) {
    detailBits.push(
      `<div style="color:#6b7280;font-size:13px;line-height:1.35;margin-top:1px">${escapeHtml(vars.company)}</div>`,
    )
  }
  const contactParts: string[] = []
  if (vars.email && vars.email.toLowerCase() !== display.toLowerCase()) {
    const addr = escapeHtml(vars.email)
    contactParts.push(`<a href="mailto:${addr}" style="color:#4b5563;text-decoration:none">${addr}</a>`)
  }
  if (vars.phone) {
    const phone = escapeHtml(vars.phone)
    contactParts.push(`<a href="tel:${phone}" style="color:#4b5563;text-decoration:none">${phone}</a>`)
  }
  if (vars.website) {
    const site = vars.website
    const href = /^https?:\/\//i.test(site) ? site : `https://${site}`
    contactParts.push(
      `<a href="${escapeHtml(href)}" style="color:#4b5563;text-decoration:none" ` +
        `target="_blank" rel="noopener noreferrer">${escapeHtml(site)}</a>`,
    )
  }
  if (vars.address) {
    contactParts.push(escapeHtml(vars.address))
  }
  if (contactParts.length) {
    detailBits.push(
      `<div style="margin-top:8px;font-size:12px;line-height:1.5;color:#4b5563">` +
        contactParts.join('<span style="color:#d1d5db"> · </span>') +
        `</div>`,
    )
  }
  return detailBits.join('')
}

/** Text-only default: closing + name / role / company / contacts (no avatar image). */
export function composeDefaultSignatureHtml(opts: SignatureIdentityVars): string {
  const vars = signatureIdentityMap(opts)
  const closing = signatureClosingText(opts.language)
  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
    `font-size:14px;line-height:1.45;color:#1f2937">` +
    `<p style="margin:0 0 14px 0">${escapeHtml(closing)},</p>` +
    `<div style="padding-left:14px;border-left:2px solid #e5e7eb">${signatureDetailBits(vars)}</div>` +
    `</div>`
  )
}

/**
 * Photo layout. Closing is plain text (edit it in the signature). ``{{avatar}}``
 * becomes the sender's photo, or an initials circle when there is no photo.
 */
export function composeAvatarSignatureTemplateHtml(language?: string | null): string {
  const closing = escapeHtml(signatureClosingText(language))
  return (
    `<p style="margin:0 0 14px 0">${closing},</p>` +
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse">` +
    `<tr>` +
    `<td style="vertical-align:top;padding:0 14px 0 0">{{avatar}}</td>` +
    `<td style="vertical-align:top;padding:0 0 0 14px;border-left:2px solid #e5e7eb">` +
    `<div style="font-weight:600;color:#111827;font-size:14px;line-height:1.35">{{name}}</div>` +
    `<div style="color:#6b7280;font-size:13px;line-height:1.35;margin-top:2px">{{function}}</div>` +
    `<div style="color:#6b7280;font-size:13px;line-height:1.35;margin-top:1px">{{company}}</div>` +
    `<div style="margin-top:8px;font-size:12px;line-height:1.5;color:#4b5563">{{email}}</div>` +
    `</td></tr></table>`
  )
}

/** Replace ``{{closing}}`` with the language phrase so the editor stores real words. */
export function withHardcodedClosing(html: string, language?: string | null): string {
  const phrase = escapeHtml(signatureClosingText(language))
  return (html || '').replace(/\{\{\s*closing\s*\}\}/gi, phrase)
}

const AVATAR_SLOT = /<img\b[^>]*\bdata-sig-avatar="1"[^>]*\/?>/gi

/** Visual editor: show the avatar mark instead of the raw ``{{avatar}}`` token. */
export function editorHtmlFromSignature(html: string, identity: SignatureIdentityVars): string {
  const mark = editorAvatarImgHtml(identity.avatarUrl, identity.name || identity.email || '')
  return withHardcodedClosing(html, identity.language).replace(/\{\{\s*avatar\s*\}\}/gi, mark)
}

/** Persist the avatar slot back as ``{{avatar}}`` so each sender gets their own. */
export function signatureHtmlFromEditor(html: string): string {
  return (html || '').replace(AVATAR_SLOT, '{{avatar}}')
}

/** Effective signature for UI preview: custom template rendered, else modern default. */
export function previewSignatureHtml(
  templateHtml: string | null | undefined,
  identity: SignatureIdentityVars,
): string {
  const custom = (templateHtml || '').trim()
  if (custom) return renderSignatureTemplate(custom, identity)
  return composeDefaultSignatureHtml(identity)
}

/** Preview matching server resolve for human sends from a mailbox. */
export function previewOutboundSignatureHtml(opts: {
  source: 'mailbox' | 'sender'
  mailboxHtml: string | null | undefined
  personalHtml: string | null | undefined
  identity: SignatureIdentityVars
}): string {
  if (opts.source === 'mailbox') {
    const mailbox = (opts.mailboxHtml || '').trim()
    if (mailbox) return renderSignatureTemplate(mailbox, opts.identity)
  }
  return previewSignatureHtml(opts.personalHtml, opts.identity)
}
