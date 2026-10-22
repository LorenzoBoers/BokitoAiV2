/**
 * Platform Lucide marks operators pick for labels and legacy agent icons.
 * Ids are kebab-case Lucide names; the API allowlist is generated from the
 * same `icons` map (apps/api/scripts/dev/generate_platform_icons.py).
 */
import { icons, type LucideIcon } from 'lucide-react'

/** Former curated set — shown first when the picker query is empty. */
export const PLATFORM_ICON_POPULAR = [
  'route',
  'bug',
  'shield',
  'flask-conical',
  'git-branch',
  'siren',
  'life-buoy',
  'headset',
  'message-circle',
  'phone',
  'phone-call',
  'user-plus',
  'calendar',
  'map-pin',
  'wrench',
  'package',
  'truck',
  'file-text',
  'receipt',
  'credit-card',
  'bot',
  'sparkles',
  'zap',
  'briefcase',
  'heart',
  'flag',
  'tag',
  'star',
  'megaphone',
  'pen-line',
  'mail',
  'building-2',
  'users',
  'brain',
  'lightbulb',
] as const

/**
 * Extra EN/NL search terms for high-traffic marks. Ids always match by
 * substring; aliases help Dutch operators who do not know Lucide names.
 */
export const PLATFORM_ICON_ALIASES: Record<string, string> = {
  headset: 'support supporten klantenservice helpdesk',
  'life-buoy': 'help hulp support redding',
  siren: 'urgent spoed alarm emergency',
  bug: 'fout error issue defect',
  shield: 'security beveiliging privacy',
  'flask-conical': 'test lab experiment',
  'git-branch': 'versie branch code development',
  route: 'flow workflow pad route',
  'message-circle': 'chat bericht message',
  phone: 'telefoon bellen call',
  'phone-call': 'telefoon bellen call inbound',
  'user-plus': 'uitnodigen invite contact lead',
  calendar: 'agenda planning datum',
  'map-pin': 'locatie adres place',
  wrench: 'tool onderhoud repair',
  package: 'pakket verzending delivery',
  truck: 'logistiek transport verzending',
  'file-text': 'document bestand doc',
  receipt: 'factuur bon invoice',
  'credit-card': 'betaling payment pin',
  bot: 'agent ai robot',
  sparkles: 'ai magic slim',
  zap: 'snel power energy',
  briefcase: 'werk business kantoor',
  heart: 'favoriet like liefde',
  flag: 'prioriteit markering',
  tag: 'label hashtag',
  star: 'favoriet rating',
  megaphone: 'marketing aankondiging announce',
  'pen-line': 'schrijven edit notitie',
  mail: 'email e-mail inbox',
  'building-2': 'bedrijf company kantoor',
  users: 'team mensen people',
  brain: 'kennis knowledge ai',
  lightbulb: 'idee idea tip',
  'shopping-bag': 'webshop winkel shop',
  stethoscope: 'zorg health medisch',
  scale: 'juridisch legal recht',
  'book-open': 'kennis docs handleiding',
  'heart-handshake': 'partnership samenwerking',
  home: 'thuis home adres',
  plane: 'reis travel vlucht',
  plug: 'integratie connect koppeling',
  download: 'downloaden export',
  'refresh-cw': 'sync herhaal refresh',
  clock: 'tijd deadline uur',
  user: 'persoon persoonlijk',
}

function toKebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase()
}

function toPascal(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

let cachedIds: string[] | null = null

/** All Lucide kebab ids available in the installed lucide-react build. */
export function platformIconIds(): string[] {
  if (cachedIds) return cachedIds
  cachedIds = [...new Set(Object.keys(icons).map(toKebab))].sort()
  return cachedIds
}

/** Resolve a kebab Lucide id to a component, or null when unknown. */
export function platformIcon(id: string | null | undefined): LucideIcon | null {
  if (!id) return null
  const key = toPascal(id.trim().toLowerCase())
  const Icon = (icons as Record<string, LucideIcon | undefined>)[key]
  return Icon ?? null
}

/**
 * Filter the catalog for the icon picker.
 * Empty query: popular pins first, then the full Lucide set (scrollable).
 * Any query searches by id substring or EN/NL aliases.
 */
export function filterPlatformIcons(query: string, selected?: string | null): string[] {
  const all = platformIconIds()
  const needle = query.trim().toLowerCase()
  let matched: string[]
  if (!needle) {
    const popular = PLATFORM_ICON_POPULAR.filter((id) => all.includes(id))
    const rest = all.filter((id) => !(popular as readonly string[]).includes(id))
    matched = [...popular, ...rest]
  } else {
    matched = all.filter((id) => {
      if (id.includes(needle)) return true
      const aliases = PLATFORM_ICON_ALIASES[id]
      return Boolean(aliases && aliases.includes(needle))
    })
  }
  if (selected && matched.includes(selected)) {
    matched = [selected, ...matched.filter((id) => id !== selected)]
  }
  return matched
}
