export const PAGE_GUIDE_SLUGS = [
  'cockpit',
  'communication',
  'contacts',
  'agenda',
  'agents',
  'projects',
  'knowledge',
  'govern',
  'channels',
  'integrations',
  'models',
  'widget',
  'autonomy',
] as const

export type PageGuideSlug = (typeof PAGE_GUIDE_SLUGS)[number]

export const PAGE_GUIDE_BACK: Record<PageGuideSlug, string> = {
  cockpit: '/cockpit',
  communication: '/communication/inbox/open',
  contacts: '/contacts',
  agenda: '/agenda',
  agents: '/agents',
  projects: '/projects',
  knowledge: '/knowledge',
  govern: '/settings/govern',
  channels: '/settings/channels',
  integrations: '/connections',
  models: '/settings/models',
  widget: '/ai/assistant/external/installation',
  autonomy: '/settings/govern',
}

/** Quick links shown at the bottom of each learn article to connect related areas. */
export const PAGE_GUIDE_RELATED: Record<PageGuideSlug, { to: string; labelKey: string }[]> = {
  cockpit: [
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
    { to: '/settings/setup', labelKey: 'pageGuides.related.setup' },
  ],
  communication: [
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
    { to: '/settings/communication', labelKey: 'pageGuides.related.inboxAi' },
    { to: '/ai/assistant/external/installation', labelKey: 'pageGuides.related.widget' },
    { to: '/contacts', labelKey: 'pageGuides.related.contacts' },
    { to: '/communication/runs/all', labelKey: 'pageGuides.related.agentRuns' },
  ],
  contacts: [
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
    { to: '/ai/assistant/external/installation', labelKey: 'pageGuides.related.widget' },
  ],
  agenda: [
    { to: '/agenda?view=automations', labelKey: 'pageGuides.related.automations' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/projects', labelKey: 'pageGuides.related.projects' },
    { to: '/communication/runs/all', labelKey: 'pageGuides.related.agentRuns' },
  ],
  agents: [
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
    { to: '/knowledge', labelKey: 'pageGuides.related.knowledge' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
  ],
  projects: [
    { to: '/agenda', labelKey: 'pageGuides.related.agenda' },
    { to: '/agenda?view=automations', labelKey: 'pageGuides.related.automations' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/knowledge', labelKey: 'pageGuides.related.knowledge' },
  ],
  knowledge: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/communication/runs/all', labelKey: 'pageGuides.related.agentRuns' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/settings/setup', labelKey: 'pageGuides.related.setup' },
  ],
  govern: [
    { to: '/learn/autonomy', labelKey: 'pageGuides.related.autonomy' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/settings/developers', labelKey: 'pageGuides.related.developers' },
  ],
  channels: [
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/ai/assistant/external/installation', labelKey: 'pageGuides.related.widget' },
    { to: '/connections/marketplace', labelKey: 'pageGuides.related.integrations' },
  ],
  integrations: [
    { to: '/connections/marketplace', labelKey: 'pageGuides.related.integrations' },
    { to: '/settings/models', labelKey: 'pageGuides.related.models' },
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
  ],
  models: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
    { to: '/cockpit/usage', labelKey: 'pageGuides.related.usage' },
  ],
  widget: [
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/knowledge', labelKey: 'pageGuides.related.knowledge' },
  ],
  autonomy: [
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
  ],
}

const DISMISS_PREFIX = 'bokito-page-guide-dismissed:'

export function pageGuidePath(slug: PageGuideSlug): string {
  return `/learn/${slug}`
}

/** Public docs URL. Pass the article `path` (`{section}/{slug}`) when known. */
export function publicDocsPath(path?: string): string {
  return path ? `/docs/${path}` : '/docs'
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
