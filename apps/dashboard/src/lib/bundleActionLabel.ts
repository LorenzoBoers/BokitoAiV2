import type { ProposalBundleEntry } from './inbox-api'

/** Strip the "Review: " / "Approve: " prefix the server puts on action titles. */
export function actionTitle(title: string): string {
  for (const prefix of ['Review: ', 'Approve: ']) {
    if (title.startsWith(prefix)) return title.slice(prefix.length)
  }
  return title
}

/** Which arg makes an action row name the object, not only the verb. */
export const BUNDLE_NAMED_ARG: Record<string, string> = {
  connect_integration: 'provider',
  suggest_integration: 'provider',
  propose_integration: 'provider',
  recommend_module: 'slug',
  enable_module: 'slug',
  setup_integration: 'provider',
}

export type BundleLabelI18n = {
  exists: (key: string) => boolean
  t: (key: string, args: Record<string, string>) => string
}

/**
 * Operator label for one action-bundle row.
 * Prefer the DecisionRequest title (calendar event name, etc.) over a generic
 * tool fallback; keep i18n only when named args distinguish the object.
 */
export function bundleRowLabel(entry: ProposalBundleEntry, i18n?: BundleLabelI18n): string {
  const titled = actionTitle(entry.title || '').trim()
  const action = entry.action
  if (!action) return titled

  const namedField = BUNDLE_NAMED_ARG[action.key]
  const namedValue = namedField
    ? action.args[namedField] || action.args.module || action.args.display_name || ''
    : ''
  const i18nKey =
    action.args.new_name && action.key === 'update_tag'
      ? 'actions.update_tag_rename'
      : `actions.${action.key}`

  if (namedField && namedValue && i18n?.exists(`communication:${i18nKey}`)) {
    return i18n.t(i18nKey, { ...action.args, [namedField]: namedValue })
  }
  if (namedField && !namedValue) {
    if (titled) return titled
    if (action.fallback) return action.fallback
  }

  // Rich decision titles beat verb-only fallbacks ("Calendar create event").
  if (titled) {
    const fallback = (action.fallback || '').trim()
    if (!fallback || titled !== fallback) return titled
  }

  if (!namedField && i18n?.exists(`communication:${i18nKey}`)) {
    return i18n.t(i18nKey, { ...action.args })
  }
  if (action.fallback) return action.fallback
  return titled
}

const ISO_IN_TEXT =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g

/** Turn ISO stamps inside copy into a short local datetime. */
export function humanizeIsoDatetimes(text: string, locale?: string): string {
  return text.replace(ISO_IN_TEXT, (raw) => {
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return raw
    try {
      return new Intl.DateTimeFormat(locale || undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(parsed)
    } catch {
      return raw
    }
  })
}

/** Compact secondary line: decision summary, else mono tool key. */
export function bundleRowSubtitle(entry: ProposalBundleEntry, locale?: string): string | null {
  const summary = (entry.summary || '').trim()
  if (summary) {
    const first = humanizeIsoDatetimes(summary.split(/\r?\n/)[0]?.trim() || '', locale)
    if (first) return first.length > 160 ? `${first.slice(0, 157)}…` : first
  }
  const tool = entry.action?.tool?.trim()
  return tool || null
}
