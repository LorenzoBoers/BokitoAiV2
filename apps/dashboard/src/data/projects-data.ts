export type ProjectStatus = 'actief' | 'afgerond' | 'in_review' | 'on_hold' | 'concept'

export type ProjectPriority = 'hoog' | 'middel' | 'laag'

export interface ProjectMember {
  initials: string
  color: string
  name: string
}

export interface ProjectTask {
  id: string
  label: string
  done: boolean
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  priority: ProjectPriority
  progress: number       // 0-100
  deadline: string       // ISO date
  createdAt: string      // ISO date
  members: ProjectMember[]
  tasks: ProjectTask[]
  tags: string[]
  client?: string
}

export interface DocItem {
  id: string
  tenantSlug: string
  name: string
  url: string
  lastSyncedAt: string
  activeForAgents: boolean
}

export interface DocPageItem {
  id: string
  docId: string
  url: string
  title: string
}

export interface DocSectionItem {
  id: string
  pageId: string
  heading: string
  excerpt: string
}

export interface TenantDocSeed {
  docs: DocItem[]
  pages: DocPageItem[]
  sections: DocSectionItem[]
}

export const PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'AI Klantenservice Implementatie',
    description:
      'Volledige uitrol van Bokito cloud agent voor de klantenservice-afdeling, inclusief training en integratie met Zendesk.',
    status: 'actief',
    priority: 'hoog',
    progress: 68,
    deadline: '2026-04-15',
    createdAt: '2026-01-10',
    client: 'RetailChain NL',
    tags: ['AI', 'Klantenservice', 'Zendesk'],
    members: [
      { initials: 'LB', color: '#00FF99', name: 'Lorenzo B.' },
      { initials: 'SM', color: '#60A5FA', name: 'Sara M.' },
      { initials: 'TK', color: '#F59E0B', name: 'Tim K.' },
    ],
    tasks: [
      { id: 't1', label: 'Agent configureren', done: true },
      { id: 't2', label: 'Zendesk koppeling inrichten', done: true },
      { id: 't3', label: 'Trainingsdata uploaden', done: true },
      { id: 't4', label: 'Acceptatietesten', done: false },
      { id: 't5', label: 'Go-live voorbereiding', done: false },
    ],
  },
  {
    id: 'p2',
    name: 'Sales Automation Pipeline',
    description:
      'Automatiseer leadkwalificatie en follow-up via Bokito workflows gekoppeld aan Salesforce en e-mailcampagnes.',
    status: 'actief',
    priority: 'hoog',
    progress: 42,
    deadline: '2026-05-01',
    createdAt: '2026-02-03',
    client: 'TechVentures B.V.',
    tags: ['Salesforce', 'Automatie', 'Sales'],
    members: [
      { initials: 'LB', color: '#00FF99', name: 'Lorenzo B.' },
      { initials: 'AV', color: '#C084FC', name: 'Anna V.' },
    ],
    tasks: [
      { id: 't1', label: 'Workflow mapping', done: true },
      { id: 't2', label: 'Salesforce OAuth koppelen', done: true },
      { id: 't3', label: 'E-mailsequenties instellen', done: false },
      { id: 't4', label: 'Testrun met 50 leads', done: false },
      { id: 't5', label: 'Rapportage dashboard', done: false },
    ],
  },
  {
    id: 'p3',
    name: 'Interne Kennisbank Opbouw',
    description:
      'Structureren en uploaden van bedrijfsdocumentatie als trainingsmateriaal voor de Bokito assistent.',
    status: 'in_review',
    priority: 'middel',
    progress: 85,
    deadline: '2026-03-28',
    createdAt: '2026-01-22',
    tags: ['Kennisbank', 'Documentatie', 'Intern'],
    members: [
      { initials: 'SM', color: '#60A5FA', name: 'Sara M.' },
      { initials: 'JD', color: '#34D399', name: 'Jasper D.' },
    ],
    tasks: [
      { id: 't1', label: 'Documenten inventariseren', done: true },
      { id: 't2', label: 'Format standaardiseren', done: true },
      { id: 't3', label: 'Upload batch 1 (HR)', done: true },
      { id: 't4', label: 'Upload batch 2 (Finance)', done: true },
      { id: 't5', label: 'Kwaliteitscheck', done: false },
    ],
  },
  {
    id: 'p4',
    name: 'WhatsApp Business Integratie',
    description:
      'Koppeling van Bokito webchat met het WhatsApp Business platform voor omnichannel klantencontact.',
    status: 'actief',
    priority: 'hoog',
    progress: 30,
    deadline: '2026-06-01',
    createdAt: '2026-03-01',
    client: 'Logistics Group EU',
    tags: ['WhatsApp', 'Integratie', 'Omnichannel'],
    members: [
      { initials: 'TK', color: '#F59E0B', name: 'Tim K.' },
      { initials: 'LB', color: '#00FF99', name: 'Lorenzo B.' },
      { initials: 'MR', color: '#FB7185', name: 'Mia R.' },
    ],
    tasks: [
      { id: 't1', label: 'WhatsApp Business API aanvragen', done: true },
      { id: 't2', label: 'Webhook configureren', done: false },
      { id: 't3', label: 'Routing logica definiëren', done: false },
      { id: 't4', label: 'Templates aanmaken', done: false },
    ],
  },
  {
    id: 'p5',
    name: 'Dashboard Fase 2 — Analytics',
    description:
      'Uitbreiding van het Bokito dashboard met geavanceerde analytics, gebruiksrapporten en kostenoverzichten.',
    status: 'concept',
    priority: 'middel',
    progress: 10,
    deadline: '2026-07-15',
    createdAt: '2026-03-10',
    tags: ['Dashboard', 'Analytics', 'Intern'],
    members: [
      { initials: 'LB', color: '#00FF99', name: 'Lorenzo B.' },
    ],
    tasks: [
      { id: 't1', label: 'Requirements opstellen', done: true },
      { id: 't2', label: 'Wireframes maken', done: false },
      { id: 't3', label: 'Backend metrics API', done: false },
      { id: 't4', label: 'Frontend componenten', done: false },
    ],
  },
  {
    id: 'p6',
    name: 'HR Onboarding Automatisering',
    description:
      'Automatisch onboarding-traject voor nieuwe medewerkers via Bokito agent gekoppeld aan BambooHR en Notion.',
    status: 'on_hold',
    priority: 'laag',
    progress: 20,
    deadline: '2026-08-01',
    createdAt: '2026-02-14',
    client: 'Intern',
    tags: ['HR', 'Onboarding', 'BambooHR'],
    members: [
      { initials: 'AV', color: '#C084FC', name: 'Anna V.' },
      { initials: 'JD', color: '#34D399', name: 'Jasper D.' },
    ],
    tasks: [
      { id: 't1', label: 'Flowchart onboarding', done: true },
      { id: 't2', label: 'BambooHR koppeling', done: false },
      { id: 't3', label: 'Notion templates', done: false },
      { id: 't4', label: 'Testaanvraag indienen', done: false },
    ],
  },
  {
    id: 'p7',
    name: 'E-commerce Product Q&A Agent',
    description:
      'Slimme productvragen-agent voor Shopify-webshop die klanten helpt met productselectie en voorraadinfo.',
    status: 'afgerond',
    priority: 'middel',
    progress: 100,
    deadline: '2026-02-28',
    createdAt: '2025-12-01',
    client: 'ModeFabriek.nl',
    tags: ['Shopify', 'E-commerce', 'Agent'],
    members: [
      { initials: 'MR', color: '#FB7185', name: 'Mia R.' },
      { initials: 'TK', color: '#F59E0B', name: 'Tim K.' },
    ],
    tasks: [
      { id: 't1', label: 'Shopify product-feed koppelen', done: true },
      { id: 't2', label: 'Agent trainen op FAQ', done: true },
      { id: 't3', label: 'Webchat embedden', done: true },
      { id: 't4', label: 'A/B test uitvoeren', done: true },
      { id: 't5', label: 'Live gezet', done: true },
    ],
  },
  {
    id: 'p8',
    name: 'Meertalige Support Uitrol',
    description:
      'Uitbreiding van bestaande klantenservice-agent met Frans, Duits en Engels naast het Nederlands.',
    status: 'actief',
    priority: 'middel',
    progress: 55,
    deadline: '2026-04-30',
    createdAt: '2026-02-20',
    client: 'GlobalRetail N.V.',
    tags: ['Meertalig', 'NLP', 'Klantenservice'],
    members: [
      { initials: 'SM', color: '#60A5FA', name: 'Sara M.' },
      { initials: 'LB', color: '#00FF99', name: 'Lorenzo B.' },
    ],
    tasks: [
      { id: 't1', label: 'Engels training set', done: true },
      { id: 't2', label: 'Frans training set', done: true },
      { id: 't3', label: 'Duits training set', done: false },
      { id: 't4', label: 'Routing op taal instellen', done: false },
      { id: 't5', label: 'Taaldetectie testen', done: false },
    ],
  },
]

