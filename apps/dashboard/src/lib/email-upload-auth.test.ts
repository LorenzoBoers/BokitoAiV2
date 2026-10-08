import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeUploadUrls } from './email-upload-auth'

afterEach(() => vi.unstubAllGlobals())

const TOKEN = 'eyJ.test.token'

describe('authorizeUploadUrls', () => {
  it('appends the access token to relative upload URLs', () => {
    const html = '<img src="/api/uploads/files/11111111-2222-3333-4444-555555555555/sig_logo.png">'
    const out = authorizeUploadUrls(html, TOKEN)
    expect(out).toContain(
      `src="/api/uploads/files/11111111-2222-3333-4444-555555555555/sig_logo.png?access_token=${encodeURIComponent(TOKEN)}"`,
    )
  })

  it('appends to absolute URLs on our own host only', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'app.bokito.ai' } })
    const out = authorizeUploadUrls(
      '<img src="https://app.bokito.ai/api/uploads/files/t/x.png">',
      TOKEN,
    )
    expect(out).toContain(`x.png?access_token=${encodeURIComponent(TOKEN)}`)
  })

  it('never appends the token to an upload-like path on a foreign host', () => {
    const html = '<img src="https://evil.example/api/uploads/files/t/x.png">'
    expect(authorizeUploadUrls(html, TOKEN)).toBe(html)
  })

  it('uses & when the URL already has a query string', () => {
    const html = '<img src="/api/uploads/files/t/x.png?v=2">'
    const out = authorizeUploadUrls(html, TOKEN)
    expect(out).toContain(`x.png?v=2&access_token=${encodeURIComponent(TOKEN)}`)
  })

  it('leaves URLs that already carry a token untouched', () => {
    const html = '<img src="/api/uploads/files/t/x.png?access_token=abc">'
    expect(authorizeUploadUrls(html, TOKEN)).toBe(html)
  })

  it('never touches foreign hosts or non-upload paths', () => {
    const html =
      '<img src="https://evil.example/api/not-uploads/x.png"><a href="https://example.com/page">link</a>'
    expect(authorizeUploadUrls(html, TOKEN)).toBe(html)
  })

  it('is a no-op without a token', () => {
    const html = '<img src="/api/uploads/files/t/x.png">'
    expect(authorizeUploadUrls(html, null)).toBe(html)
  })
})
