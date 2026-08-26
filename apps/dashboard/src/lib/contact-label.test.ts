import { describe, expect, it } from 'vitest'
import {
  humanizeContactName,
  isGenericVisitorName,
  isOpaqueWidgetAddress,
  isPlaceholderContactAddress,
} from './contact-label'

describe('isOpaqueWidgetAddress', () => {
  it('flags live-chat visitor ids', () => {
    expect(isOpaqueWidgetAddress('cust_ed5ab564a4e99baf')).toBe(true)
    expect(isOpaqueWidgetAddress('sanne@klant.nl')).toBe(false)
    expect(isOpaqueWidgetAddress('')).toBe(false)
  })
})

describe('isPlaceholderContactAddress', () => {
  it('flags leftover widget placeholders', () => {
    expect(isPlaceholderContactAddress('visitor@web')).toBe(true)
    expect(isPlaceholderContactAddress('visitor@widget')).toBe(true)
    expect(isPlaceholderContactAddress('cust_abc')).toBe(true)
    expect(isPlaceholderContactAddress('sanne@klant.nl')).toBe(false)
  })
})

describe('humanizeContactName', () => {
  it('keeps a real person name', () => {
    expect(humanizeContactName('Sanne de Vries', 'sanne@klant.nl', 'Websitebezoeker')).toBe(
      'Sanne de Vries',
    )
  })

  it('maps English widget labels to the local visitor term', () => {
    expect(isGenericVisitorName('Website visitor')).toBe(true)
    expect(humanizeContactName('Website visitor', 'cust_abc', 'Websitebezoeker')).toBe(
      'Websitebezoeker',
    )
    expect(humanizeContactName('', 'visitor@web', 'Websitebezoeker')).toBe('Websitebezoeker')
  })
})
