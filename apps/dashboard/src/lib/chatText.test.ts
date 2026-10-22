import { describe, expect, it } from 'vitest'
import {
  appLinkKind,
  connectionBrandSlug,
  incompleteChipTailStart,
  nextChipRevealLength,
  parseChatInline,
  parseChatText,
  plainChatText,
  splitTagLedInline,
  type ChatInline,
} from './chatText'

function kinds(nodes: ChatInline[]): string[] {
  return nodes.map((n) => n.type)
}

describe('plainChatText', () => {
  it('drops markers but keeps the words', () => {
    expect(plainChatText('Between *8:00 and 12:00*, see [the plan](https://x.io) and **bold** `id`')).toBe(
      'Between 8:00 and 12:00, see the plan and bold id',
    )
  })

  it('leaves unmatched markers and plain math alone', () => {
    expect(plainChatText('2 * 3 = 6 and snake_case')).toBe('2 * 3 = 6 and snake_case')
  })
})

describe('parseChatInline', () => {
  it('reads a mention wrapped in brackets as a chip', () => {
    const nodes = parseChatInline('Ask [@[Support](agent:abc)] now')
    expect(kinds(nodes)).toEqual(['text', 'mention', 'text'])
    expect(nodes[1]).toEqual({ type: 'mention', name: 'Support', kind: 'agent', id: 'abc' })
  })

  it('reads WhatsApp-style bold, italic and strike', () => {
    expect(kinds(parseChatInline('a *b* _c_ ~d~ e'))).toEqual([
      'text',
      'bold',
      'text',
      'italic',
      'text',
      'strike',
      'text',
    ])
    expect(kinds(parseChatInline('**bold** and ~~gone~~'))).toEqual(['bold', 'text', 'strike'])
  })

  it('keeps unmatched markers and in-word underscores literal', () => {
    expect(parseChatInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }])
    expect(parseChatInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }])
  })

  it('turns links, bare URLs and mentions into nodes', () => {
    const nodes = parseChatInline('See [docs](/docs/x), https://bokito.ai. Hi @[Ann](user:7)')
    expect(nodes.find((n) => n.type === 'link' && n.href === '/docs/x')).toBeTruthy()
    expect(nodes.find((n) => n.type === 'link' && n.href === 'https://bokito.ai')).toBeTruthy()
    expect(nodes.find((n) => n.type === 'mention' && n.name === 'Ann')).toBeTruthy()
  })

  it('normalizes folder links that omit the leading slash', () => {
    const nodes = parseChatInline('Open [2025](folders/a55defc0-0864-41e5-b454-19ec7eaf12e5)')
    expect(nodes.find((n) => n.type === 'link')).toEqual({
      type: 'link',
      label: '2025',
      href: '/folders/a55defc0-0864-41e5-b454-19ec7eaf12e5',
    })
  })

  it('parses bare and structured tags plus status pills', () => {
    const nodes = parseChatInline('Tags #klacht and #storing, #[[klacht]](action_tag:1), [Open](status:open)', {
      tags: { klacht: 'action_tag', storing: 'tag' },
    })
    const tags = nodes.filter((n) => n.type === 'tag')
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tag', name: 'klacht', kind: 'action_tag' }),
        expect.objectContaining({ type: 'tag', name: 'storing', kind: 'tag' }),
        expect.objectContaining({ type: 'tag', name: 'klacht', kind: 'action_tag', id: '1' }),
      ]),
    )
    expect(nodes.find((n) => n.type === 'status' && n.key === 'open')).toBeTruthy()
  })

  it('styles an open marker at the tail only while streaming', () => {
    expect(kinds(parseChatInline('Hi **bol', { streaming: true }))).toEqual(['text', 'bold'])
    expect(parseChatInline('Hi **bol')).toEqual([{ type: 'text', text: 'Hi **bol' }])
  })

  it('hides incomplete chip markup at the tail while streaming', () => {
    expect(parseChatInline('Ask @[Bo', { streaming: true })).toEqual([{ type: 'text', text: 'Ask ' }])
    expect(parseChatInline('See [Moneybird](/con', { streaming: true })).toEqual([
      { type: 'text', text: 'See ' },
    ])
    expect(parseChatInline('Hi @[Ann](user:7) and @[Bo', { streaming: true })).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'mention', name: 'Ann', kind: 'user', id: '7' },
      { type: 'text', text: ' and ' },
    ])
  })

  it('leaves catalog names and email domains as plain text', () => {
    expect(parseChatInline('Koppel Moneybird en Exact Online.')).toEqual([
      { type: 'text', text: 'Koppel Moneybird en Exact Online.' },
    ])
    expect(parseChatInline('Mail lorenzo_boers@outlook.com')).toEqual([
      { type: 'text', text: 'Mail lorenzo_boers@outlook.com' },
    ])
  })

  it('chips a connector only from an explicit markdown link', () => {
    const nodes = parseChatInline('Koppel [Moneybird](/connections?connect=moneybird).')
    expect(nodes.find((n) => n.type === 'link' && n.href === '/connections?connect=moneybird')).toBeTruthy()
  })
})

