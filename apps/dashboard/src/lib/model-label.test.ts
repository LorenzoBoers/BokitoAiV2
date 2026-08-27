import { describe, expect, it } from 'vitest'
import { formatAgentModelLine, humanizeModelId, modelCostBand, providerTypeLabel } from './model-label'

describe('humanizeModelId', () => {
  it('maps the Bokito virtual model slug to its product name', () => {
    expect(humanizeModelId('bokito-ai-3-1')).toBe('Bokito AI 3.1')
    expect(humanizeModelId('bokito-ai-3.1')).toBe('Bokito AI 3.1')
  })

  it('maps dated Claude slugs to a short product name', () => {
    expect(humanizeModelId('claude-sonnet-4-20250514')).toBe('Claude Sonnet 4')
  })

  it('maps GPT slugs', () => {
    expect(humanizeModelId('gpt-4o-mini')).toBe('GPT-4o mini')
  })

  it('falls back to a readable sentence for unknown ids', () => {
    expect(humanizeModelId('custom-internal-model')).toBe('Custom internal model')
  })
})

describe('formatAgentModelLine', () => {
  it('hides the platform provider behind a Bokito label', () => {
    const label = formatAgentModelLine('claude-sonnet-4-20250514', 'platform', ((key, opts) => {
      if (key === 'agentContext.modelManaged') return `${opts?.model} (Bokito)`
      return key
    }) as never)
    expect(label).toBe('Claude Sonnet 4 (Bokito)')
  })
})

describe('providerTypeLabel', () => {
  it('humanizes known provider slugs', () => {
    expect(providerTypeLabel('openai_compatible')).toBe('OpenAI-compatible')
    expect(providerTypeLabel('anthropic')).toBe('Anthropic')
  })
})

describe('modelCostBand', () => {
  it('bands cheap models as low', () => {
    expect(modelCostBand(15, 60)).toBe('low')
  })

  it('bands mid-range models as medium', () => {
    expect(modelCostBand(150, 600)).toBe('medium')
  })

  it('bands expensive models as high', () => {
    expect(modelCostBand(1500, 7500)).toBe('high')
  })
})
