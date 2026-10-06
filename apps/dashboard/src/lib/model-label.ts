import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

const MODEL_ALIASES: Array<[RegExp, string]> = [
  [/^bokito-maki/i, 'Maki'],
  [/^bokito-kong/i, 'Kong'],
  [/^bokito-ai-3[.-]1/i, 'Bokito AI'],
  [/^bokito-ai/i, 'Bokito AI'],
  [/^ministral/i, 'Maki'],
  [/^mistral-medium/i, 'Mistral Medium'],
  [/^mistral-large/i, 'Mistral Large'],
  [/^mistral-small/i, 'Mistral Small'],
  [/^mistral-embed/i, 'Mistral Embed'],
  [/^mistral/i, 'Mistral'],
  [/^claude-sonnet-5/i, 'Claude Sonnet 5'],
  [/^claude-sonnet-4/i, 'Claude Sonnet 4'],
  [/^claude-sonnet-3[.-]?5/i, 'Claude Sonnet 3.5'],
  [/^claude-sonnet/i, 'Claude Sonnet'],
  [/^claude-opus-5/i, 'Claude Opus 5'],
  [/^claude-opus-4/i, 'Claude Opus 4'],
  [/^claude-opus/i, 'Claude Opus'],
  [/^claude-haiku/i, 'Claude Haiku'],
  [/^gpt-4o-mini/i, 'GPT-4o mini'],
  [/^gpt-4o/i, 'GPT-4o'],
  [/^gpt-4\.1/i, 'GPT-4.1'],
  [/^gpt-4/i, 'GPT-4'],
  [/^o3-mini/i, 'o3-mini'],
  [/^o3/i, 'o3'],
  [/^gemini-2\.5/i, 'Gemini 2.5'],
  [/^gemini-2\.0/i, 'Gemini 2.0'],
  [/^gemini/i, 'Gemini'],
]

/** Turn provider model ids into a short label first-time users can read. */
export function humanizeModelId(model: string | null | undefined): string {
  if (!model) return ''
  const raw = model.trim()
  for (const [pattern, label] of MODEL_ALIASES) {
    if (pattern.test(raw)) return label
  }
  return humanizeLabel(raw.replace(/-\d{8}$/, ''))
}

export function formatAgentModelLine(
  model: string | null | undefined,
  provider: string | null | undefined,
  t: TFunction,
): string {
  const pretty = humanizeModelId(model)
  if (!pretty) return ''
  const providerKey = (provider ?? '').trim().toLowerCase()
  if (!providerKey || providerKey === 'platform') {
    return t('agentContext.modelManaged', { ns: 'communication', model: pretty })
  }
  return `${pretty} · ${humanizeLabel(provider)}`
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  mistral: 'Mistral',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openai_compatible: 'OpenAI-compatible',
}

/** Human label for a stored provider_type slug. */
export function providerTypeLabel(providerType: string | null | undefined): string {
  const key = (providerType ?? '').trim().toLowerCase()
  return PROVIDER_TYPE_LABELS[key] ?? humanizeLabel(providerType)
}

/** Short label for a hosting region (`eu` | `us` | `unknown`). */
export function regionLabel(region: string | null | undefined, t: TFunction): string {
  const key = (region ?? '').trim().toLowerCase()
  if (key === 'eu') return t('dataRegion.eu', { ns: 'nav', defaultValue: 'EU' })
  if (key === 'us') return t('dataRegion.us', { ns: 'nav', defaultValue: 'US' })
  return t('dataRegion.unknown', { ns: 'nav', defaultValue: 'Unknown' })
}

/** Cheap / mid / expensive band from catalog cents-per-million-tokens. */
export function modelCostBand(
  inputCentsPerMtok: number,
  outputCentsPerMtok: number,
): 'low' | 'medium' | 'high' {
  const avg = (Math.max(0, inputCentsPerMtok) + Math.max(0, outputCentsPerMtok)) / 2
  if (avg < 80) return 'low'
  if (avg < 400) return 'medium'
  return 'high'
}
