import { describe, expect, it } from 'vitest'
import {
  normalizeMessengerAppearance,
  resolveWidgetName,
  welcomeDefaultsForLocale,
} from './messenger-appearance'

describe('normalizeMessengerAppearance brand icon', () => {
  it('inherits the branding pictogram when the widget has no override', () => {
    const appearance = normalizeMessengerAppearance(
      { appearance: { main_color: '#112233' } },
      { brandIconFallback: 'https://cdn.example/fav.png' },
    )
    expect(appearance.widget_favicon_url).toBe('https://cdn.example/fav.png')
  })

  it('keeps an explicit widget pictogram over branding', () => {
    const appearance = normalizeMessengerAppearance(
      { appearance: { widget_favicon_url: 'https://cdn.example/widget.png' } },
      { brandIconFallback: 'https://cdn.example/fav.png' },
    )
    expect(appearance.widget_favicon_url).toBe('https://cdn.example/widget.png')
  })
})

describe('resolveWidgetName', () => {
  it('prefers the explicit widget override', () => {
    expect(
      resolveWidgetName({ chatbotName: 'Support', assistantName: 'Bo', tenantName: 'Acme' }),
    ).toBe('Support')
  })

  it('falls back to a customized assistant name, then the tenant name', () => {
    expect(resolveWidgetName({ assistantName: 'Bo', tenantName: 'Acme' })).toBe('Bo')
    expect(resolveWidgetName({ tenantName: 'Acme' })).toBe('Acme')
  })

  it('skips the generic bootstrap assistant name', () => {
    expect(resolveWidgetName({ assistantName: 'Assistant', tenantName: 'Acme' })).toBe('Acme')
    expect(resolveWidgetName({ chatbotName: 'Assistent', tenantName: 'Acme' })).toBe('Acme')
  })
})

describe('welcomeDefaultsForLocale', () => {
  it('returns Dutch defaults for nl locales', () => {
    expect(welcomeDefaultsForLocale('nl')).toEqual({
      title: 'Welkom',
      subtitle: 'Hoe kunnen we je helpen?',
    })
    expect(welcomeDefaultsForLocale('nl-NL').title).toBe('Welkom')
  })

  it('returns English defaults otherwise', () => {
    expect(welcomeDefaultsForLocale('en')).toEqual({
      title: 'Welcome',
      subtitle: 'How can we help?',
    })
    expect(welcomeDefaultsForLocale('de').title).toBe('Welcome')
    expect(welcomeDefaultsForLocale(null).title).toBe('Welcome')
  })
})
