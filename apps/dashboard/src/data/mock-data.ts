import type {
  StatCard,
  ActivityItem,
  QuickAction,
  Channel,
  Message,
  ChannelInfo,
  CloudAgent,
} from '../types'

export const stats: StatCard[] = [
  {
    label: 'Gesprekken',
    value: '1.284',
    change: '+12.5%',
    changeType: 'up',
    icon: 'message-square',
  },
  {
    label: 'Actieve gebruikers',
    value: '342',
    change: '+8.2%',
    changeType: 'up',
    icon: 'users',
  },
  {
    label: 'Gem. responstijd',
    value: '1.2s',
    change: '-15.3%',
    changeType: 'down',
    icon: 'zap',
  },
  {
    label: 'Tokens gebruikt',
    value: '2.4M',
    change: '+3.1%',
    changeType: 'neutral',
    icon: 'cpu',
  },
]

export const activities: ActivityItem[] = [
  {
    id: '1',
    user: 'Lorenzo B.',
    avatar: 'LB',
    action: 'heeft een nieuw gesprek gestart met',
    target: 'Bokito Support Agent',
    timestamp: '2 min geleden',
    type: 'message',
  },
  {
    id: '2',
    user: 'System',
    avatar: 'SY',
    action: 'Agent "Order Lookup" heeft tool uitgevoerd:',
    target: 'search_orders',
    timestamp: '5 min geleden',
    type: 'agent',
  },
  {
    id: '3',
    user: 'Diana T.',
    avatar: 'DT',
    action: 'heeft feedback gegeven op gesprek',
    target: '#1247',
    timestamp: '12 min geleden',
    type: 'user',
  },
  {
    id: '4',
    user: 'System',
    avatar: 'SY',
    action: 'Nieuwe organisatie aangemaakt:',
    target: 'ChargeCars BV',
    timestamp: '25 min geleden',
    type: 'system',
  },
  {
    id: '5',
    user: 'Andrew M.',
    avatar: 'AM',
    action: 'heeft agent configuratie bijgewerkt voor',
    target: 'Sales Assistant',
    timestamp: '1 uur geleden',
    type: 'agent',
  },
  {
    id: '6',
    user: 'Sophia W.',
    avatar: 'SW',
    action: 'heeft een bericht gestuurd in',
    target: '#front-end',
    timestamp: '1 uur geleden',
    type: 'message',
  },
  {
    id: '7',
    user: 'System',
    avatar: 'SY',
    action: 'Dagelijkse token usage limiet bereikt voor',
    target: 'Tenant: Demo Corp',
    timestamp: '2 uur geleden',
    type: 'system',
  },
]

export const quickActions: QuickAction[] = [
  {
    id: '1',
    label: 'Nieuw gesprek',
    description: 'Start een nieuw AI-gesprek',
    icon: 'message-square-plus',
  },
  {
    id: '2',
    label: 'Agent beheren',
    description: 'Configureer bot agents',
    icon: 'bot',
  },
  {
    id: '3',
    label: 'Analytics bekijken',
    description: 'Token gebruik & kosten',
    icon: 'bar-chart-3',
  },
  {
    id: '4',
    label: 'Organisatie instellen',
    description: 'Tenant configuratie',
    icon: 'building-2',
  },
]

export const favoriteChannels: Channel[] = [
  { id: 'fav-1', name: 'BTW / OB-aangiften', type: 'channel', unread: 4 },
  { id: 'fav-2', name: 'Jaarwerk 2025', type: 'channel', unread: 2 },
]

export const channels: Channel[] = [
  { id: 'ch-1', name: 'Inbox', type: 'channel', unread: 8 },
  { id: 'ch-2', name: 'Klantvragen', type: 'channel', unread: 5, isActive: true },
  { id: 'ch-3', name: 'Verzonden', type: 'channel', unread: 0 },
  { id: 'ch-4', name: 'Archief', type: 'channel', unread: 0 },
]

export const directMessages: Channel[] = [
  { id: 'dm-1', name: 'Bakkerij Goudkrust', type: 'dm', unread: 2 },
  { id: 'dm-2', name: 'Timmerbedrijf Vos', type: 'dm', unread: 1 },
  { id: 'dm-3', name: 'Bloemen van Soest', type: 'dm', unread: 0 },
]

