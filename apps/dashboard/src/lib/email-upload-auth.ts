/**
 * Inline images in synced mail (CID attachments, signature logos) are stored
 * behind the auth-gated `/api/uploads/files/{tenant}/{file}` route. The email
 * iframe loads them as plain `<img>` subresources — no Authorization header —
 * so the access token rides along as a query parameter, which the server
 * accepts (`access_token`). Only our own upload URLs are rewritten; the token
 * never lands on a foreign host.
 */

const UPLOAD_PATH = '/api/uploads/files/'

const QUOTED_ATTR_RE =
  /(src|background|href)(\s*=\s*)(["'])((?:https?:\/\/[^"']*)?\/api\/uploads\/files\/[^"']+)\3/gi

/** Absolute URLs must point at our own origin — a crafted mail must never
 * receive the viewer's token on a foreign host. */
function isOwnHost(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true
  if (typeof window === 'undefined') return false
  try {
    return new URL(url).host === window.location.host
  } catch {
    return false
  }
}

export function authorizeUploadUrls(html: string, token: string | null | undefined): string {
  if (!html || !token || !html.includes(UPLOAD_PATH)) return html
  return html.replace(QUOTED_ATTR_RE, (full, attr: string, eq: string, quote: string, url: string) => {
    if (!isOwnHost(url)) return full
    if (/[?&](access_token|session_token)=/.test(url)) return full
    const sep = url.includes('?') ? '&' : '?'
    return `${attr}${eq}${quote}${url}${sep}access_token=${encodeURIComponent(token)}${quote}`
  })
}
