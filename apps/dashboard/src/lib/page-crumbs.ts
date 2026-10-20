/** Extra breadcrumb segments after the top-level rail tab. */

export type PageCrumb = {
  labelKey: string
}

export function extraCrumbsForPath(pathname: string): PageCrumb[] {
  if (pathname.startsWith('/communication/today')) return [{ labelKey: 'tabs.overview.title' }]
  if (pathname.startsWith('/agents/knowledge')) return [{ labelKey: 'tabs.knowledge.title' }]
  if (pathname.startsWith('/workforce/grid')) return [{ labelKey: 'tabs.grid.title' }]
  if (pathname.startsWith('/workforce/workflow')) return [{ labelKey: 'tabs.workflow.title' }]
  if (pathname.startsWith('/contacts/companies/')) return [{ labelKey: 'crumbs.company' }]
  if (/^\/contacts\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.person' }]
  if (/^\/agents\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.agent' }]
  if (/^\/(?:folders|projects)\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.folder' }]
  if (/^\/knowledge\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.document' }]
  if (pathname.startsWith('/knowledge')) return []
  if (pathname === '/new' || pathname.startsWith('/new/') || pathname.startsWith('/communication/new'))
    return []
  if (pathname.startsWith('/communication/inbox/for_you')) return [{ labelKey: 'crumbs.forYou' }]
  if (pathname.startsWith('/communication/team/')) return [{ labelKey: 'crumbs.team' }]
  if (/^\/settings\/channels\/[^/]+/.test(pathname)) return [{ labelKey: 'crumbs.channel' }]
  if (pathname.startsWith('/ai/assistant') && pathname.includes('/installation')) {
    return [{ labelKey: 'crumbs.widgetInstall' }]
  }
  if (pathname.startsWith('/ai/assistant') && pathname.includes('/agent')) {
    return [{ labelKey: 'crumbs.widgetVoice' }]
  }
  if (pathname.startsWith('/ai/assistant') && pathname.includes('/customization')) {
    return [{ labelKey: 'crumbs.widgetLook' }]
  }
  if (pathname.startsWith('/connections/') && pathname !== '/connections') {
    return [{ labelKey: 'crumbs.moduleSetup' }]
  }
  if (pathname.startsWith('/connections')) return []
  if (pathname.startsWith('/learn')) return [{ labelKey: 'crumbs.learn' }]
  if (pathname.startsWith('/docs')) return [{ labelKey: 'crumbs.docs' }]
  if (pathname.startsWith('/settings/bin')) return [{ labelKey: 'crumbs.bin' }]
  return []
}
