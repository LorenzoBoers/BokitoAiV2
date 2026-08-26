const SUBJECT_LABELS: Record<string, { en: string; nl: string }> = {
  'Reply to customer message': { en: 'Reply to customer message', nl: 'Antwoord op klantbericht' },
  'Daily platform scan': { en: 'Daily platform scan', nl: 'Dagelijkse platformscan' },
  'Agent passport update': { en: 'Agent access updated', nl: 'Agenttoegang bijgewerkt' },
  'PO wake: review platform backlog': { en: 'Lead: review platform backlog', nl: 'Lead: platformbacklog bekijken' },
  'PO heartbeat': { en: 'Lead heartbeat', nl: 'Lead-hartslag' },
  'Orchestrator heartbeat': { en: 'Lead heartbeat', nl: 'Lead-hartslag' },
  'Draft reply prepared for review.': { en: 'Draft reply prepared for review.', nl: 'Conceptantwoord klaar ter beoordeling.' },
  'Suggested reply': { en: 'Suggested reply', nl: 'Voorgesteld antwoord' },
  'No reply needed': { en: 'No reply needed', nl: 'Geen antwoord nodig' },
}

const CATEGORY_LABELS: Record<string, { en: string; nl: string }> = {
  billing: { en: 'Billing', nl: 'Facturatie' },
  support: { en: 'Support', nl: 'Ondersteuning' },
  sales: { en: 'Sales', nl: 'Verkoop' },
  spam: { en: 'Spam', nl: 'Spam' },
  question: { en: 'Question', nl: 'Vraag' },
  other: { en: 'Other', nl: 'Overig' },
  complaint: { en: 'Complaint', nl: 'Klacht' },
  feedback: { en: 'Feedback', nl: 'Feedback' },
  order: { en: 'Order', nl: 'Bestelling' },
}

const ROLE_LABELS: Record<string, { en: string; nl: string }> = {
  owner: { en: 'Owner', nl: 'Eigenaar' },
  admin: { en: 'Admin', nl: 'Beheerder' },
  member: { en: 'Member', nl: 'Lid' },
  viewer: { en: 'Viewer', nl: 'Kijker' },
  staff: { en: 'Staff', nl: 'Medewerker' },
}

const AGENT_ROLE_LABELS: Record<string, { en: string; nl: string }> = {
  orchestrator: { en: 'Lead', nl: 'Lead' },
  orchestra: { en: 'Lead', nl: 'Lead' },
  po: { en: 'Lead', nl: 'Lead' },
  lead: { en: 'Lead', nl: 'Lead' },
  worker: { en: 'Agent', nl: 'Agent' },
  agent: { en: 'Agent', nl: 'Agent' },
}

const OPTION_LABELS: Record<string, { en: string; nl: string }> = {
  approve: { en: 'Approve', nl: 'Goedkeuren' },
  reject: { en: 'Reject', nl: 'Afwijzen' },
  later: { en: 'Later', nl: 'Later' },
  defer: { en: 'Later', nl: 'Later' },
  send: { en: 'Send', nl: 'Versturen' },
  edit: { en: 'Edit', nl: 'Bewerken' },
  escalate: { en: 'Escalate', nl: 'Doorschakelen' },
  'send reply': { en: 'Send reply', nl: 'Antwoord versturen' },
  'edit draft': { en: 'Edit draft', nl: 'Concept bewerken' },
  'no reply needed': { en: 'No reply needed', nl: 'Geen antwoord nodig' },
}

const URGENCY_LABELS: Record<string, { en: string; nl: string }> = {
  urgent: { en: 'Urgent', nl: 'Urgent' },
  high: { en: 'High', nl: 'Hoog' },
  medium: { en: 'Medium', nl: 'Gemiddeld' },
  normal: { en: 'Normal', nl: 'Normaal' },
  low: { en: 'Low', nl: 'Laag' },
}

const GENERIC_VISITOR_NAME =
  /^(website visitor|website bezoeker|websitebezoeker|visitor|bezoeker)$/i

export function isOpaqueWidgetAddress(address: string | null | undefined): boolean {
  return /^cust_[a-z0-9]+$/i.test((address ?? '').trim())
}

