/**
 * Resolve a visual for a chat model: managed Bokito silhouette → provider
 * brand → generic fallback. Used everywhere models are listed or picked.
 */

export type ModelIconKind = 'managed' | 'provider' | 'generic'

export type ModelIconRef = {
  kind: ModelIconKind
  /** Public URL for managed/provider art; empty for the generic Lucide fallback. */
  src: string
  /** Accessible short name (Maki, Anthropic, …). */
  label: string
}

const MANAGED_BY_SLUG: Array<{ test: RegExp; src: string; label: string }> = [
  { test: /^bokito-maki/i, src: '/models/maki.png', label: 'Maki' },
  // Platform Maki often stores the upstream id; same mark as bokito-maki.
  { test: /^ministral/i, src: '/models/maki.png', label: 'Maki' },
  { test: /^bokito-kong/i, src: '/models/kong.png', label: 'Kong' },
  { test: /^bokito-ai/i, src: '/models/bokito.png', label: 'Bokito' },
]

const PROVIDER_LOGOS: Record<string, { src: string; label: string }> = {
  anthropic: { src: '/brands/logo-claude.svg', label: 'Anthropic' },
  claude: { src: '/brands/logo-claude.svg', label: 'Anthropic' },
  openai: { src: '/brands/logo-openai.svg', label: 'OpenAI' },
  mistral: {
    src: 'https://cdn.simpleicons.org/mistralai/9CA3AF',
    label: 'Mistral',
  },
}

export type ResolveModelIconInput = {
  slug?: string | null
  modelId?: string | null
  provider?: string | null
  providerType?: string | null
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = (value ?? '').trim()
    if (trimmed) return trimmed
  }
  return ''
}

/** Pick the best icon for a catalog / selectable model row. */
export function resolveModelIcon(input: ResolveModelIconInput): ModelIconRef {
  const slug = firstNonEmpty(input.slug, input.modelId)
  for (const row of MANAGED_BY_SLUG) {
    if (row.test.test(slug)) {
      return { kind: 'managed', src: row.src, label: row.label }
    }
  }

  const providerKey = firstNonEmpty(input.providerType, input.provider).toLowerCase()
  // Managed Bokito provider without a known tier slug still gets the Bokito mark.
  if (providerKey === 'bokito') {
    return { kind: 'managed', src: '/models/bokito.png', label: 'Bokito' }
  }
  const provider = PROVIDER_LOGOS[providerKey]
  if (provider) {
    return { kind: 'provider', src: provider.src, label: provider.label }
  }

  // Infer provider from raw model ids when the row has no provider field.
  if (/^claude/i.test(slug)) {
    return { kind: 'provider', src: PROVIDER_LOGOS.anthropic.src, label: 'Anthropic' }
  }
  if (/^(gpt-|o[13]|text-embedding)/i.test(slug)) {
    return { kind: 'provider', src: PROVIDER_LOGOS.openai.src, label: 'OpenAI' }
  }
  if (/^mistral|^ministral/i.test(slug)) {
    return { kind: 'provider', src: PROVIDER_LOGOS.mistral.src, label: 'Mistral' }
  }

  return { kind: 'generic', src: '', label: 'Model' }
}
