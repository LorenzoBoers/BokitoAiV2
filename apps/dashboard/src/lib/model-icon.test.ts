import { describe, expect, it } from 'vitest'
import { resolveModelIcon } from './model-icon'

describe('resolveModelIcon', () => {
  it('maps managed Bokito tiers to silhouettes', () => {
    expect(resolveModelIcon({ slug: 'bokito-maki' })).toMatchObject({
      kind: 'managed',
      src: '/models/maki.png',
      label: 'Maki',
    })
    expect(resolveModelIcon({ modelId: 'ministral-3b-2410', provider: 'bokito' })).toMatchObject({
      kind: 'managed',
      src: '/models/maki.png',
      label: 'Maki',
    })
    expect(resolveModelIcon({ slug: 'bokito-ai-3-1' })).toMatchObject({
      kind: 'managed',
      src: '/models/bokito.png',
    })
    expect(resolveModelIcon({ slug: 'bokito-kong' })).toMatchObject({
      kind: 'managed',
      src: '/models/kong.png',
    })
  })

  it('falls back to provider logos for BYOK rows', () => {
    expect(resolveModelIcon({ slug: 'claude-sonnet-5-5', providerType: 'anthropic' })).toMatchObject({
      kind: 'provider',
      src: '/brands/logo-claude.svg',
    })
    expect(resolveModelIcon({ slug: 'gpt-4o', provider: 'openai' })).toMatchObject({
      kind: 'provider',
      src: '/brands/logo-openai.svg',
    })
  })

  it('infers provider from model id when provider is missing', () => {
    expect(resolveModelIcon({ modelId: 'claude-haiku-4-5' }).kind).toBe('provider')
    expect(resolveModelIcon({ modelId: 'mistral-large-latest' }).kind).toBe('provider')
  })

  it('uses a generic fallback when nothing matches', () => {
    expect(resolveModelIcon({ slug: 'custom-internal-model' })).toEqual({
      kind: 'generic',
      src: '',
      label: 'Model',
    })
  })
})