export function isPlaceholderContactAddress(address: string | null | undefined): boolean {
  const value = (address ?? '').trim().toLowerCase()
  if (!value) return false
  if (isOpaqueWidgetAddress(value)) return true
  return value === 'visitor@web' || value === 'visitor@widget' || value.startsWith('visitor@')
}

export function humanizeContactName(
  name: string | null | undefined,
  address: string | null | undefined,
  visitorLabel: string,
): string {
  const trimmed = (name ?? '').trim()
  if (trimmed && !GENERIC_VISITOR_NAME.test(trimmed)) return trimmed
  if (isPlaceholderContactAddress(address) || GENERIC_VISITOR_NAME.test(trimmed)) return visitorLabel
  return trimmed
}

export function translateKnownText(text: string | null | undefined, locale: 'en' | 'nl'): string {
  if (!text) return ''
  const trimmed = text.trim()
  const assist = trimmed.match(/^Assist:\s*(.+)$/i)
  const body = assist ? assist[1].trim() : trimmed
  const mapped = SUBJECT_LABELS[body]?.[locale] ?? body
  if (assist) {
    return locale === 'nl' ? `Hulp: ${mapped}` : `Help: ${mapped}`
  }
  return mapped
}

export function displayThreadTitle(
  thread: { channel?: string; folder?: string; email_subject?: string; contact_name?: string; contact_email?: string },
  locale: 'en' | 'nl',
  labels: { visitor: string; noSubject: string; unknownSender: string },
): string {
  const internal = thread.channel === 'assistant' || thread.folder === 'internal'
  if (internal) {
    return translateKnownText(thread.email_subject, locale) || labels.noSubject
  }
  return (
    humanizeContactName(thread.contact_name, thread.contact_email, labels.visitor) ||
    (isPlaceholderContactAddress(thread.contact_email) ? labels.visitor : thread.contact_email) ||
    labels.unknownSender
  )
}

export function displayThreadPreview(
  thread: { channel?: string; folder?: string; email_subject?: string; ai_summary?: string | null; agent_name?: string | null },
  locale: 'en' | 'nl',
): string {
  if (thread.ai_summary) return thread.ai_summary
  const subject = translateKnownText(thread.email_subject, locale)
  if (thread.channel === 'assistant') return thread.agent_name || subject
  return subject
}

export function roleLabel(role: string | null | undefined, locale: 'en' | 'nl'): string {
  const key = (role ?? '').trim().toLowerCase()
  if (!key) return ''
  return ROLE_LABELS[key]?.[locale] ?? humanizeLabel(key)
}

export function displayContactAddress(address: string | null | undefined): string | null {
  const value = (address ?? '').trim()
  if (!value || isPlaceholderContactAddress(value)) return null
  return value
}

export function categoryLabel(category: string | null | undefined, locale: 'en' | 'nl'): string {
  if (!category) return ''
  const key = category.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return CATEGORY_LABELS[key]?.[locale] ?? humanizeLabel(category)
}

const EVENT_LABELS: Record<string, { en: string; nl: string }> = {
  assigned: { en: 'Assigned', nl: 'Toegewezen' },
  unassigned: { en: 'Unassigned', nl: 'Niet toegewezen' },
  status_changed: { en: 'Status changed', nl: 'Status gewijzigd' },
  closed: { en: 'Closed', nl: 'Gesloten' },
  reopened: { en: 'Reopened', nl: 'Heropend' },
  pinned: { en: 'Pinned', nl: 'Vastgezet' },
  unpinned: { en: 'Unpinned', nl: 'Losgemaakt' },
  tagged: { en: 'Tagged', nl: 'Label toegevoegd' },
  decision_approved: { en: 'Decision approved', nl: 'Besluit goedgekeurd' },
  decision_rejected: { en: 'Decision rejected', nl: 'Besluit afgewezen' },
  decision_deferred: { en: 'Decision deferred', nl: 'Besluit uitgesteld' },
  decision_resolved: { en: 'Decision resolved', nl: 'Besluit afgehandeld' },
  takeover: { en: 'Taken over from AI', nl: 'Overgenomen van AI' },
  release: { en: 'Released to AI', nl: 'Teruggegeven aan AI' },
  ai_paused: { en: 'AI paused', nl: 'AI gepauzeerd' },
  ai_resumed: { en: 'AI resumed', nl: 'AI hervat' },
  note_added: { en: 'Internal note', nl: 'Interne notitie' },
  replied: { en: 'Reply sent', nl: 'Antwoord verstuurd' },
}