export const HARALD_DOC_SEED: TenantDocSeed = {
  docs: [
    {
      id: 'doc-harald-1',
      tenantSlug: 'harald',
      name: 'Harald Help Center',
      url: 'https://docs.harald.io',
      lastSyncedAt: '2026-03-30T14:12:00.000Z',
      activeForAgents: true,
    },
    {
      id: 'doc-harald-2',
      tenantSlug: 'harald',
      name: 'Harald Product Manual',
      url: 'https://manual.harald.io',
      lastSyncedAt: '2026-03-29T09:45:00.000Z',
      activeForAgents: true,
    },
    {
      id: 'doc-harald-3',
      tenantSlug: 'harald',
      name: 'Harald API Docs',
      url: 'https://developers.harald.io',
      lastSyncedAt: '2026-03-27T19:10:00.000Z',
      activeForAgents: true,
    },
  ],
  pages: [
    { id: 'page-h1-1', docId: 'doc-harald-1', title: 'Aan de slag', url: 'https://docs.harald.io/getting-started' },
    { id: 'page-h1-2', docId: 'doc-harald-1', title: 'FAQ', url: 'https://docs.harald.io/faq' },
    { id: 'page-h2-1', docId: 'doc-harald-2', title: 'Installatie', url: 'https://manual.harald.io/installatie' },
    { id: 'page-h2-2', docId: 'doc-harald-2', title: 'Onderhoud', url: 'https://manual.harald.io/onderhoud' },
    { id: 'page-h3-1', docId: 'doc-harald-3', title: 'Authenticatie', url: 'https://developers.harald.io/auth' },
    { id: 'page-h3-2', docId: 'doc-harald-3', title: 'Webhooks', url: 'https://developers.harald.io/webhooks' },
  ],
  sections: [
    { id: 'sec-h1-1', pageId: 'page-h1-1', heading: 'Eerste stappen', excerpt: 'Setup, account flow en basisconfiguratie.' },
    { id: 'sec-h1-2', pageId: 'page-h1-2', heading: 'Veelgestelde vragen', excerpt: 'Antwoorden op support en billing vragen.' },
    { id: 'sec-h2-1', pageId: 'page-h2-1', heading: 'Installatiechecklist', excerpt: 'Stappenplan voor een correcte installatie.' },
    { id: 'sec-h2-2', pageId: 'page-h2-2', heading: 'Periodiek onderhoud', excerpt: 'Aanbevolen onderhoudsschema en controles.' },
    { id: 'sec-h3-1', pageId: 'page-h3-1', heading: 'JWT authenticatie', excerpt: 'Token flow en security best practices.' },
    { id: 'sec-h3-2', pageId: 'page-h3-2', heading: 'Webhook retries', excerpt: 'Retry policy, signatures en events.' },
  ],
}
