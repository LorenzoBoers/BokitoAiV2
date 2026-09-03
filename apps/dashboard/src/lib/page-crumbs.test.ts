import { describe, expect, it } from 'vitest'
import { extraCrumbsForPath } from './page-crumbs'

describe('extra crumbs', () => {
  it('adds a readable subsection on nested pages', () => {
    expect(extraCrumbsForPath('/cockpit/usage')).toEqual([{ labelKey: 'cockpitTabs.usage' }])
    expect(extraCrumbsForPath('/contacts/abc')).toEqual([{ labelKey: 'crumbs.person' }])
    expect(extraCrumbsForPath('/contacts/companies/acme')).toEqual([{ labelKey: 'crumbs.company' }])
    expect(extraCrumbsForPath('/agents/lead-1')).toEqual([{ labelKey: 'crumbs.agent' }])
    expect(extraCrumbsForPath('/communication/inbox/all')).toEqual([])
    expect(extraCrumbsForPath('/communication/runs/awaiting-decision')).toEqual([
      { labelKey: 'crumbs.decisions' },
    ])
    expect(extraCrumbsForPath('/communication/decisions')).toEqual([
      { labelKey: 'crumbs.decisions' },
    ])
    expect(extraCrumbsForPath('/ai/assistant/external/installation')).toEqual([
      { labelKey: 'crumbs.widgetInstall' },
    ])
    expect(extraCrumbsForPath('/connections/marketplace')).toEqual([{ labelKey: 'crumbs.marketplace' }])
    expect(extraCrumbsForPath('/connections')).toEqual([])
    expect(extraCrumbsForPath('/connections/accounting')).toEqual([{ labelKey: 'crumbs.moduleSetup' }])
    expect(extraCrumbsForPath('/knowledge/doc-1')).toEqual([{ labelKey: 'crumbs.document' }])
    expect(extraCrumbsForPath('/knowledge')).toEqual([])
    expect(extraCrumbsForPath('/settings/assistant')).toEqual([])
    expect(extraCrumbsForPath('/learn/channels')).toEqual([{ labelKey: 'crumbs.learn' }])
    expect(extraCrumbsForPath('/docs/autonomy')).toEqual([{ labelKey: 'crumbs.docs' }])
  })
})