export function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (ch) => ch.toUpperCase())
}

export function eventLabel(eventType: string, locale: 'en' | 'nl' = 'en'): string {
  const key = eventType.trim().toLowerCase()
  return EVENT_LABELS[key]?.[locale] ?? humanizeLabel(eventType)
}

export function relativeTime(iso: string | null | undefined, locale: 'en' | 'nl' = 'en'): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return locale === 'nl' ? 'nu' : 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return locale === 'nl' ? `${hours}u` : `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(locale === 'nl' ? 'nl-NL' : 'en-US', {
    day: 'numeric',
    month: 'short',
  })
}

export function greeting(locale: 'en' | 'nl', hour = new Date().getHours()): string {
  if (hour < 12) return locale === 'nl' ? 'Goedemorgen' : 'Good morning'
  if (hour < 18) return locale === 'nl' ? 'Goedemiddag' : 'Good afternoon'
  return locale === 'nl' ? 'Goedenavond' : 'Good evening'
}

export function firstName(displayName: string | null | undefined, email?: string | null): string {
  const name = displayName?.trim()
  if (name) return name.split(/\s+/)[0]
  const local = email?.split('@')[0]
  return local || ''
}

export function agentRoleLabel(role: string | null | undefined, locale: 'en' | 'nl'): string {
  const key = (role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!key) return ''
  return AGENT_ROLE_LABELS[key]?.[locale] ?? humanizeLabel(role ?? '')
}

export function optionLabel(
  option: { id?: string; label?: string },
  locale: 'en' | 'nl',
): string {
  const raw = (option.label || option.id || '').trim()
  if (!raw) return ''
  const known = OPTION_LABELS[raw.toLowerCase()]
  if (known) return known[locale]
  return translateKnownText(raw, locale)
}

export type UrgencyTier = 'urgent' | 'high' | 'medium' | 'low'

export function userNumericId(userId: string | null | undefined): number | null {
  const hex = (userId ?? '').replace(/-/g, '')
  if (hex.length < 8) return null
  const value = Number.parseInt(hex.slice(0, 8), 16)
  return Number.isFinite(value) ? value : null
}

export function urgencyTier(urgency: number | string | null | undefined): UrgencyTier | null {
  if (urgency == null || urgency === '') return null
  if (typeof urgency === 'number') {
    if (!Number.isFinite(urgency)) return null
    if (urgency >= 80) return 'urgent'
    if (urgency >= 50) return 'high'
    if (urgency >= 25) return 'medium'
    return 'low'
  }
  const key = urgency.trim().toLowerCase()
  if (key === 'urgent' || key === 'high' || key === 'medium' || key === 'low') return key
  if (key === 'normal') return 'medium'
  const numeric = Number(key)
  if (Number.isFinite(numeric)) return urgencyTier(numeric)
  return null
}

export function urgencyLabel(
  urgency: number | string | null | undefined,
  locale: 'en' | 'nl',
): string {
  const tier = urgencyTier(urgency)
  if (!tier) return ''
  return URGENCY_LABELS[tier]?.[locale] ?? ''
}

export function translateMockAgentBody(text: string | null | undefined, locale: 'en' | 'nl'): string {
  if (!text) return ''
  const match = text.match(
    /^\[mock\] I received your message about:\s*(.+?)\.+\s*This is the Bokito AI OS assistant running in mock mode\.\s*$/s,
  )
  if (!match) return text
  const topic = match[1].trim()
  return locale === 'nl'
    ? `Ik heb je bericht over “${topic}” ontvangen. Dit is de Bokito-assistent in testmodus.`
    : `I received your message about “${topic}”. This is the Bokito assistant in test mode.`
}

export function optionResolveAction(option: { id: string; action_type?: string }): 'approved' | 'rejected' | 'deferred' {
  const id = option.id.toLowerCase()
  const actionType = (option.action_type || '').toLowerCase()
  if (id === 'escalate' || actionType === 'escalate') return 'rejected'
  if (id.includes('reject') || id === 'no' || actionType === 'reject') return 'rejected'
  if (id.includes('later') || id.includes('defer') || id === 'skip' || actionType === 'defer') {
    return 'deferred'
  }
  return 'approved'
}