describe('nextChipRevealLength', () => {
  it('holds at an incomplete mention instead of streaming the syntax', () => {
    const src = 'Ask @[Bo'
    expect(nextChipRevealLength(src, 0, 8)).toBe(4)
    expect(src.slice(0, 4)).toBe('Ask ')
    expect(incompleteChipTailStart(src)).toBe(4)
  })

  it('holds at an incomplete markdown link', () => {
    const src = 'See [Moneybird](/con'
    expect(nextChipRevealLength(src, 0, 12)).toBe(4)
    expect(nextChipRevealLength(src, 4, 18)).toBe(4)
  })

  it('pops a complete mention in one step once it fits the hard cap', () => {
    const chip = '@[Ann](user:7)'
    const src = `Hi ${chip}!`
    const chipStart = 3
    const chipEnd = chipStart + chip.length
    // Cruise only a few chars into the chip — still jumps to the end.
    expect(nextChipRevealLength(src, chipStart, chipStart + 3, chipEnd)).toBe(chipEnd)
    // Not yet fully publishable (lead brake): stay before the chip.
    expect(nextChipRevealLength(src, chipStart, chipStart + 3, chipStart + 5)).toBe(chipStart)
  })

  it('pops a complete in-app link atomically', () => {
    const chip = '[Moneybird](/connections?connect=moneybird)'
    const src = `Try ${chip} now`
    const start = 4
    expect(nextChipRevealLength(src, start, start + 2, start + chip.length)).toBe(start + chip.length)
  })

  it('releases incomplete bare brackets when holdIncomplete is false', () => {
    const src = 'array[0]'
    expect(nextChipRevealLength(src, 0, src.length, src.length, true)).toBe(5)
    expect(nextChipRevealLength(src, 0, src.length, src.length, false)).toBe(src.length)
  })
})

describe('parseChatText', () => {
  it('flattens report markup to chat lines', () => {
    const blocks = parseChatText('# Title\n\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n- item')
    const lines = blocks.filter((b) => b.type === 'line')
    expect(lines[0]).toMatchObject({ bold: true })
    const text = lines.map((b) =>
      b.type === 'line' ? b.inline.map((n) => (n.type === 'text' ? n.text : '')).join('') : '',
    )
    expect(text).toEqual(['Title', 'a · b', '1 · 2'])
    const list = blocks.find((b) => b.type === 'list')
    expect(list).toMatchObject({
      type: 'list',
      ordered: false,
      items: [[{ type: 'text', text: 'item' }]],
    })
  })

  it('groups consecutive bullets and peels tag-led rows', () => {
    const blocks = parseChatText('- #feature – New work\n- #api – Docs', {
      tags: { feature: 'action_tag', api: 'tag' },
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('list')
    if (blocks[0].type !== 'list') return
    const first = splitTagLedInline(blocks[0].items[0])
    expect(first.tag).toMatchObject({ name: 'feature', kind: 'action_tag' })
    expect(first.rest).toEqual([{ type: 'text', text: 'New work' }])
  })

  it('keeps fenced code whole and collapses blank lines to one gap', () => {
    const blocks = parseChatText('one\n\n\n```\nx = 1\n\ny = 2\n```')
    expect(blocks.map((b) => b.type)).toEqual(['line', 'gap', 'code'])
    expect(blocks[2]).toEqual({ type: 'code', text: 'x = 1\n\ny = 2', lang: '' })
  })
})

describe('appLinkKind', () => {
  it('detects person contact paths but not the companies list', () => {
    expect(appLinkKind('/contacts/abc-123')).toBe('contact')
    expect(appLinkKind('/contacts/companies/acme')).toBe('other')
    expect(appLinkKind('/folders/p1')).toBe('folder')
    expect(appLinkKind('/agents/a1')).toBe('agent')
    expect(appLinkKind('/agents')).toBe('other')
    expect(appLinkKind('/communication/inbox/open/t/abc')).toBe('inbox')
    expect(appLinkKind('/threads/abc')).toBe('inbox')
  })

  it('reads the marketplace slug from a connection chip', () => {
    expect(connectionBrandSlug('/connections?connect=moneybird')).toBe('moneybird')
    expect(connectionBrandSlug('/connections/accounting?connect=king_accountancy&step=setup')).toBe(
      'king_accountancy',
    )
    expect(connectionBrandSlug('/connections')).toBeNull()
    expect(connectionBrandSlug('/connections/accounting')).toBeNull()
    expect(connectionBrandSlug('/connections/accounting', 'KING Accountancy')).toBe('king')
    expect(connectionBrandSlug('/connections/accounting', 'Bjorn Lunden')).toBe('bjorn_lunden')
    expect(connectionBrandSlug('/connections/accounting', 'Moneybird')).toBe('moneybird')
    expect(connectionBrandSlug('/docs/integrations/mcp', 'Moneybird')).toBeNull()
  })

  it('detects snapshot canvas paths before generic project', () => {
    expect(appLinkKind('/cockpit/canvas')).toBe('canvas')
    expect(appLinkKind('/folders/p1?tab=canvas')).toBe('canvas')
    expect(appLinkKind('/folders/p1?tab=docs')).toBe('folder')
  })
})
