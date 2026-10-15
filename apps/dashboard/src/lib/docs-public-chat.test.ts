import { afterEach, describe, expect, it, vi } from 'vitest'

describe('docsPublicChatConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults to the bokito tenant and production channel id', async () => {
    vi.stubEnv('VITE_DOCS_CHAT_TENANT', '')
    vi.stubEnv('VITE_DOCS_CHAT_CHANNEL_ID', '')
    const { docsPublicChatConfig } = await import('./docs-public-chat')
    const cfg = docsPublicChatConfig()
    expect(cfg.tenant).toBe('bokito')
    expect(cfg.agentSlug).toBe('assistant')
    expect(cfg.channelId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('honours Vite overrides', async () => {
    vi.stubEnv('VITE_DOCS_CHAT_TENANT', 'acme')
    vi.stubEnv('VITE_DOCS_CHAT_CHANNEL_ID', '11111111-2222-3333-4444-555555555555')
    vi.stubEnv('VITE_DOCS_CHAT_AGENT_SLUG', 'support')
    const { docsPublicChatConfig } = await import('./docs-public-chat')
    expect(docsPublicChatConfig()).toEqual({
      tenant: 'acme',
      channelId: '11111111-2222-3333-4444-555555555555',
      agentSlug: 'support',
    })
  })
})
