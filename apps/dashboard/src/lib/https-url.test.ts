import { describe, expect, it } from 'vitest'
import { isFetchableFileUrl, isHttpsUrl } from './https-url'

describe('isHttpsUrl', () => {
  it('accepts https endpoints', () => {
    expect(isHttpsUrl('https://example.com/bokito-webhook')).toBe(true)
  })

  it('rejects plain http and junk', () => {
    expect(isHttpsUrl('http://example.com/hook')).toBe(false)
    expect(isHttpsUrl('not-a-url')).toBe(false)
    expect(isHttpsUrl('')).toBe(false)
  })

  it('allows localhost http when asked', () => {
    expect(isHttpsUrl('http://localhost:8787/hook', { allowLocalHttp: true })).toBe(true)
    expect(isHttpsUrl('http://127.0.0.1:3000/hook', { allowLocalHttp: true })).toBe(true)
    expect(isHttpsUrl('http://example.com/hook', { allowLocalHttp: true })).toBe(false)
  })
})

describe('isFetchableFileUrl', () => {
  it('accepts https and same-origin uploads', () => {
    expect(isFetchableFileUrl('https://files.example.com/a.pdf')).toBe(true)
    expect(isFetchableFileUrl('/api/uploads/refunds.md')).toBe(true)
  })

  it('rejects empty or relative junk', () => {
    expect(isFetchableFileUrl('/api/uploads/')).toBe(false)
    expect(isFetchableFileUrl('refunds.md')).toBe(false)
  })
})