export const messages: Message[] = [
  {
    id: 'm-1',
    user: 'Bakkerij Goudkrust',
    avatar: 'BG',
    fromEmail: 'jan@goudkrust.nl',
    accountName: 'Bakkerij Goudkrust',
    subject: 'Facturen Q1 nog niet verwerkt?',
    preview: 'Harold, ik heb vorige week de inkoopfacturen van januari t/m maart gemaild. Staan die al in de boekhouding?',
    body:
      'Hoi Harold,\n\nIk heb vorige week de inkoopfacturen van januari t/m maart gemaild (meel, boter en verpakkingsmateriaal). Staan die al in de boekhouding? We willen graag even weten hoe we ervoor staan qua BTW dit kwartaal.\n\nAlvast bedankt,\nJan Vermeer\nBakkerij Goudkrust',
    labels: [
      { name: 'Facturen', color: 'status-info' },
      { name: 'BTW', color: 'status-warning' },
    ],
    aiSuggestions: [
      {
        id: 'm1-ai-1',
        level: 'info',
        text: 'Ik heb 12 inkoopfacturen gevonden in de inbox van 18 maart. 9 zijn geboekt in King, 3 wachten op goedkeuring.',
        meta: 'Gekoppeld aan inkoopfacturen Q1 – Bakkerij Goudkrust',
      },
    ],
    unread: true,
    content:
      'Hoi Harold,\n\nIk heb vorige week de inkoopfacturen van januari t/m maart gemaild (meel, boter en verpakkingsmateriaal). Staan die al in de boekhouding? We willen graag even weten hoe we ervoor staan qua BTW dit kwartaal.\n\nAlvast bedankt,\nJan Vermeer\nBakkerij Goudkrust',
    timestamp: '09:12',
  },
  {
    id: 'm-2',
    user: 'Timmerbedrijf Vos',
    avatar: 'TV',
    fromEmail: 'mirjam@timmerbedrijfvos.nl',
    accountName: 'Timmerbedrijf Vos B.V.',
    subject: 'Verschil op bankafschrift – maart',
    preview: 'Sandra, op ons bankafschrift staat een afschrijving van €3.480 die ik niet kan plaatsen. Kunnen jullie meekijken?',
    body:
      'Hallo Sandra,\n\nOp het bankafschrift van maart staat een afschrijving van \u20AC3.480 die ik niet kan thuisbrengen. Het lijkt op een dubbele betaling aan de houtleverancier, maar ik weet het niet zeker.\n\nKunnen jullie meekijken en eventueel corrigeren in de boekhouding?\n\nGroetjes,\nMirjam Vos',
    labels: [
      { name: 'Boekhouding', color: 'status-info' },
      { name: 'Actie nodig', color: 'status-warning' },
    ],
    aiSuggestions: [
      {
        id: 'm2-ai-1',
        level: 'proposal',
        text: 'Conceptreactie: "Ik heb het bankafschrift erbij gepakt en zie inderdaad een dubbele betaling op 14 maart. Ik boek de correctie en neem contact op met de leverancier."',
        meta: 'Conceptreactie klaar voor verzending',
        actions: [
          { id: 'generate', label: 'Genereren' },
          { id: 'reply', label: 'Reageren' },
        ],
      },
    ],
    unread: true,
    content:
      'Hallo Sandra,\n\nOp het bankafschrift van maart staat een afschrijving van \u20AC3.480 die ik niet kan thuisbrengen. Het lijkt op een dubbele betaling aan de houtleverancier, maar ik weet het niet zeker.\n\nKunnen jullie meekijken en eventueel corrigeren in de boekhouding?\n\nGroetjes,\nMirjam Vos',
    timestamp: '08:41',
  },
  {
    id: 'm-3',
    user: 'Bloemen van Soest',
    avatar: 'BS',
    fromEmail: 'linda@bloemenvansoest.nl',
    accountName: 'Bloemen van Soest',
    subject: 'Jaarrekening 2025 – vraag over afschrijving',
    preview: 'Harold, bedankt voor het concept. Ik heb een vraag over de afschrijving op de koelwagen en de voorraadwaardering.',
    body:
      'Hoi Harold,\n\nBedankt voor het toesturen van de concept jaarrekening. Ik heb een paar vragen:\n\n\u2022 De afschrijving op de koelwagen \u2013 klopt het dat die in 4 jaar wordt afgeschreven? We hadden het over 5 jaar gehad.\n\u2022 De voorraadwaardering lijkt aan de lage kant. We hadden eind december nog een flinke partij tulpenbollen op voorraad.\n\nKunnen we even bellen deze week?\n\nGroetjes,\nLinda Bakker',
    labels: [
      { name: 'Jaarrekening', color: 'accent' },
      { name: 'Review', color: 'status-info' },
    ],
    unread: false,
    content:
      'Hoi Harold,\n\nBedankt voor het toesturen van de concept jaarrekening. Ik heb een paar vragen:\n\n\u2022 De afschrijving op de koelwagen \u2013 klopt het dat die in 4 jaar wordt afgeschreven? We hadden het over 5 jaar gehad.\n\u2022 De voorraadwaardering lijkt aan de lage kant. We hadden eind december nog een flinke partij tulpenbollen op voorraad.\n\nKunnen we even bellen deze week?\n\nGroetjes,\nLinda Bakker',
    timestamp: 'Gisteren',
  },
  {
    id: 'm-4',
    user: 'Sandra van Bourgondi\u00ebn',
    avatar: 'SB',
    fromEmail: 'sandra@bourgondienadvies.nl',
    accountName: 'VBA Intern',
    subject: 'Interne notitie: BTW-aangifte Goudkrust',
    preview: 'Harold, de BTW-aangifte Q1 van Goudkrust moet vrijdag ingediend zijn. Facturen staan klaar, alleen de creditnota mist nog.',
    body:
      'Harold,\n\nDe BTW-aangifte Q1 van Bakkerij Goudkrust moet uiterlijk vrijdag ingediend zijn bij de Belastingdienst. Ik heb alle facturen al verwerkt, maar er mist nog een creditnota van de meelleverancier (\u20AC420).\n\nKun jij Jan even bellen om die door te sturen?\n\nGroet,\nSandra',
    labels: [
      { name: 'Interne notitie', color: 'status-info' },
    ],
    unread: false,
    content:
      'Harold,\n\nDe BTW-aangifte Q1 van Bakkerij Goudkrust moet uiterlijk vrijdag ingediend zijn bij de Belastingdienst. Ik heb alle facturen al verwerkt, maar er mist nog een creditnota van de meelleverancier (\u20AC420).\n\nKun jij Jan even bellen om die door te sturen?\n\nGroet,\nSandra',
    timestamp: 'Gisteren',
  },
  {
    id: 'm-5',
    user: 'Belastingdienst',
    avatar: 'BD',
    fromEmail: 'noreply@belastingdienst.nl',
    accountName: 'Belastingdienst',
    subject: 'Herinnering: VPB-aangifte 2024 Timmerbedrijf Vos',
    preview: 'De aangifte vennootschapsbelasting 2024 voor Timmerbedrijf Vos B.V. is nog niet ontvangen. Uiterlijk 15 april indienen.',
    body:
      'Geachte heer Van Bourgondi\u00ebn,\n\nVolgens onze administratie is de aangifte vennootschapsbelasting 2024 voor Timmerbedrijf Vos B.V. (KvK: 56123498) nog niet ontvangen.\n\nWij verzoeken u deze uiterlijk 15 april 2026 in te dienen om een verzuimboete te voorkomen.\n\nMet vriendelijke groet,\nBelastingdienst',
    labels: [
      { name: 'Belastingdienst', color: 'status-error' },
      { name: 'Deadline', color: 'status-warning' },
    ],
    aiSuggestions: [
      {
        id: 'm5-ai-1',
        level: 'task',
        text: 'Ik heb een herinneringstaak gepland: VPB-aangifte Timmerbedrijf Vos indienen v\u00f3\u00f3r 15 april.',
        meta: 'Taak: VPB-aangifte Vos \u2013 deadline 15 april',
      },
    ],
    unread: true,
    content:
      'Geachte heer Van Bourgondi\u00ebn,\n\nVolgens onze administratie is de aangifte vennootschapsbelasting 2024 voor Timmerbedrijf Vos B.V. (KvK: 56123498) nog niet ontvangen.\n\nWij verzoeken u deze uiterlijk 15 april 2026 in te dienen om een verzuimboete te voorkomen.\n\nMet vriendelijke groet,\nBelastingdienst',
    timestamp: '15 min geleden',
    reactions: [{ emoji: '\uD83D\uDC4D', count: 1 }],
  },
]

