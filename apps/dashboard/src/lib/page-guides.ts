export const PAGE_GUIDE_SLUGS = [
  'cockpit',
  'communication',
  'contacts',
  'agenda',
  'team',
  'cases',
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
  team: '/team',
  cases: '/settings/signals',
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
    { to: '/activity', labelKey: 'pageGuides.related.activity' },
  ],
  contacts: [
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
    { to: '/ai/assistant/external/installation', labelKey: 'pageGuides.related.widget' },
  ],
  agenda: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/projects', labelKey: 'pageGuides.related.projects' },
    { to: '/activity', labelKey: 'pageGuides.related.activity' },
  ],
  team: [
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/settings/channels', labelKey: 'pageGuides.related.channels' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
  ],
  cases: [
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/workstreams', labelKey: 'pageGuides.related.workstreams' },
    { to: '/projects', labelKey: 'pageGuides.related.projects' },
  ],
  agents: [
    { to: '/settings/govern', labelKey: 'pageGuides.related.govern' },
    { to: '/knowledge', labelKey: 'pageGuides.related.knowledge' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
  ],
  projects: [
    { to: '/workstreams', labelKey: 'pageGuides.related.workstreams' },
    { to: '/settings/signals', labelKey: 'pageGuides.related.cases' },
    { to: '/communication/inbox/open', labelKey: 'pageGuides.related.communication' },
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
  ],
  knowledge: [
    { to: '/agents', labelKey: 'pageGuides.related.agents' },
    { to: '/activity', labelKey: 'pageGuides.related.activity' },
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

