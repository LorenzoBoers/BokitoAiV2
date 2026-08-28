/** Extra breadcrumb segments after the top-level rail tab. */

export type PageCrumb = {
  labelKey: string
}

export function extraCrumbsForPath(pathname: string): PageCrumb[] {
  if (pathname.startsWith('/cockpit/activity')) return [{ labelKey: 'cockpitTabs.activity' }]
  if (pathname.startsWith('/cockpit/usage')) return [{ labelKey: 'cockpitTabs.usage' }]
  if (pathname.startsWith('/contacts/companies/')) return [{ labelKey: 'crumbs.company' }]
  if (/^\/contacts\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.person' }]
  if (/^\/agents\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.agent' }]
  if (/^\/projects\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.project' }]
  if (/^\/knowledge\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.document' }]
  if (pathname.startsWith('/communication/new')) return [{ labelKey: 'crumbs.newConversation' }]
  if (pathname.includes('/awaiting-decision')) return [{ labelKey: 'crumbs.decisions' }]
  if (pathname.startsWith('/ai/assistant') && pathname.includes('/installation')) {
    return [{ labelKey: 'crumbs.widgetInstall' }]
  }
  if (pathname.startsWith('/ai/assistant') && pathname.includes('/agent')) {
    return [{ labelKey: 'crumbs.widgetVoice' }]
  }
  if (pathname.startsWith('/ai/assistant') && pathname.includes('/customization')) {
    return [{ labelKey: 'crumbs.widgetLook' }]
  }
  if (pathname.startsWith('/settings/marketplace')) return [{ labelKey: 'crumbs.marketplace' }]
  if (pathname.startsWith('/settings/modules')) return []
  if (pathname.startsWith('/settings/mcp')) return [{ labelKey: 'crumbs.connectedTools' }]
  if (pathname.startsWith('/learn')) return [{ labelKey: 'crumbs.learn' }]
  if (pathname.startsWith('/docs')) return [{ labelKey: 'crumbs.docs' }]
  return []
}
