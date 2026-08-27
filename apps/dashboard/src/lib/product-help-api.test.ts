import { describe, expect, it } from 'vitest'

import { docsRoutes } from '../api/routes'
import { helpLang, publicOpenApiUrl, PRODUCT_HELP_SECTIONS } from './product-help-api'

describe('product help routes', () => {
  it('builds same-origin docs paths', () => {
    expect(docsRoutes.index).toBe('/')
    expect(docsRoutes.article('channels')).toBe('/channels')
    expect(docsRoutes.article('how to')).toBe('/how%20to')
    expect(docsRoutes.articleMarkdown('channels')).toBe('/channels.md')
    expect(docsRoutes.search).toBe('/search')
    expect(docsRoutes.asset('communication/open-queue.png')).toBe('/assets/communication/open-queue.png')
    expect(docsRoutes.openapi).toBe('/openapi.json')
  })

  it('resolves the public OpenAPI schema on the docs base', () => {
    expect(publicOpenApiUrl()).toBe('/api/docs/openapi.json')
  })

  it('normalizes languages to en or nl', () => {
    expect(helpLang('en-US')).toBe('en')
    expect(helpLang('nl-NL')).toBe('nl')
    expect(helpLang('')).toBe('nl')
    expect(helpLang(undefined)).toBe('nl')
  })

  it('keeps the section order stable', () => {
    expect(PRODUCT_HELP_SECTIONS[0]).toBe('getting-started')
    expect(PRODUCT_HELP_SECTIONS).toContain('developers')
    expect(PRODUCT_HELP_SECTIONS).toHaveLength(6)
  })
})
