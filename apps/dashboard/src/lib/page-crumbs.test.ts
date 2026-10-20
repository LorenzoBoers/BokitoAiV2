import { describe, expect, it } from 'vitest'
import { extraCrumbsForPath } from './page-crumbs'

describe('extra crumbs', () => {
  it('adds a readable subsection on nested pages', () => {
    expect(extraCrumbsForPath('/communication/today')).toEqual([{ labelKey: 'tabs.overview.title' }])
    expect(extraCrumbsForPath('/agents/knowledge')).toEqual([{ labelKey: 'tabs.knowledge.title' }])
    expect(extraCrumbsForPath('/workforce/grid')).toEqual([{ labelKey: 'tabs.grid.title' }])
    expect(extraCrumbsForPath('/contacts/abc')).toEqual([{ labelKey: 'crumbs.person' }])
    expect(extraCrumbsForPath('/contacts/companies/acme')).toEqual([{ labelKey: 'crumbs.company' }])
    expect(extraCrumbsForPath('/agents/lead-1')).toEqual([{ labelKey: 'crumbs.agent' }])
    expect(extraCrumbsForPath('/communication/inbox/all')).toEqual([])
    expect(extraCrumbsForPath('/communication/inbox/for_you/t/s1')).toEqual([{ labelKey: 'crumbs.forYou' }])
    expect(extraCrumbsForPath('/communication/team/tm-1/open')).toEqual([{ labelKey: 'crumbs.team' }])
    expect(extraCrumbsForPath('/settings/channels/abc')).toEqual([{ labelKey: 'crumbs.channel' }])
    expect(extraCrumbsForPath('/ai/assistant/external/installation')).toEqual([
      { labelKey: 'crumbs.widgetInstall' },
    ])
    expect(extraCrumbsForPath('/connections')).toEqual([])
    expect(extraCrumbsForPath('/connections/accounting')).toEqual([{ labelKey: 'crumbs.moduleSetup' }])
    expect(extraCrumbsForPath('/knowledge/doc-1')).toEqual([{ labelKey: 'crumbs.document' }])
    expect(extraCrumbsForPath('/knowledge')).toEqual([])
    expect(extraCrumbsForPath('/settings/assistant')).toEqual([])
    expect(extraCrumbsForPath('/learn/channels')).toEqual([{ labelKey: 'crumbs.learn' }])
    expect(extraCrumbsForPath('/docs/autonomy')).toEqual([{ labelKey: 'crumbs.docs' }])
    expect(extraCrumbsForPath('/settings/bin')).toEqual([{ labelKey: 'crumbs.bin' }])
  })
})
