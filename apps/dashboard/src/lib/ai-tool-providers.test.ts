import { describe, expect, it } from 'vitest'
import enNav from '../locales/en/nav.json'
import nlNav from '../locales/nl/nav.json'
import { AI_TOOL_PROVIDERS, matchingGrantName, WORKBENCH_PROVIDERS, aiCodingToolBrandSlugs } from './ai-tool-providers'
import { BRAND_ASSET_PATHS } from './brand-assets'
import { MCP_TOKEN_PLACEHOLDER } from './api-token-mcp'

type Dict = Record<string, unknown>

function lookup(root: Dict, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Dict | undefined)?.[key], root)
}

describe('ai-tool-providers', () => {
  it('has copy for every provider, mode and step in EN and NL', () => {
    for (const nav of [enNav, nlNav] as Dict[]) {
      for (const provider of AI_TOOL_PROVIDERS) {
        const base = `developersPage.aiTools.providers.${provider.id}`
        for (const key of ['name', 'description', 'body']) {
          expect(lookup(nav, `${base}.${key}`), `${base}.${key}`).toBeTypeOf('string')
        }
        for (const mode of provider.authModes) {
          const count = provider.steps[mode] ?? 0
          expect(count).toBeGreaterThan(0)
          for (let i = 1; i <= count; i += 1) {
            expect(lookup(nav, `${base}.${mode}${i}`), `${base}.${mode}${i}`).toBeTypeOf('string')
          }
        }
      }
      for (const provider of WORKBENCH_PROVIDERS) {
        const base = `developersPage.workbench.providers.${provider.id}`
        expect(lookup(nav, `${base}.body`), base).toBeTypeOf('string')
        expect(lookup(nav, `developersPage.workbench.phase${provider.phase}`)).toBeTypeOf('string')
      }
    }
  })

  it('uses a brand logo for every inbound provider', () => {
    for (const provider of AI_TOOL_PROVIDERS) {
      expect(BRAND_ASSET_PATHS[provider.brand], provider.id).toBeDefined()
    }
  })

  it('fills the created token into token snippets, else the placeholder', () => {
    const cursor = AI_TOOL_PROVIDERS.find((p) => p.id === 'cursor')!
    expect(cursor.snippets('token', 'https://x.test', 'bok_live')[0].code).toContain('bok_live')
    expect(cursor.snippets('token', 'https://x.test', null)[0].code).toContain(MCP_TOKEN_PLACEHOLDER)
    expect(cursor.snippets('oauth', 'https://x.test', 'bok_live')[0].code).not.toContain('bok_live')
    const chatgpt = AI_TOOL_PROVIDERS.find((p) => p.id === 'chatgpt')!
    expect(chatgpt.authModes).toEqual(['oauth'])
    expect(chatgpt.snippets('oauth', 'https://x.test', null)).toEqual([])
  })

  it('matches OAuth grants to the right provider', () => {
    const byId = (id: string) => AI_TOOL_PROVIDERS.find((p) => p.id === id)!
    const grants = [{ client_name: 'Claude Code' }, { client_name: 'Visual Studio Code' }]
    expect(matchingGrantName(byId('claudeCode'), grants)).toBe('Claude Code')
    expect(matchingGrantName(byId('claudeDesktop'), grants)).toBeNull()
    expect(matchingGrantName(byId('vscode'), grants)).toBe('Visual Studio Code')
    expect(matchingGrantName(byId('cursor'), grants)).toBeNull()
    expect(matchingGrantName(byId('generic'), grants)).toBeNull()
  })

  it('lists unique brand logos for the hub banner, skipping generic', () => {
    const slugs = aiCodingToolBrandSlugs()
    expect(slugs).toContain('cursor')
    expect(slugs).toContain('claude')
    expect(slugs).toContain('openai')
    expect(slugs).toContain('vscode')
    expect(slugs).toContain('windsurf')
    expect(slugs).toContain('copilot')
    expect(slugs).not.toContain('custom')
    expect(slugs).not.toContain('devin')
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(BRAND_ASSET_PATHS[slug], slug).toBeDefined()
    }
  })
})
