import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

const MODEL_ALIASES: Array<[RegExp, string]> = [
  [/^bokito-ai-3[.-]1/i, 'Bokito AI 3.1'],
  [/^bokito-ai/i, 'Bokito AI'],
  [/^claude-sonnet-4/i, 'Claude Sonnet 4'],
  [/^claude-sonnet-3[.-]?5/i, 'Claude Sonnet 3.5'],
  [/^claude-sonnet/i, 'Claude Sonnet'],
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