export const channelInfo: ChannelInfo = {
  name: 'Klantvragen mailbox',
  creator: 'Harold van Bourgondi\u00ebn',
  createdAt: '02 Jan',
  status: 'Active',
  statusColor: 'accent',
  tags: 6,
  tasks: 4,
  linkedThreads: [
    { name: 'BTW Q1 – Goudkrust', category: 'Fiscale aangifte' },
    { name: 'Jaarrekening Bloemen van Soest', category: 'Jaarwerk' },
  ],
  threadActivity: [4, 6, 5, 8, 7, 6, 5, 9, 8, 7, 6, 8, 7, 6, 5, 7, 8, 7, 6, 5],
  members: [
    {
      id: 'mem-1',
      name: 'Harold van Bourgondi\u00ebn',
      role: 'Accountant / Eigenaar',
      roleColor: 'accent',
      avatar: 'HB',
      online: true,
    },
    {
      id: 'mem-2',
      name: 'Sandra van Bourgondi\u00ebn',
      role: 'Boekhouder / Eigenaar',
      roleColor: 'accent',
      avatar: 'SB',
      online: true,
    },
  ],
}

export const cloudAgents: CloudAgent[] = [
  {
    id: 'ca-1',
    name: 'Bokito Support',
    slug: 'bokito-support',
    description:
      'Eerste lijn voor klanten: FAQ, orders en retourflow. Gekoppeld aan Xano tools.',
    model: 'claude-sonnet-4-20250514',
    status: 'active',
    region: 'eu-west',
    lastDeployed: '2 uur geleden',
    requests24h: 1842,
    latencyP50: '890 ms',
    tools: ['search_orders', 'kb_lookup', 'create_ticket', 'handoff_human'],
    systemPromptPreview:
      'Je bent de officiële support-agent voor Bokito. Antwoord kort, in het Nederlands, en gebruik tools voor orderdata...',
    embedUrl: 'https://xrex-nmji-j9ur.f2.xano.io/api:livechat/script/main',
  },
  {
    id: 'ca-2',
    name: 'Sales Assistant',
    slug: 'sales-assistant',
    description: 'Kwalificeert leads en plant demo’s. Alleen voor ingelogde gebruikers.',
    model: 'claude-sonnet-4-20250514',
    status: 'active',
    region: 'eu-west',
    lastDeployed: 'gisteren',
    requests24h: 412,
    latencyP50: '1.1 s',
    tools: ['crm_lookup', 'schedule_meeting', 'pricing_sheet'],
    systemPromptPreview:
      'Je helpt prospects met productfit en pricing. Vraag altijd naar sector en teamgrootte voordat je een demo voorstelt...',
    embedUrl: 'https://xrex-nmji-j9ur.f2.xano.io/api:livechat/script/main',
  },
  {
    id: 'ca-3',
    name: 'Internal Ops',
    slug: 'internal-ops',
    description: 'Interne agent voor staff: dashboards, logs en tenantbeheer (JWT vereist).',
    model: 'claude-3-5-haiku-20241022',
    status: 'paused',
    region: 'eu-west',
    lastDeployed: '5 dagen geleden',
    requests24h: 0,
    latencyP50: '—',
    tools: ['tenant_summary', 'usage_report', 'flag_incident'],
    systemPromptPreview:
      'Je ondersteunt Bokito-medewerkers. Geen klantdata naar externe kanalen. Log gevoelige acties...',
    embedUrl: 'https://xrex-nmji-j9ur.f2.xano.io/api:livechat/script/main',
  },
  {
    id: 'ca-4',
    name: 'Website v3 — Draft',
    slug: 'website-v3-draft',
    description: 'Experimentele copy voor de nieuwe marketingpagina. Nog niet in productie.',
    model: 'claude-opus-4-20250514',
    status: 'deploying',
    region: 'eu-west',
    lastDeployed: 'bezig…',
    requests24h: 12,
    latencyP50: '2.4 s',
    tools: ['fetch_page_context'],
    systemPromptPreview:
      'Je schrijft korte, merkconforme teksten voor Bokito. Gebruik alleen feiten uit de kennisbank...',
    embedUrl: 'https://xrex-nmji-j9ur.f2.xano.io/api:livechat/script/main',
  },
]
