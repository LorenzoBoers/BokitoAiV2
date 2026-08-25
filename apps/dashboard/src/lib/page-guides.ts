export const PAGE_GUIDE_SLUGS = [
  'cockpit',
  'communication',
  'contacts',
  'agenda',
  'agents',
  'projects',
  'knowledge',
  'govern',
] as const

export type PageGuideSlug = (typeof PAGE_GUIDE_SLUGS)[number]

export const PAGE_GUIDE_BACK: Record<PageGuideSlug, string> = {
  cockpit: '/cockpit',
  communication: '/communication/inbox/all',
  contacts: '/contacts',
  agenda: '/agenda',
  agents: '/agents',
  projects: '/projects',
  knowledge: '/knowledge',
  govern: '/settings/govern',
}

/** Quick links shown at the bottom of each learn article to connect related areas. */
export const PAGE_GUIDE_RELATED: Record<PageGuideSlug, { to: string; labelKey: string }[]> = {
  cockpit: [
    { to: '/communication/inbox/all', labelKey: 'pageGuides.related.communication' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/settings/setup', labelKey: 'pageGuides.related.setup' },
  ],
  communication: [
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
    { to: '/settings/communication', labelKey: 'pageGuides.related.inboxAi' },
    { to: '/contacts', labelKey: 'pageGuides.related.contacts' },
  ],
  contacts: [
    { to: '/communication/inbox/all', labelKey: 'pageGuides.related.communication' },
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
  ],
  agenda: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/projects', labelKey: 'pageGuides.related.projects' },
  ],
  agents: [
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
    { to: '/knowledge', labelKey: 'pageGuides.related.knowledge' },
    { to: '/communication/inbox/all', labelKey: 'pageGuides.related.communication' },
  ],
  projects: [
    { to: '/agenda', labelKey: 'pageGuides.related.agenda' },
    { to: '/communication/inbox/all', labelKey: 'pageGuides.related.communication' },
  ],
  knowledge: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/settings/setup', labelKey: 'pageGuides.related.setup' },
  ],
  govern: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/settings/developers', labelKey: 'pageGuides.related.developers' },
  ],
}

const DISMISS_PREFIX = 'bokito-page-guide-dismissed:'

export function pageGuidePath(slug: PageGuideSlug): string {
  return `/learn/${slug}`
}

export function isPageGuideSlug(value: string | undefined): value is PageGuideSlug {
  return Boolean(value && (PAGE_GUIDE_SLUGS as readonly string[]).includes(value))
}

export function pageGuideDismissKey(slug: PageGuideSlug): string {
  return `${DISMISS_PREFIX}${slug}`
}

export function isPageGuideDismissed(slug: PageGuideSlug): boolean {
  try {
    return localStorage.getItem(pageGuideDismissKey(slug)) === '1'
  } catch {
    return false
  }
}

export function dismissPageGuide(slug: PageGuideSlug): void {
  try {
    localStorage.setItem(pageGuideDismissKey(slug), '1')
  } catch {
    // ignore storage failures
  }
}
