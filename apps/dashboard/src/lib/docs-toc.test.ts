import { describe, expect, it } from 'vitest'

import { extractToc, headingId, headingText } from './docs-toc'

describe('docs toc', () => {
  it('strips inline markdown from heading text', () => {
    expect(headingText('Connect a **mailbox**')).toBe('Connect a mailbox')
    expect(headingText('Use `signals:read` and [links](/docs/x)')).toBe('Use signals:read and links')
  })

  it('builds stable anchor ids', () => {
    expect(headingId('Connect a mailbox')).toBe('connect-a-mailbox')
    expect(headingId('Respond fast, retry-safe')).toBe('respond-fast-retry-safe')
    expect(headingId('The 429 response')).toBe('the-429-response')
  })

  it('extracts level-2 headings and skips fenced code', () => {
    const content = [
      '# Title',
      '## First section',
      'Body',
      '```bash',
      '## not a heading',
      '```',
      '## Second section',
      '### Deeper heading',
    ].join('\n')
    expect(extractToc(content)).toEqual([
      { id: 'first-section', text: 'First section' },
      { id: 'second-section', text: 'Second section' },
    ])
  })
})
