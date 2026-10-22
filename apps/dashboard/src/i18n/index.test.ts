import { describe, expect, it } from 'vitest'
import i18n, { ensureLanguage } from './index'

describe('lazy locale loading', () => {
  it('loads the active language on demand and translates', async () => {
    await ensureLanguage('nl')
    expect(i18n.t('errorBoundary.title', { ns: 'nav' })).toBe('Er ging iets mis')
    expect(i18n.hasResourceBundle('nl', 'common')).toBe(true)
  })

  it('switches language and loads its strings', async () => {
    await ensureLanguage('en')
    expect(i18n.t('errorBoundary.title', { ns: 'nav' })).toBe('Something went wrong')
    await ensureLanguage('nl')
  })
})
