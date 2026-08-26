import { describe, expect, it } from 'vitest'

import { isDocsAssetSrc, parseImageLine, parseItalicCaption } from './docs-images'

describe('docs image allowlist', () => {
  it('accepts same-origin product-help assets', () => {
    expect(isDocsAssetSrc('/api/docs/assets/communication/open-queue.png')).toBe(true)
    expect(isDocsAssetSrc('/api/docs/assets/cockpit/overview.webp')).toBe(true)
  })

  it('rejects remote, escape, and non-image paths', () => {
    expect(isDocsAssetSrc('https://example.com/x.png')).toBe(false)
    expect(isDocsAssetSrc('/api/docs/assets/../secret.png')).toBe(false)
    expect(isDocsAssetSrc('/api/docs/assets/communication/open-queue.jpg')).toBe(false)
    expect(isDocsAssetSrc('/api/docs/cockpit')).toBe(false)
  })

  it('parses a markdown image and italic caption', () => {
    expect(parseImageLine('![Open queue](/api/docs/assets/communication/open-queue.png)')).toEqual({
      alt: 'Open queue',
      src: '/api/docs/assets/communication/open-queue.png',
    })
    expect(parseItalicCaption('*The Open queue.*')).toBe('The Open queue.')
    expect(parseItalicCaption('_The Open queue._')).toBe('The Open queue.')
    expect(parseItalicCaption('plain')).toBeNull()
  })
})
